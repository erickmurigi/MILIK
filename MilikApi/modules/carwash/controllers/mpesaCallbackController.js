import mongoose from "mongoose";
import axios from "axios";
import Company from "../../../models/Company.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import CarWashJob from "../models/CarWashJob.js";
import CarWashPayment from "../models/CarWashPayment.js";
import CarWashBranch from "../models/CarWashBranch.js";
import CarWashMpesaNotification from "../models/CarWashMpesaNotification.js";
import CarWashCustomer from "../models/CarWashCustomer.js";
import { getRawMpesaPaybillConfigs, getPrimaryMpesaPaybillConfig } from "../../../utils/companyModules.js";
import { accrueCommissionForJob, markJobCommissionsPayable } from "../services/commissionService.js";
import { postCarWashPaymentLedger } from "../services/carwashAccountingService.js";
import { autoEnrollPlate, awardLoyaltyStamp, sendPaymentConfirmationSms } from "./loyaltyController.js";

const normalizeText = (v = "") => String(v || "").trim();
const normalizeUpper = (v = "") => normalizeText(v).toUpperCase();
const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
const netJobPrice = (job) => Math.max(0, Number(job?.price || 0) - Number(job?.discountAmount || 0));

// Strip everything except letters and digits, then uppercase.
// Handles: "kca123a", "KCA 123A", "kca-123a", "KCA.123A", "k c a 1 2 3 a", etc.
const normalizePlate = (v = "") =>
  normalizeUpper(v).replace(/[^A-Z0-9]/g, "");

// Build a regex that matches the normalized plate whether the DB stores it with or
// without separators (spaces, hyphens, dots) and regardless of case.
// e.g. normalizePlate("kca-123a") → "KCA123A"
//      buildPlateRegex("KCA123A") → /^K[^A-Z0-9]*C[^A-Z0-9]*A[^A-Z0-9]*1[^A-Z0-9]*2[^A-Z0-9]*3[^A-Z0-9]*A$/i
const buildPlateRegex = (plate = "") =>
  new RegExp(
    `^${plate
      .split("")
      .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[^A-Z0-9]*")}$`,
    "i"
  );

const parseMpesaDate = (raw = "") => {
  const text = normalizeText(raw);
  if (!text) return new Date();
  if (/^\d{14}$/.test(text)) {
    const dt = new Date(
      Number(text.slice(0, 4)),
      Number(text.slice(4, 6)) - 1,
      Number(text.slice(6, 8)),
      Number(text.slice(8, 10)),
      Number(text.slice(10, 12)),
      Number(text.slice(12, 14))
    );
    return Number.isNaN(dt.getTime()) ? new Date() : dt;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const extractCallbackFields = (payload = {}) => {
  const body = payload?.Body?.stkCallback || payload?.Body || payload || {};
  const metadataItems = Array.isArray(body?.CallbackMetadata?.Item) ? body.CallbackMetadata.Item : [];
  const meta = new Map(metadataItems.map((item) => [String(item?.Name || ""), item?.Value]));

  const senderName = [
    normalizeText(payload.FirstName  || body.FirstName  || ""),
    normalizeText(payload.MiddleName || body.MiddleName || ""),
    normalizeText(payload.LastName   || body.LastName   || ""),
  ].filter(Boolean).join(" ");

  return {
    transactionCode: normalizeText(
      payload.TransID || payload.TransId || meta.get("MpesaReceiptNumber") || body?.CheckoutRequestID || ""
    ),
    billRefNumber: normalizeText(
      payload.BillRefNumber || payload.BillRefNo || payload.AccountReference ||
      meta.get("BillRefNumber") || meta.get("AccountReference") || ""
    ),
    amount: round2(Number(payload.TransAmount || payload.Amount || meta.get("Amount") || 0)),
    msisdn: normalizeText(payload.MSISDN || payload.Msisdn || meta.get("MSISDN") || ""),
    senderName,
    transTimeRaw: normalizeText(payload.TransTime || payload.TransactionTime || meta.get("TransactionDate") || ""),
  };
};

const resolveCarWashCompanyAndConfig = async (shortCode = "") => {
  const code = normalizeText(shortCode);
  if (!code) return null;

  const company = await Company.findOne({
    $or: [
      { "paymentIntegration.mpesaPaybills.shortCode": code },
      { "paymentIntegration.mpesaPaybill.shortCode": code },
    ],
    "modules.carwash": true,
  }).lean();

  if (!company) return null;

  const configs = getRawMpesaPaybillConfigs(company?.paymentIntegration || {});
  const config =
    configs.find((item) => normalizeText(item?.shortCode) === code) ||
    getPrimaryMpesaPaybillConfig(configs);

  if (!config) return null;

  const branch = await CarWashBranch.findOne({ business: company._id, mpesaShortCode: code, active: true }).lean();

  return { company, config, branch: branch || null };
};

const refreshJobPaymentStatus = async (business, jobId) => {
  const job = await CarWashJob.findOne({ _id: jobId, business });
  if (!job) return null;

  const totals = await CarWashPayment.aggregate([
    { $match: { business: job.business, job: job._id } },
    { $group: { _id: "$job", amount: { $sum: "$amount" } } },
  ]);
  const paidAmount = Number(totals?.[0]?.amount || 0);
  const price = netJobPrice(job);
  job.paymentStatus = paidAmount <= 0 ? "unpaid" : paidAmount < price ? "partial" : "paid";
  if (job.paymentStatus === "paid" && job.status !== "cancelled") {
    job.status = "paid";
  } else if (job.paymentStatus === "partial" && !["cancelled", "paid", "done"].includes(job.status)) {
    job.status = "done";
  } else if (job.status === "paid" && job.paymentStatus !== "paid") {
    job.status = "done";
  }
  await job.save();
  return job;
};

// ─── Safaricom MSISDN normalisation (shared) ──────────────────────────────────
const normalizeMsisdn = (raw = "") => {
  const _digits = String(raw || "").replace(/\D/g, "");
  if (_digits.startsWith("254") && _digits.length === 12) return "0" + _digits.slice(3);
  if (_digits.startsWith("0")   && _digits.length === 10) return _digits;
  if (_digits.length === 9      && /^[17]/.test(_digits)) return "0" + _digits;
  return null;
};

// ─── Transaction Status Query — fetches actual payer phone from Safaricom ─────
const MPESA_BASE_URL = process.env.MPESA_ENVIRONMENT === "production"
  ? "https://api.safaricom.co.ke"
  : "https://sandbox.safaricom.co.ke";

const getMpesaAccessToken = async (consumerKey, consumerSecret) => {
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  const { data } = await axios.get(`${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
    timeout: 10000,
  });
  return data.access_token;
};

const triggerTransactionStatusQuery = async ({ config, transId, businessId, notifId }) => {
  try {
    const { consumerKey, consumerSecret, shortCode, initiatorName, securityCredential } = config;
    if (!initiatorName || !securityCredential || !consumerKey || !consumerSecret) return;

    const token = await getMpesaAccessToken(consumerKey, consumerSecret);
    const apiBase = normalizeText(process.env.MPESA_CALLBACK_BASE_URL || "").replace(/\/$/, "");
    if (!apiBase) { console.warn("[TxnStatus] MPESA_CALLBACK_BASE_URL not set — skipping query"); return; }

    await axios.post(
      `${MPESA_BASE_URL}/mpesa/transactionstatus/v1/queryresult`,
      {
        Initiator:          initiatorName,
        SecurityCredential: securityCredential,
        CommandID:          "TransactionStatusQuery",
        TransactionID:      transId,
        PartyA:             shortCode,
        IdentifierType:     "4",
        ResultURL:          `${apiBase}/api/carwash/pay/txn-result`,
        QueueTimeOutURL:    `${apiBase}/api/carwash/pay/txn-result`,
        Remarks:            "Payment verification",
        Occasion:           "",
      },
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, timeout: 15000 }
    );
    console.log(`[TxnStatus] Query fired for TransID=${transId} notif=${notifId}`);
  } catch (err) {
    console.error("[TxnStatus] Query failed:", err?.response?.data || err?.message || err);
  }
};

export const handleTransactionStatusResult = async (req, res) => {
  // Acknowledge immediately — processing is async
  res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  try {
    const result = req.body?.Result;
    if (!result || Number(result.ResultCode) !== 0) return;

    const transId = normalizeText(result.TransactionID || "");
    if (!transId) return;

    // Extract DebitPartyName — format "254712345678 - JOHN DOE"
    const params = Array.isArray(result.ResultParameters?.ResultParameter)
      ? result.ResultParameters.ResultParameter
      : [];
    const get = (key) => params.find((p) => normalizeText(p?.Key) === key)?.Value || "";
    const debitPartyName = normalizeText(String(get("DebitPartyName")));
    if (!debitPartyName) return;

    const phoneRaw = debitPartyName.split(" - ")[0].trim();
    const phone = normalizeMsisdn(phoneRaw);
    if (!phone) return;

    // Find the notification for this transaction
    const notif = await CarWashMpesaNotification.findOne({ transactionCode: transId });
    if (!notif) return;

    const hadPhone = Boolean(notif.msisdn);

    // Update notification with real phone
    if (!hadPhone) {
      await CarWashMpesaNotification.updateOne({ _id: notif._id }, { $set: { msisdn: phone } });
    }

    if (!notif.matchedJob) return;

    const job = await CarWashJob.findOne({ _id: notif.matchedJob, business: notif.business });
    if (!job) return;

    // Update job phone
    await CarWashJob.updateOne({ _id: job._id, business: notif.business }, { $set: { phone } });

    // Update customer phone
    CarWashCustomer.updateOne(
      { business: notif.business, plates: normalizePlate(job.plateNumber) },
      { $set: { phone } }
    ).catch(() => {});

    // Send SMS only if the confirmation callback had no valid phone (to avoid double-SMS)
    if (!hadPhone) {
      const payment = notif.matchedPayment
        ? await CarWashPayment.findById(notif.matchedPayment).lean()
        : null;
      if (payment) {
        const totals = await CarWashPayment.aggregate([
          { $match: { business: notif.business, job: job._id } },
          { $group: { _id: null, amount: { $sum: "$amount" } } },
        ]);
        const totalPaid = Number(totals?.[0]?.amount || 0);
        const remaining = round2(Math.max(0, netJobPrice(job) - totalPaid));
        await sendPaymentConfirmationSms({
          business: notif.business,
          job: { ...job.toObject(), phone },
          amount: payment.amount,
          remaining,
          overridePhone: phone,
        });
      }
    }

    console.log(`[TxnStatus] Phone ${phone} applied for TransID=${transId} job=${job.jobNumber}`);
  } catch (err) {
    console.error("[TxnStatus] Result handler error:", err?.message || err);
  }
};

export const validateCarWashCallback = async (req, res) => {
  try {
    const shortCode = normalizeText(req.params.shortCode || req.body?.BusinessShortCode || "");
    const resolved = await resolveCarWashCompanyAndConfig(shortCode);

    if (!resolved) {
      return res.status(200).json({ ResultCode: 1, ResultDesc: "Rejected – service not found" });
    }

    // If the company has opted out of validation (responseType = "Completed"),
    // accept blindly — they don't want Safaricom to wait on a DB round-trip.
    const responseType = normalizeText(resolved.config?.responseType || "Completed");
    if (responseType === "Completed") {
      return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    // Validate: check the BillRefNumber (plate) maps to an open unpaid job.
    const billRef = normalizeText(
      req.body?.BillRefNumber || req.body?.BillRefNo || req.body?.AccountReference || ""
    );
    const plate = normalizePlate(billRef);

    if (!plate) {
      return res.status(200).json({
        ResultCode: 1,
        ResultDesc: "Enter your plate number as account reference (e.g. KCA123A or kca123a). Spaces and hyphens are ignored.",
      });
    }

    const openJob = await CarWashJob.findOne({
      business: resolved.company._id,
      plateNumber: buildPlateRegex(plate),
      status: { $nin: ["cancelled", "paid"] },
      paymentStatus: { $in: ["unpaid", "partial"] },
    }).lean();

    if (!openJob) {
      return res.status(200).json({
        ResultCode: 1,
        ResultDesc: `No open job found for plate ${plate}. Confirm your plate with the attendant, then try again.`,
      });
    }

    return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch {
    // On any error always accept — Safaricom requires a response and we can't
    // block a payment due to a server fault. Confirmation handler will handle edge cases.
    return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  }
};

export const confirmCarWashCallback = async (req, res) => {
  const rawPayload = req.body || {};
  let notifBase = { shortCode: normalizeText(req.params.shortCode || rawPayload?.BusinessShortCode || ""), rawPayload };

  const saveNotif = (fields) =>
    CarWashMpesaNotification.create({ ...notifBase, ...fields }).catch((e) =>
      console.error("[CW M-Pesa] Notification save failed:", e?.message)
    );

  try {
    const shortCode = notifBase.shortCode;
    const resolved = await resolveCarWashCompanyAndConfig(shortCode);

    if (!resolved) {
      await saveNotif({ status: "error", resultCode: 0, resultDesc: "Accepted – company not matched" });
      return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted – company not matched" });
    }

    const { company, config, branch } = resolved;
    const businessId = company._id;
    const branchId = branch?._id || null;
    notifBase = { ...notifBase, business: businessId, branch: branchId };

    const { billRefNumber, amount, msisdn, senderName, transTimeRaw, transactionCode } = extractCallbackFields(rawPayload);
    const plate = normalizePlate(billRefNumber);
    const _digits = msisdn.replace(/\D/g, "");
    let _local = "";
    if      (_digits.startsWith("254") && _digits.length === 12) _local = "0" + _digits.slice(3);
    else if (_digits.startsWith("0")   && _digits.length === 10) _local = _digits;
    else if (_digits.length === 9      && /^[17]/.test(_digits)) _local = "0" + _digits;
    const normalizedMsisdn = _local || null;
    const transDate = parseMpesaDate(transTimeRaw);

    notifBase = { ...notifBase, transactionCode, billRefNumber, plate, amount, msisdn: normalizedMsisdn || "", senderName, transactionDate: transDate };

    if (!plate || amount <= 0) {
      await saveNotif({ status: "error", resultCode: 0, resultDesc: "Accepted – insufficient data" });
      return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted – insufficient data" });
    }

    // Duplicate check — same transaction code already processed
    if (transactionCode) {
      const dup = await CarWashMpesaNotification.findOne({ transactionCode, status: "matched" }).lean();
      if (dup) {
        await saveNotif({ status: "duplicate", resultCode: 0, resultDesc: "Duplicate transaction" });
        return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted – duplicate" });
      }
    }

    const job = await CarWashJob.findOne({
      business: businessId,
      plateNumber: buildPlateRegex(plate),
      status: { $nin: ["cancelled", "paid"] },
      paymentStatus: { $in: ["unpaid", "partial"] },
    })
      .sort({ createdAt: -1 })
      .lean();

    if (!job) {
      await saveNotif({ status: "unmatched", resultCode: 0, resultDesc: `No open job found for plate ${plate}` });
      return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted – no open job found for plate" });
    }

    const cashbookId = config?.defaultCashbookAccountId;
    if (!cashbookId || !mongoose.Types.ObjectId.isValid(String(cashbookId))) {
      await saveNotif({ matchedJob: job._id, status: "error", resultCode: 0, resultDesc: "Cashbook not configured" });
      return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted – cashbook not configured" });
    }
    const cashbook = await ChartOfAccount.findOne({ _id: cashbookId, business: businessId, type: "asset", isPosting: true }).lean();
    if (!cashbook) {
      await saveNotif({ matchedJob: job._id, status: "error", resultCode: 0, resultDesc: "Cashbook not found" });
      return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted – cashbook not found" });
    }

    const totals = await CarWashPayment.aggregate([
      { $match: { business: businessId, job: job._id } },
      { $group: { _id: "$job", amount: { $sum: "$amount" } } },
    ]);
    const alreadyPaid = round2(totals?.[0]?.amount || 0);
    const outstanding = round2(Math.max(round2(netJobPrice(job)) - alreadyPaid, 0));
    if (outstanding <= 0) {
      await saveNotif({ matchedJob: job._id, status: "duplicate", resultCode: 0, resultDesc: "Job already fully paid" });
      return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted – job already fully paid" });
    }

    const paidAmount = round2(Math.min(amount, outstanding));
    const payment = await CarWashPayment.create({
      business: businessId,
      branch: branchId,
      job: job._id,
      amount: paidAmount,
      method: "mpesa",
      cashbookAccount: cashbook._id,
      reference: transactionCode || "",
      receivedFromPhone: normalizedMsisdn,
      paymentDate: transDate,
    });

    // Save matched notification immediately so it appears in the UI
    const savedNotif = await saveNotif({ matchedJob: job._id, matchedPayment: payment._id, status: "matched", resultCode: 0, resultDesc: "Payment matched and recorded" });

    // If MSISDN was hashed, fire Transaction Status Query to retrieve actual payer phone async
    if (!normalizedMsisdn && transactionCode && config?.initiatorName && config?.securityCredential) {
      triggerTransactionStatusQuery({ config, transId: transactionCode, businessId, notifId: savedNotif?._id }).catch(() => {});
    }

    const jobUpdates = { ...(branchId && !job.branch ? { branch: branchId } : {}) };
    // M-Pesa number is Safaricom-verified — always overwrite job & customer phone
    if (normalizedMsisdn) jobUpdates.phone = normalizedMsisdn;
    if (Object.keys(jobUpdates).length) {
      await CarWashJob.updateOne({ _id: job._id, business: businessId }, { $set: jobUpdates });
    }
    if (normalizedMsisdn) {
      CarWashCustomer.updateOne(
        { business: businessId, plates: normalizePlate(job.plateNumber) },
        { $set: { phone: normalizedMsisdn } }
      ).catch(() => {});
    }

    await autoEnrollPlate({ business: businessId, plate: job.plateNumber, customerName: job.customerName, phone: normalizedMsisdn })
      .catch((err) => console.error('[CW M-Pesa] autoEnroll failed:', err?.message));

    const updatedJob = await refreshJobPaymentStatus(businessId, job._id);
    await postCarWashPaymentLedger({ businessId, payment, cashbookAccountId: cashbook._id, job: updatedJob || job, userId: null });
    if (updatedJob) {
      await accrueCommissionForJob({ req: null, job: updatedJob });
      const remainingBalance = round2(Math.max(0, outstanding - paidAmount));
      await sendPaymentConfirmationSms({ business: businessId, job: updatedJob, amount: paidAmount, remaining: remainingBalance, overridePhone: normalizedMsisdn });
      if (updatedJob.paymentStatus === "paid") {
        await markJobCommissionsPayable({ business: businessId, jobId: updatedJob._id });
      }
      if (["paid", "partial"].includes(updatedJob.paymentStatus)) {
        await awardLoyaltyStamp({ business: businessId, job: updatedJob, overridePhone: normalizedMsisdn });
      }
    }

    return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (err) {
    console.error("[CarWash M-Pesa] Callback error:", err?.message || err);
    await saveNotif({ status: "error", resultCode: 0, resultDesc: err?.message || "Server error" }).catch(() => {});
    return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  }
};

// ─── List notifications (authenticated) ──────────────────────────────────────
export const listMpesaNotifications = async (req, res, next) => {
  try {
    const { resolveActiveBusinessId, parseDateRange } = await import("../services/businessScope.js");
    const business = resolveActiveBusinessId(req);

    const filter = { business };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.plate) {
      const p = normalizePlate(req.query.plate);
      if (p) filter.plate = buildPlateRegex(p);
    }
    if (req.query.date) {
      const { start, end } = parseDateRange(req.query.date);
      filter.createdAt = { $gte: start, $lt: end };
    } else if (req.query.dateFrom || req.query.dateTo) {
      filter.createdAt = {};
      if (req.query.dateFrom) { const d = new Date(req.query.dateFrom); d.setUTCHours(0,0,0,0); filter.createdAt.$gte = d; }
      if (req.query.dateTo)   { const d = new Date(req.query.dateTo);   d.setUTCHours(23,59,59,999); filter.createdAt.$lte = d; }
    }

    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const page  = Math.max(Number(req.query.page || 1), 1);
    const skip  = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
      CarWashMpesaNotification.find(filter)
        .populate("matchedJob",     "jobNumber plateNumber customerName status paymentStatus price")
        .populate("matchedPayment", "amount reference paymentDate")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      CarWashMpesaNotification.countDocuments(filter),
    ]);

    const summary = await CarWashMpesaNotification.aggregate([
      { $match: { business: new mongoose.Types.ObjectId(String(business)) } },
      { $group: { _id: "$status", count: { $sum: 1 }, totalAmount: { $sum: "$amount" } } },
    ]);

    res.json({ success: true, data: { notifications, pagination: { page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) }, summary } });
  } catch (error) {
    next(error);
  }
};

// ─── Reassign / correct a wrong-account notification ─────────────────────────
export const reassignMpesaNotification = async (req, res, next) => {
  try {
    const { resolveActiveBusinessId } = await import("../services/businessScope.js");
    const business = resolveActiveBusinessId(req);
    const { id } = req.params;
    const { jobId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(jobId)) {
      return res.status(400).json({ success: false, message: "Invalid notification or job ID" });
    }

    const notif = await CarWashMpesaNotification.findOne({ _id: id, business });
    if (!notif) return res.status(404).json({ success: false, message: "Notification not found" });
    if (notif.status === "matched") {
      return res.status(409).json({ success: false, message: "Notification is already matched to a job" });
    }

    const job = await CarWashJob.findOne({ _id: jobId, business, status: { $nin: ["cancelled"] } }).lean();
    if (!job) return res.status(404).json({ success: false, message: "Job not found or cancelled" });

    // Resolve cashbook from the company's mpesa config
    const company = await Company.findById(business).lean();
    const configs = getRawMpesaPaybillConfigs(company?.paymentIntegration || {});
    const config = configs.find((c) => normalizeText(c?.shortCode) === normalizeText(notif.shortCode)) || getPrimaryMpesaPaybillConfig(configs);
    const cashbookId = config?.defaultCashbookAccountId;
    if (!cashbookId || !mongoose.Types.ObjectId.isValid(String(cashbookId))) {
      return res.status(422).json({ success: false, message: "Cashbook not configured on M-Pesa paybill settings" });
    }
    const cashbook = await ChartOfAccount.findOne({ _id: cashbookId, business, type: "asset", isPosting: true }).lean();
    if (!cashbook) return res.status(422).json({ success: false, message: "Cashbook account not found" });

    // Check if fully paid already
    const totals = await CarWashPayment.aggregate([
      { $match: { business: job.business, job: job._id } },
      { $group: { _id: "$job", amount: { $sum: "$amount" } } },
    ]);
    const alreadyPaid = round2(totals?.[0]?.amount || 0);
    const outstanding = round2(Math.max(round2(netJobPrice(job)) - alreadyPaid, 0));
    if (outstanding <= 0) {
      return res.status(409).json({ success: false, message: "This job is already fully paid" });
    }

    const paidAmount = round2(Math.min(notif.amount, outstanding));
    const branch = job.branch || notif.branch || null;
    const normalizedMsisdn = notif.msisdn || null;

    const payment = await CarWashPayment.create({
      business,
      branch,
      job: job._id,
      amount: paidAmount,
      method: "mpesa",
      cashbookAccount: cashbook._id,
      reference: notif.transactionCode || "",
      receivedFromPhone: normalizedMsisdn,
      paymentDate: notif.transactionDate || notif.createdAt,
      notes: `Manually assigned from M-Pesa notification (original ref: ${notif.billRefNumber})`,
    });

    notif.status = "matched";
    notif.matchedJob = job._id;
    notif.matchedPayment = payment._id;
    notif.resultDesc = `Manually assigned to job ${job.jobNumber || job._id} by admin`;
    notif.notes = `Corrected — original account reference: ${notif.billRefNumber}`;
    await notif.save();

    const updatedJob = await refreshJobPaymentStatus(business, job._id);
    await postCarWashPaymentLedger({ businessId: business, payment, cashbookAccountId: cashbook._id, job: updatedJob || job, userId: req.user?._id || null });

    // Update job + customer phone with payer's verified M-Pesa number
    if (normalizedMsisdn) {
      CarWashJob.updateOne({ _id: job._id, business }, { $set: { phone: normalizedMsisdn } }).catch(() => {});
      CarWashCustomer.updateOne(
        { business, plates: normalizePlate(job.plateNumber) },
        { $set: { phone: normalizedMsisdn } }
      ).catch(() => {});
    }

    if (updatedJob) {
      await accrueCommissionForJob({ req, job: updatedJob });
      const reassignRemaining = round2(Math.max(0, outstanding - paidAmount));
      await sendPaymentConfirmationSms({ business, job: updatedJob, amount: paidAmount, remaining: reassignRemaining, overridePhone: normalizedMsisdn });
      if (updatedJob.paymentStatus === "paid") {
        await markJobCommissionsPayable({ business, jobId: updatedJob._id });
      }
      if (["paid", "partial"].includes(updatedJob.paymentStatus)) {
        await awardLoyaltyStamp({ business, job: updatedJob, overridePhone: normalizedMsisdn });
      }
    }

    const populated = await CarWashMpesaNotification.findById(notif._id)
      .populate("matchedJob",     "jobNumber plateNumber customerName status paymentStatus price")
      .populate("matchedPayment", "amount reference paymentDate")
      .lean();

    res.json({ success: true, data: { notification: populated } });
  } catch (error) {
    next(error);
  }
};

// ─── Register C2B validation/confirmation URLs with Safaricom ─────────────────
export const registerCarWashPaybillUrls = async (req, res, next) => {
  try {
    const { resolveActiveBusinessId } = await import("../services/businessScope.js");
    const business = resolveActiveBusinessId(req);
    const company  = await Company.findById(business).lean();

    const shortCode = normalizeText(req.body?.shortCode);
    if (!shortCode) return res.status(400).json({ success: false, message: "shortCode is required" });

    const configs = getRawMpesaPaybillConfigs(company?.paymentIntegration || {});
    const config  =
      configs.find((c) => normalizeText(c?.shortCode) === shortCode) ||
      getPrimaryMpesaPaybillConfig(configs);

    if (!config) {
      return res.status(404).json({ success: false, message: `No Paybill configuration found for shortCode ${shortCode}` });
    }

    const consumerKey    = normalizeText(config.consumerKey);
    const consumerSecret = normalizeText(config.consumerSecret);
    const responseType   = config.responseType === "Cancelled" ? "Cancelled" : "Completed";

    if (!consumerKey || !consumerSecret) {
      return res.status(422).json({
        success: false,
        message: "Save the Consumer Key and Consumer Secret before registering URLs with Safaricom.",
      });
    }

    // Build public-facing callback base URL
    const envBase  = normalizeText(process.env.MPESA_CALLBACK_BASE_URL || "");
    const reqBase  = `${req.protocol}://${req.get("host")}`;
    const apiBase  = (envBase || reqBase).replace(/\/$/, "");

    const validationURL   = `${apiBase}/api/carwash/pay/validation/${shortCode}`;
    const confirmationURL = `${apiBase}/api/carwash/pay/confirmation/${shortCode}`;

    const safaricomBase = normalizeText(process.env.MPESA_ENVIRONMENT || "production") === "sandbox"
      ? "https://sandbox.safaricom.co.ke"
      : "https://api.safaricom.co.ke";

    // Get access token using the company's own credentials
    let accessToken;
    try {
      const auth     = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
      const tokenRes = await axios.get(`${safaricomBase}/oauth/v1/generate?grant_type=client_credentials`, {
        headers: { Authorization: `Basic ${auth}` },
        timeout: 15000,
      });
      accessToken = tokenRes.data?.access_token;
    } catch (tokenErr) {
      const detail = tokenErr.response?.data?.errorMessage || tokenErr.message;
      return res.status(502).json({
        success: false,
        message: `Failed to authenticate with Safaricom. Verify your Consumer Key and Secret. (${detail})`,
      });
    }

    if (!accessToken) {
      return res.status(502).json({ success: false, message: "No access token returned by Safaricom. Check your credentials." });
    }

    // Register validation and confirmation URLs
    let safaricomResponse;
    try {
      const regRes = await axios.post(
        `${safaricomBase}/mpesa/c2b/v1/registerurl`,
        { ShortCode: shortCode, ResponseType: responseType, ConfirmationURL: confirmationURL, ValidationURL: validationURL },
        { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, timeout: 15000 }
      );
      safaricomResponse = regRes.data;
    } catch (regErr) {
      const detail = regErr.response?.data?.errorMessage || regErr.response?.data?.ResultDesc || regErr.message;
      return res.status(502).json({ success: false, message: `Safaricom rejected the URL registration: ${detail}` });
    }

    res.json({
      success: true,
      message: "Callback URLs registered with Safaricom successfully. Payments will now flow through.",
      data: { validationURL, confirmationURL, safaricomResponse },
    });
  } catch (err) {
    next(err);
  }
};
