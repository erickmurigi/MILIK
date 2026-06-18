import { createError } from "../../../utils/error.js";
import mongoose from "mongoose";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import CarWashJob from "../models/CarWashJob.js";
import CarWashPayment from "../models/CarWashPayment.js";
import CarWashCustomer from "../models/CarWashCustomer.js";
import { currentUserId, escapeRegex, netJobPrice, parseDateRange, resolveActiveBusinessId, resolveActiveBranchId } from "../services/businessScope.js";
import { accrueCommissionForJob, handleJobPaymentStatusAfterPaymentChange, markJobCommissionsPayable } from "../services/commissionService.js";
import { awardLoyaltyStamp, revokeStampForJob, sendPaymentConfirmationSms } from "./loyaltyController.js";
import axios from "axios";
import Company from "../../../models/Company.js";
import CarWashMpesaNotification from "../models/CarWashMpesaNotification.js";
import CarWashCreditAccount from "../models/CarWashCreditAccount.js";
import { getRawMpesaPaybillConfigs, getPrimaryMpesaPaybillConfig } from "../../../utils/companyModules.js";
import CarWashBranch from "../models/CarWashBranch.js";
import { sendAdHocSms } from "../../../services/communicationService.js";
import { postCarWashPaymentLedger, reverseCarWashPaymentLedger } from "../services/carwashAccountingService.js";

const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
const PAYMENT_METHODS = new Set(["cash", "mpesa", "bank", "card", "other"]);
const RECONCILIATION_STATUSES = new Set(["pending", "reconciled", "flagged"]);

const resolveCashbookAccount = async (business, value) => {
  const accountId = String(value || "").trim();
  if (!accountId) throw createError(400, "Cashbook account is required for Car Wash payments");
  if (!mongoose.Types.ObjectId.isValid(accountId)) {
    throw createError(400, "Invalid Car Wash payment cashbook account");
  }

  const account = await ChartOfAccount.findOne({
    _id: accountId,
    business,
    type: "asset",
    isPosting: true,
    subGroup: { $regex: "cashbook", $options: "i" },
  }).lean();

  if (!account) {
    throw createError(400, "Select a valid posting cashbook account for this Car Wash payment");
  }

  return account._id;
};

// Effective paid = cash received + any discount write-off
const effectivePaidAggregation = [
  { $group: { _id: "$job", paid: { $sum: { $add: ["$amount", { $ifNull: ["$discountAmount", 0] }] } } } },
];

const refreshJobPaymentStatus = async (business, jobId) => {
  const job = await CarWashJob.findOne({ _id: jobId, business });
  if (!job) throw createError(404, "Car Wash job not found");

  const totals = await CarWashPayment.aggregate([
    { $match: { business: job.business, job: job._id } },
    ...effectivePaidAggregation,
  ]);
  const paidAmount = Number(totals?.[0]?.paid || 0);
  const price = netJobPrice(job);
  job.paymentStatus = paidAmount <= 0 ? "unpaid" : paidAmount < price ? "partial" : "paid";
  // When a ready job becomes fully paid, auto-advance to done so it leaves the washboard/queue display
  if (job.paymentStatus === "paid" && job.status === "ready") {
    job.status = "done";
  }
  // Rollback only: legacy-paid jobs whose payment is reversed revert to done
  if (job.status === "paid" && job.paymentStatus !== "paid") {
    job.status = "done";
  }
  await job.save();
  return { job, paidAmount };
};

export const listPayments = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };
    const branchId = resolveActiveBranchId(req);
    if (branchId) filter.branch = branchId;
    if (req.query.method) filter.method = String(req.query.method).trim().toLowerCase();
    if (req.query.cashbookAccount && mongoose.Types.ObjectId.isValid(String(req.query.cashbookAccount))) {
      filter.cashbookAccount = String(req.query.cashbookAccount);
    }
    if (req.query.job && mongoose.Types.ObjectId.isValid(req.query.job)) filter.job = req.query.job;
    if (req.query.reconciliationStatus) filter.reconciliationStatus = String(req.query.reconciliationStatus).trim().toLowerCase();
    if (req.query.reference) filter.reference = new RegExp(escapeRegex(String(req.query.reference).trim()), "i");
    if (req.query.date) {
      const { start, end } = parseDateRange(req.query.date);
      filter.paymentDate = { $gte: start, $lt: end };
    }
    const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 100);
    const page = Math.max(Number(req.query.page || 1), 1);
    const skip = (page - 1) * limit;
    const [payments, total] = await Promise.all([
      CarWashPayment.find(filter)
        .populate("job", "jobNumber plateNumber customerName serviceName price status paymentStatus phone")
        .populate("cashbookAccount", "code name type subGroup")
        .populate("receivedBy", "name username email")
        .populate("branch", "name")
        .sort({ paymentDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      CarWashPayment.countDocuments(filter),
    ]);
    const pagination = { page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) };
    res.status(200).json({ success: true, data: { payments, pagination }, payments, pagination });
  } catch (error) {
    next(error);
  }
};

export const recordPayment = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const jobId = req.body.job || req.params.jobId;
    const job = await CarWashJob.findOne({ _id: jobId, business }).lean();
    if (!job) return next(createError(404, "Car Wash job not found"));
    if (job.status === "cancelled") return next(createError(400, "Cannot record payment for a cancelled Car Wash job"));

    const amount = Number(req.body.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) return next(createError(400, "Payment amount must be greater than zero"));
    const discountAmount = Math.max(0, Number(req.body.discountAmount || 0));
    if (discountAmount > 0) {
      const biz    = await Company.findById(business).select("carwashSettings").lean();
      const maxPct = Number(biz?.carwashSettings?.discountMaxPercent ?? 0);
      if (maxPct > 0) {
        const jobDiscount = Number(job.discountAmount || 0);
        const cap         = round2(Number(job.price || 0) * maxPct / 100);
        const headroom    = round2(Math.max(0, cap - jobDiscount));
        if (discountAmount > headroom + 0.009) {
          return next(createError(400, `Write-off cannot exceed KES ${headroom} — job already has a KES ${jobDiscount} discount applied (${maxPct}% cap)`));
        }
      }
    }
    const effectiveAmount = round2(amount + discountAmount);

    const paidRows = await CarWashPayment.aggregate([
      { $match: { business: job.business, job: job._id } },
      ...effectivePaidAggregation,
    ]);
    const alreadyPaid = Number(paidRows?.[0]?.paid || 0);
    const outstanding = Math.max(netJobPrice(job) - alreadyPaid, 0);
    if (outstanding <= 0) return next(createError(400, "Car Wash job is already fully paid"));
    if (effectiveAmount > outstanding + 0.01) return next(createError(400, "Payment + discount exceeds the outstanding Car Wash job balance"));

    const method = String(req.body.method || "cash").trim().toLowerCase();
    if (!PAYMENT_METHODS.has(method)) return next(createError(400, "Invalid Car Wash payment method"));
    const cashbookAccount = await resolveCashbookAccount(business, req.body.cashbookAccount);

    // For M-Pesa manual entries the staff can record the payer's number.
    // This is used as the SMS target so confirmation always reaches whoever paid.
    const receivedFromPhone = method === "mpesa" && req.body.receivedFromPhone
      ? String(req.body.receivedFromPhone).trim() || null
      : null;

    const rawPaymentDate = req.body.paymentDate ? new Date(req.body.paymentDate) : new Date();
    if (isNaN(rawPaymentDate.getTime())) return next(createError(400, "Invalid payment date"));

    const userId = currentUserId(req);
    const payment = await CarWashPayment.create({
      business,
      branch: job.branch || null,
      job: job._id,
      amount,
      discountAmount,
      method,
      cashbookAccount,
      reference: String(req.body.reference || "").trim(),
      receivedFromPhone,
      paymentDate: rawPaymentDate,
      receivedBy: userId,
      createdBy: userId,
      updatedBy: userId,
    });
    const { job: updatedJob, paidAmount: totalEffectivePaid } = await refreshJobPaymentStatus(business, job._id);

    // Persist M-Pesa payer phone to the job + loyalty customer (enables SMS button + loyalty lookup).
    // A new payer always overwrites the previous phone — cash payments leave the existing number intact.
    if (receivedFromPhone) {
      await CarWashJob.updateOne({ _id: updatedJob._id, business }, { $set: { phone: receivedFromPhone } });
      updatedJob.phone = receivedFromPhone;
      if (updatedJob.plateNumber) {
        await CarWashCustomer.updateOne(
          { business, plates: updatedJob.plateNumber },
          { $set: { phone: receivedFromPhone } }
        ).catch(() => {});
      }
    }

    await accrueCommissionForJob({ req, job: updatedJob });

    if (updatedJob.paymentStatus === "paid") {
      await markJobCommissionsPayable({ business, jobId: updatedJob._id });
    }
    // Award stamp (suppress its own SMS) then send one combined payment+loyalty message.
    // Both run fire-and-forget so the HTTP response is not delayed.
    (async () => {
      let loyaltySmsBody = null;
      if (["paid", "partial"].includes(updatedJob.paymentStatus)) {
        try {
          const stampResult = await awardLoyaltyStamp({ business, job: updatedJob, overridePhone: receivedFromPhone || null, suppressSms: true });
          loyaltySmsBody = stampResult?.smsBody || null;
        } catch (err) {
          console.error("[CW Payment] Stamp failed job=%s: %s", updatedJob.jobNumber, err?.message || err);
        }
      }
      // Cash payments: fall back to any phone already on the job (from a prior M-Pesa payment),
      // including hashed/masked MSISDNs from Africa's Talking hashed-number routing.
      const cashMasked = !receivedFromPhone ? (updatedJob.maskedMsisdn || null) : null;
      await sendPaymentConfirmationSms({ business, job: updatedJob, amount, overridePhone: receivedFromPhone || null, maskedMsisdn: cashMasked, loyaltySmsBody });
    })().catch((err) => console.error("[CW Payment] SMS failed job=%s: %s", updatedJob.jobNumber, err?.message || err));
    await postCarWashPaymentLedger({ businessId: business, payment, cashbookAccountId: cashbookAccount, job: updatedJob, userId });
    res.status(201).json({ success: true, data: payment, payment, job: updatedJob, message: "Car Wash payment recorded" });
  } catch (error) {
    next(error);
  }
};

export const deletePayment = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const payment = await CarWashPayment.findOne({ _id: req.params.id, business });
    if (!payment) return next(createError(404, "Car Wash payment not found"));
    const jobBeforeDelete = await CarWashJob.findOne({ _id: payment.job, business }).lean();
    if (!jobBeforeDelete) return next(createError(404, "Car Wash job not found"));

    const totals = await CarWashPayment.aggregate([
      { $match: { business: jobBeforeDelete.business, job: jobBeforeDelete._id } },
      ...effectivePaidAggregation,
    ]);
    const effectiveThisPayment = round2(Number(payment.amount || 0) + Number(payment.discountAmount || 0));
    const paidAfterDelete = round2(Number(totals?.[0]?.paid || 0) - effectiveThisPayment);
    const willRemainPaid = paidAfterDelete >= netJobPrice(jobBeforeDelete);
    if (!willRemainPaid) {
      await handleJobPaymentStatusAfterPaymentChange({
        business,
        job: { ...jobBeforeDelete, paymentStatus: paidAfterDelete <= 0 ? "unpaid" : "partial" },
        checkOnly: true,
      });
    }

    await reverseCarWashPaymentLedger({ businessId: business, paymentId: payment._id, req });
    if (payment.method === "prepaid" && jobBeforeDelete.creditAccount) {
      await CarWashCreditAccount.updateOne(
        { _id: jobBeforeDelete.creditAccount, business },
        { $inc: { accountCredit: round2(Number(payment.amount || 0)) } }
      );
    }
    // Only revoke the stamp when the job becomes fully unpaid AND staff never manually
    // marked it done. If another payment remains (still partial), the customer earned
    // the stamp. If the job is "done", the car was serviced — stamp stands.
    const jobWillBeUnpaid = paidAfterDelete <= 0;
    if (jobWillBeUnpaid && !["done", "paid"].includes(jobBeforeDelete.status)) {
      await revokeStampForJob({ business, jobId: jobBeforeDelete._id, plate: jobBeforeDelete.plateNumber });
    }
    const deletedPaymentId = payment._id;
    await payment.deleteOne();
    // If this payment was linked to an M-Pesa notification, return it to unmatched
    CarWashMpesaNotification.findOneAndUpdate(
      { business, matchedPayment: deletedPaymentId },
      { $set: { status: "unmatched", matchedPayment: null, isReversed: true, reversalDate: new Date(), resultDesc: "Payment reversed" } }
    ).catch(() => {});
    const { job } = await refreshJobPaymentStatus(business, payment.job);
    await handleJobPaymentStatusAfterPaymentChange({ business, job });
    res.status(200).json({ success: true, job, message: "Car Wash payment deleted" });
  } catch (error) {
    next(error);
  }
};

export const updatePaymentReconciliation = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const status = String(req.body.reconciliationStatus || req.body.status || "").trim().toLowerCase();
    if (!RECONCILIATION_STATUSES.has(status)) return next(createError(400, "Invalid Car Wash reconciliation status"));

    const update = {
      reconciliationStatus: status,
      reconciliationNote: String(req.body.reconciliationNote || req.body.note || "").trim(),
      updatedBy: currentUserId(req),
    };
    if (status === "reconciled" || status === "flagged") {
      update.reconciledAt = new Date();
      update.reconciledBy = currentUserId(req);
    } else {
      update.reconciledAt = null;
      update.reconciledBy = null;
    }

    const payment = await CarWashPayment.findOneAndUpdate({ _id: req.params.id, business }, update, { new: true, runValidators: true })
      .populate("job", "jobNumber plateNumber customerName serviceName price status paymentStatus phone")
      .populate("cashbookAccount", "code name type subGroup")
      .populate("receivedBy", "name username email")
      .populate("reconciledBy", "name username email");
    if (!payment) return next(createError(404, "Car Wash payment not found"));
    res.status(200).json({ success: true, data: payment, payment, message: "Car Wash payment reconciliation updated" });
  } catch (error) {
    next(error);
  }
};

export const sendPaymentSms = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const payment = await CarWashPayment.findOne({ _id: req.params.id, business })
      .populate("job", "jobNumber customerName phone")
      .lean();
    if (!payment) throw createError(404, "Car Wash payment not found");
    const phone = String(req.body.phone || payment.job?.phone || "").trim();
    if (!phone) throw createError(400, "No phone number available for this payment");
    const body = String(req.body.body || "").trim();
    if (!body) throw createError(400, "Message body is required");
    await sendAdHocSms({ businessId: business, phone, body, templateKey: "carwash_payment_manual" });
    res.json({ success: true, message: "SMS sent" });
  } catch (err) {
    next(err);
  }
};

// ─── M-Pesa STK Push ──────────────────────────────────────────────────────────
export const initiateStkPush = async (req, res, next) => {
  try {
    const { phone, amount, jobId } = req.body;
    const normalised = String(phone || "").replace(/^\+/, "").replace(/^0/, "254");
    if (!/^254[0-9]{9}$/.test(normalised)) {
      return next(createError(400, "Invalid phone number. Use format 07XXXXXXXX or 2547XXXXXXXX"));
    }
    if (!amount || Number(amount) <= 0) return next(createError(400, "Amount must be greater than zero"));
    if (!jobId) return next(createError(400, "jobId is required for STK push"));

    const business = resolveActiveBusinessId(req);
    const job = await CarWashJob.findOne({ _id: jobId, business }).lean();
    if (!job) return next(createError(404, "Job not found"));

    const company = await Company.findById(business).select("paymentIntegration").lean();
    const configs = getRawMpesaPaybillConfigs(company?.paymentIntegration);
    let config = getPrimaryMpesaPaybillConfig(configs);
    // Use the branch's own paybill when available
    if (job.branch) {
      const branchDoc = await CarWashBranch.findById(job.branch).select("mpesaShortCode").lean();
      const branchCode = String(branchDoc?.mpesaShortCode || "").trim();
      if (branchCode) {
        const branchConfig = configs.find((c) => String(c?.shortCode || "").trim() === branchCode);
        if (branchConfig) config = branchConfig;
      }
    }
    if (!config?.consumerKey || !config?.consumerSecret || !config?.shortCode || !config?.passkey) {
      return next(createError(400, "M-Pesa credentials not configured for this business. Set them up in Setup → M-Pesa."));
    }

    // STK idempotency guard: prevent duplicate prompts for the same job within 60 s
    const recentPending = await CarWashMpesaNotification.findOne({
      business,
      matchedJob: job._id,
      status: "stk_pending",
      createdAt: { $gte: new Date(Date.now() - 60_000) },
    }).lean();
    if (recentPending) {
      return res.status(409).json({ success: false, message: "An M-Pesa prompt was already sent — please wait for the customer to respond before retrying." });
    }

    // Validate requested amount does not exceed outstanding balance
    const paidRows = await CarWashPayment.aggregate([
      { $match: { business: new mongoose.Types.ObjectId(String(business)), job: job._id } },
      { $group: { _id: "$job", paid: { $sum: { $add: ["$amount", { $ifNull: ["$discountAmount", 0] }] } } } },
    ]);
    const alreadyPaid = Number(paidRows?.[0]?.paid || 0);
    const stkAmount = Math.ceil(Number(amount));
    const outstandingForStkCheck = round2(Math.max(0, netJobPrice(job) - alreadyPaid));
    if (stkAmount > outstandingForStkCheck + 0.009) {
      return next(createError(400, `Amount KES ${stkAmount} exceeds outstanding balance of KES ${outstandingForStkCheck}`));
    }

    const baseURL = process.env.MPESA_ENVIRONMENT === "production"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke";
    const callbackBase = String(process.env.MPESA_CALLBACK_BASE_URL || "").replace(/\/$/, "");
    if (!callbackBase) return next(createError(500, "MPESA_CALLBACK_BASE_URL is not set on the server"));

    const auth = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString("base64");
    const { data: tokenData } = await axios.get(
      `${baseURL}/oauth/v1/generate?grant_type=client_credentials`,
      { headers: { Authorization: `Basic ${auth}` }, timeout: 10000 }
    );

    const timestamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
    const password = Buffer.from(`${config.shortCode}${config.passkey}${timestamp}`).toString("base64");

    const { data: result } = await axios.post(
      `${baseURL}/mpesa/stkpush/v1/processrequest`,
      {
        BusinessShortCode: config.shortCode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: stkAmount,
        PartyA: normalised,
        PartyB: config.shortCode,
        PhoneNumber: normalised,
        CallBackURL: `${callbackBase}/api/carwash/pay/stk-callback/${business}`,
        AccountReference: String(job.plateNumber || "CarWash").slice(0, 12),
        TransactionDesc: "Car Wash",
      },
      { headers: { Authorization: `Bearer ${tokenData.access_token}`, "Content-Type": "application/json" }, timeout: 15000 }
    );

    // Store pending record so callback can match it by CheckoutRequestID
    await CarWashMpesaNotification.create({
      business,
      shortCode: String(config.shortCode),
      transactionCode: result.CheckoutRequestID || "",
      plate: String(job.plateNumber || "").toUpperCase().replace(/[^A-Z0-9]/g, ""),
      amount: stkAmount,
      msisdn: "0" + normalised.slice(3),
      matchedJob: job._id,
      status: "stk_pending",
      resultDesc: "STK push initiated",
      rawPayload: result,
    });

    res.json({
      success: true,
      data: result,
      message: `M-Pesa payment request sent to ${phone}. Ask the customer to check their phone and enter their PIN.`,
    });
  } catch (err) {
    const darajaMsg = err?.response?.data?.errorMessage || err?.response?.data?.ResultDesc;
    if (darajaMsg) return next(createError(400, `M-Pesa: ${darajaMsg}`));
    next(err);
  }
};
