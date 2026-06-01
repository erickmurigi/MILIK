import mongoose from "mongoose";
import Company from "../../../models/Company.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import CarWashJob from "../models/CarWashJob.js";
import CarWashPayment from "../models/CarWashPayment.js";
import CarWashBranch from "../models/CarWashBranch.js";
import { getRawMpesaPaybillConfigs, getPrimaryMpesaPaybillConfig } from "../../../utils/companyModules.js";
import { accrueCommissionForJob, markJobCommissionsPayable } from "../services/commissionService.js";
import { postCarWashPaymentLedger } from "../services/carwashAccountingService.js";
import { autoEnrollPlate, awardLoyaltyStamp, sendPaymentConfirmationSms } from "./loyaltyController.js";

const normalizeText = (v = "") => String(v || "").trim();
const normalizeUpper = (v = "") => normalizeText(v).toUpperCase();
const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;

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
  const price = Number(job.price || 0);
  job.paymentStatus = paidAmount <= 0 ? "unpaid" : paidAmount < price ? "partial" : "paid";
  if (job.paymentStatus === "paid" && job.status !== "cancelled") job.status = "paid";
  else if (job.status === "paid") job.status = "done";
  await job.save();
  return job;
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
  try {
    const shortCode = normalizeText(req.params.shortCode || req.body?.BusinessShortCode || "");
    const resolved = await resolveCarWashCompanyAndConfig(shortCode);

    if (!resolved) {
      return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted – company not matched" });
    }

    const { company, config, branch } = resolved;
    const businessId = company._id;
    const branchId = branch?._id || null;
    const { billRefNumber, amount, msisdn, transTimeRaw, transactionCode } = extractCallbackFields(req.body || {});

    const plate = normalizePlate(billRefNumber);
    if (!plate || amount <= 0) {
      return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted – insufficient data" });
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
      return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted – no open job found for plate" });
    }

    const cashbookId = config?.defaultCashbookAccountId;
    if (!cashbookId || !mongoose.Types.ObjectId.isValid(String(cashbookId))) {
      return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted – cashbook not configured" });
    }
    const cashbook = await ChartOfAccount.findOne({
      _id: cashbookId,
      business: businessId,
      type: "asset",
      isPosting: true,
    }).lean();
    if (!cashbook) {
      return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted – cashbook not found" });
    }

    const totals = await CarWashPayment.aggregate([
      { $match: { business: businessId, job: job._id } },
      { $group: { _id: "$job", amount: { $sum: "$amount" } } },
    ]);
    const alreadyPaid = Number(totals?.[0]?.amount || 0);
    const outstanding = Math.max(Number(job.price || 0) - alreadyPaid, 0);
    if (outstanding <= 0) {
      return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted – job already fully paid" });
    }

    const paidAmount = Math.min(amount, outstanding);
    // Safaricom sends MSISDN as 2547XXXXXXXX — normalise to 07XXXXXXXX
    const normalizedMsisdn = msisdn
      ? msisdn.replace(/\D/g, "").replace(/^254/, "0") || null
      : null;

    const payment = await CarWashPayment.create({
      business: businessId,
      branch: branchId,
      job: job._id,
      amount: paidAmount,
      method: "mpesa",
      cashbookAccount: cashbook._id,
      reference: transactionCode || "",
      receivedFromPhone: normalizedMsisdn,
      paymentDate: parseMpesaDate(transTimeRaw),
    });

    if (branchId && !job.branch) {
      await CarWashJob.updateOne({ _id: job._id, business: businessId }, { branch: branchId });
    }

    // Enroll the plate with the M-Pesa number BEFORE awarding the stamp.
    // - New plate → creates customer with this phone + creates loyalty card
    // - Returning plate with no phone → updates their customer record with this phone
    // - Returning plate with a different phone → leaves their registered number intact
    await autoEnrollPlate({
      business: businessId,
      plate: job.plateNumber,
      customerName: job.customerName,
      phone: normalizedMsisdn,
    }).catch((err) => console.error('[CW M-Pesa] autoEnroll failed:', err?.message));

    const updatedJob = await refreshJobPaymentStatus(businessId, job._id);
    await postCarWashPaymentLedger({ businessId, payment, cashbookAccountId: cashbook._id, job: updatedJob || job, userId: null });
    if (updatedJob) {
      await accrueCommissionForJob({ req: null, job: updatedJob });
      if (updatedJob.paymentStatus === "paid") {
        await markJobCommissionsPayable({ business: businessId, jobId: updatedJob._id });
        // Both SMS go to the M-Pesa payer's number — they paid, they get notified.
        await awardLoyaltyStamp({ business: businessId, job: updatedJob, overridePhone: normalizedMsisdn });
        await sendPaymentConfirmationSms({ business: businessId, job: updatedJob, amount: paidAmount, overridePhone: normalizedMsisdn });
      }
    }

    return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (err) {
    console.error("[CarWash M-Pesa] Callback error:", err?.message || err);
    return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  }
};
