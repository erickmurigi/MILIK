import { createError } from "../../../utils/error.js";
import mongoose from "mongoose";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import CarWashJob from "../models/CarWashJob.js";
import CarWashPayment from "../models/CarWashPayment.js";
import CarWashCustomer from "../models/CarWashCustomer.js";
import { currentUserId, escapeRegex, netJobPrice, parseDateRange, resolveActiveBusinessId, resolveActiveBranchId } from "../services/businessScope.js";
import { accrueCommissionForJob, buildPaidLineSet, handleJobPaymentStatusAfterPaymentChange, markJobCommissionsPayable } from "../services/commissionService.js";
import { awardLoyaltyStamp, revokeStampForJob, sendPaymentConfirmationSms } from "./loyaltyController.js";
import { sendAdHocSms } from "../../../services/communicationService.js";
import mpesaService from "../../../services/mpesaService.js";
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
  if (job.paymentStatus === "paid" && job.status !== "cancelled") {
    job.status = "paid";
  } else if (job.status === "paid") {
    job.status = "done";
  }
  await job.save();
  return job;
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
      paymentDate: req.body.paymentDate ? new Date(req.body.paymentDate) : new Date(),
      receivedBy: userId,
      createdBy: userId,
      updatedBy: userId,
    });
    const updatedJob = await refreshJobPaymentStatus(business, job._id);

    // Persist M-Pesa payer phone to the job + loyalty customer (enables SMS button + loyalty lookup)
    if (receivedFromPhone) {
      if (!updatedJob.phone) {
        await CarWashJob.updateOne({ _id: updatedJob._id, business }, { $set: { phone: receivedFromPhone } });
        updatedJob.phone = receivedFromPhone;
      }
      if (updatedJob.plateNumber) {
        await CarWashCustomer.updateOne(
          { business, plates: updatedJob.plateNumber, $or: [{ phone: null }, { phone: "" }] },
          { $set: { phone: receivedFromPhone } }
        ).catch(() => {});
      }
    }

    // Build allocation: highest-price line paid first for commission recognition.
    // When job is fully paid, paidLineSet is null (all lines recognised).
    const totalEffectivePaid = round2(
      (await CarWashPayment.aggregate([
        { $match: { business: job.business, job: job._id } },
        ...effectivePaidAggregation,
      ]))?.[0]?.paid || 0
    );
    const serviceLines = Array.isArray(updatedJob.serviceLines) && updatedJob.serviceLines.length
      ? updatedJob.serviceLines
      : [{ serviceName: updatedJob.serviceName || "", price: Number(updatedJob.price || 0) }];
    const paidLineSet = updatedJob.paymentStatus === "paid"
      ? null
      : buildPaidLineSet(serviceLines, totalEffectivePaid);

    await accrueCommissionForJob({ req, job: updatedJob, paidLineSet });

    if (updatedJob.paymentStatus === "paid") {
      await markJobCommissionsPayable({ business, jobId: updatedJob._id });
      awardLoyaltyStamp({ business, job: updatedJob, overridePhone: receivedFromPhone || null })
        .catch((err) => console.error("[CW Loyalty] Stamp (payment) failed job=%s: %s", updatedJob.jobNumber, err?.message || err));
    }

    // Payment confirmation SMS fires on every payment — partial or full.
    sendPaymentConfirmationSms({ business, job: updatedJob, amount, overridePhone: receivedFromPhone });
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
    const willRemainPaid = paidAfterDelete >= Number(jobBeforeDelete.price || 0);
    if (!willRemainPaid) {
      await handleJobPaymentStatusAfterPaymentChange({
        business,
        job: { ...jobBeforeDelete, paymentStatus: paidAfterDelete <= 0 ? "unpaid" : "partial" },
        checkOnly: true,
      });
    }

    await reverseCarWashPaymentLedger({ businessId: business, paymentId: payment._id, req });
    await revokeStampForJob({ business, jobId: jobBeforeDelete._id, plate: jobBeforeDelete.plateNumber });
    await payment.deleteOne();
    const job = await refreshJobPaymentStatus(business, payment.job);
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
    if (!mpesaService.isConfigured()) {
      return next(createError(400, "M-Pesa STK Push is not configured on this server. Ensure MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, and MPESA_PASSKEY are set."));
    }

    const { phone, amount, jobId, accountRef } = req.body;
    const normalised = String(phone || "").replace(/^\+/, "").replace(/^0/, "254");
    if (!/^254[0-9]{9}$/.test(normalised)) {
      return next(createError(400, "Invalid phone number. Use format 07XXXXXXXX or 2547XXXXXXXX"));
    }
    if (!amount || Number(amount) <= 0) return next(createError(400, "Amount must be greater than zero"));

    const business = resolveActiveBusinessId(req);
    const callbackUrl = `${process.env.APP_URL || "https://api.milik.co.ke"}/api/carwash/mpesa/confirmation/${business}`;

    const result = await mpesaService.stkPush({
      phone: normalised,
      amount: Number(amount),
      accountRef: accountRef || (jobId ? `JOB-${jobId.slice(-6)}` : "CarWash"),
      description: "Car Wash Payment",
      callbackUrl,
    });

    res.json({
      success: true,
      data: result,
      message: `M-Pesa payment request sent to ${phone}. Ask the customer to check their phone and enter their PIN.`,
    });
  } catch (err) {
    // Daraja errors have helpful messages in err.response.data
    const darajaMsg = err?.response?.data?.errorMessage || err?.response?.data?.ResultDesc;
    if (darajaMsg) return next(createError(400, `M-Pesa: ${darajaMsg}`));
    next(err);
  }
};
