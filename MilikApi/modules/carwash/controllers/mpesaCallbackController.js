import mongoose from "mongoose";
import axios from "axios";
import crypto from "crypto";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import Company from "../../../models/Company.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import CarWashJob from "../models/CarWashJob.js";
import CarWashPayment from "../models/CarWashPayment.js";
import CarWashBranch from "../models/CarWashBranch.js";
import CarWashMpesaNotification from "../models/CarWashMpesaNotification.js";
import CarWashCreditAccount from "../models/CarWashCreditAccount.js";
import CarWashAccountTopup from "../models/CarWashAccountTopup.js";
import CarWashCustomer from "../models/CarWashCustomer.js";
import CarWashCustomerCredit from "../models/CarWashCustomerCredit.js";
import { getRawMpesaPaybillConfigs, getPrimaryMpesaPaybillConfig, getRawSmsProfiles, getPrimarySmsProfile } from "../../../utils/companyModules.js";
import { accrueCommissionForJob, markJobCommissionsPayable } from "../services/commissionService.js";
import { postCarWashPaymentLedger, reverseCarWashPaymentLedger, postCarWashTopupLedger, postCarWashCustomerCreditCreationLedger } from "../services/carwashAccountingService.js";
import { autoEnrollPlate, awardLoyaltyStamp, sendPaymentConfirmationSms, sendUnmatchedPaymentSms } from "./loyaltyController.js";
import { sendAdHocSms, sendAdHocSmsToMasked } from "../../../services/communicationService.js";
import { resolveCarWashSmsBody } from "../services/carwashSmsService.js";
import { normalizePlate, buildPlateRegex } from "../utils/plateUtils.js";
import { resolveActiveBusinessId, resolveActiveBranchId, parseDateRange } from "../services/businessScope.js";
import { createError } from "../../../utils/error.js";

const normalizeText = (v = "") => String(v || "").trim();
const normalizeUpper = (v = "") => normalizeText(v).toUpperCase();
const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
const netJobPrice = (job) => Math.max(0, Number(job?.price || 0) - Number(job?.discountAmount || 0));


const parseMpesaDate = (raw = "") => {
  const text = normalizeText(raw);
  if (!text) return new Date();
  if (/^\d{14}$/.test(text)) {
    const year  = Number(text.slice(0, 4));
    const month = Number(text.slice(4, 6));
    const day   = Number(text.slice(6, 8));
    const hour  = Number(text.slice(8, 10));
    const min   = Number(text.slice(10, 12));
    const sec   = Number(text.slice(12, 14));
    // TransTime is EAT (UTC+3) — convert to UTC by subtracting 3 hours
    const dt = new Date(Date.UTC(year, month - 1, day, hour - 3, min, sec));
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
  // Fully-paid ready job → auto-advance to done so it leaves the washboard
  if (job.paymentStatus === "paid" && job.status === "ready") {
    job.status = "done";
  }
  // Rollback only: legacy-paid jobs whose payment is reversed revert to done
  if (job.status === "paid" && job.paymentStatus !== "paid") {
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

const _dir = dirname(fileURLToPath(import.meta.url));
const SAFARICOM_PROD_CERT_PATH = join(_dir, "../certs/safaricom_prod.cer");

const generateSecurityCredential = (password) => {
  const certPath = process.env.SAFARICOM_PROD_CERT_PATH || SAFARICOM_PROD_CERT_PATH;
  if (!existsSync(certPath)) {
    throw new Error(`Safaricom production certificate not found at ${certPath}. Download it from Daraja portal and place it there.`);
  }
  const cert = readFileSync(certPath);
  return crypto.publicEncrypt(
    { key: cert, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(password)
  ).toString("base64");
};

const triggerTransactionStatusQuery = async ({ config, transId, businessId, notifId }) => {
  try {
    const { consumerKey, consumerSecret, shortCode, initiatorName, initiatorPassword, securityCredential: storedCred } = config;
    if (!initiatorName || !consumerKey || !consumerSecret) return;
    if (!storedCred && !initiatorPassword) return;

    // Prefer pre-generated credential; fall back to dynamic generation from password + cert
    let securityCredential = storedCred;
    if (!securityCredential) {
      securityCredential = generateSecurityCredential(initiatorPassword);
    }
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
    const resolvedName = debitPartyName.split(" - ").slice(1).join(" - ").trim() || null;

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

    await CarWashJob.updateOne(
      { _id: job._id, business: notif.business },
      { $set: { phone, ...(resolvedName && { customerName: resolvedName }) } }
    );
    autoEnrollPlate({ business: notif.business, plate: job.plateNumber, customerName: job.customerName, phone, payerName: resolvedName })
      .catch(() => {});

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
        const pendingStampBody = notif.pendingStampSmsBody || null;
        await sendPaymentConfirmationSms({
          business: notif.business,
          job: { ...job.toObject(), phone },
          amount: payment.amount,
          remaining,
          overridePhone: phone,
          payerName: resolvedName,
          loyaltySmsBody: pendingStampBody,
        });
        if (pendingStampBody) {
          CarWashMpesaNotification.updateOne({ _id: notif._id }, { $unset: { pendingStampSmsBody: 1 } }).catch(() => {});
        }
      }
    }

    console.log(`[TxnStatus] Phone ${phone} applied for TransID=${transId} job=${job.jobNumber}`);
  } catch (err) {
    console.error("[TxnStatus] Result handler error:", err?.message || err);
  }
};

// ─── STK Push callback ───────────────────────────────────────────────────────
export const handleStkCallback = async (req, res) => {
  res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  try {
    const businessId = normalizeText(req.params.businessId || "");
    const stkCallback = req.body?.Body?.stkCallback;
    if (!stkCallback || !businessId) return;

    const checkoutRequestId = normalizeText(stkCallback.CheckoutRequestID || "");
    const resultCode = Number(stkCallback.ResultCode);
    if (!checkoutRequestId) return;

    const notif = await CarWashMpesaNotification.findOne({ business: businessId, transactionCode: checkoutRequestId, status: "stk_pending" });
    if (!notif) { console.warn(`[STK] No pending notif for CheckoutRequestID=${checkoutRequestId}`); return; }

    if (resultCode !== 0) {
      await CarWashMpesaNotification.updateOne(
        { _id: notif._id },
        { $set: { status: "error", resultCode, resultDesc: normalizeText(stkCallback.ResultDesc || "Payment cancelled or failed"), rawPayload: req.body } }
      );
      return;
    }

    const items = Array.isArray(stkCallback.CallbackMetadata?.Item) ? stkCallback.CallbackMetadata.Item : [];
    const getMeta = (key) => items.find((i) => normalizeText(i?.Name) === key)?.Value;
    const receiptNumber = normalizeText(String(getMeta("MpesaReceiptNumber") || ""));
    const paidAmount   = round2(Number(getMeta("Amount") || 0));
    const phoneRaw     = String(getMeta("PhoneNumber") || "");
    const transDate    = parseMpesaDate(String(getMeta("TransactionDate") || ""));
    const phone        = normalizeMsisdn(phoneRaw);

    if (!receiptNumber || paidAmount <= 0) return;

    // Duplicate check on the actual receipt
    const dup = await CarWashMpesaNotification.findOne({ transactionCode: receiptNumber, status: "matched" }).lean();
    if (dup) {
      await CarWashMpesaNotification.updateOne({ _id: notif._id }, { $set: { status: "duplicate", transactionCode: receiptNumber, resultDesc: "Duplicate receipt" } });
      return;
    }

    const job = await CarWashJob.findOne({ _id: notif.matchedJob, business: businessId });
    if (!job) return;

    if (job.status === "cancelled") {
      console.warn("[STK] Payment received for cancelled job=%s", job.jobNumber);
      return; // STK caller already got 200 ack above
    }

    const company = await Company.findById(businessId).select("paymentIntegration").lean();
    const config = getPrimaryMpesaPaybillConfig(getRawMpesaPaybillConfigs(company?.paymentIntegration));
    const cashbookId = config?.defaultCashbookAccountId;
    if (!cashbookId || !mongoose.Types.ObjectId.isValid(String(cashbookId))) {
      await CarWashMpesaNotification.updateOne({ _id: notif._id }, { $set: { status: "error", resultDesc: "Cashbook not configured" } });
      return;
    }
    const cashbook = await ChartOfAccount.findOne({ _id: cashbookId, business: businessId, type: "asset", isPosting: true }).lean();
    if (!cashbook) {
      await CarWashMpesaNotification.updateOne({ _id: notif._id }, { $set: { status: "error", resultDesc: "Cashbook not found" } });
      return;
    }

    const totals = await CarWashPayment.aggregate([
      { $match: { business: job.business, job: job._id } },
      { $group: { _id: null, amount: { $sum: "$amount" } } },
    ]);
    const alreadyPaid  = round2(totals?.[0]?.amount || 0);
    const outstanding  = round2(Math.max(round2(netJobPrice(job)) - alreadyPaid, 0));
    if (outstanding <= 0) {
      await CarWashMpesaNotification.updateOne({ _id: notif._id }, { $set: { status: "duplicate", transactionCode: receiptNumber, resultDesc: "Job already fully paid" } });
      return;
    }

    const payAmount = round2(paidAmount);
    const payment = await CarWashPayment.create({
      business: businessId,
      job: job._id,
      amount: payAmount,
      method: "mpesa",
      cashbookAccount: cashbook._id,
      reference: receiptNumber,
      receivedFromPhone: phone,
      paymentDate: transDate,
    });

    await CarWashMpesaNotification.updateOne(
      { _id: notif._id },
      { $set: { status: "matched", transactionCode: receiptNumber, msisdn: phone || notif.msisdn, matchedPayment: payment._id, resultCode: 0, resultDesc: "STK payment recorded", rawPayload: req.body } }
    );

    if (phone) {
      await CarWashJob.updateOne({ _id: job._id, business: businessId }, { $set: { phone } });
    }
    autoEnrollPlate({ business: businessId, plate: job.plateNumber, customerName: job.customerName, phone: phone || null })
      .catch(() => {});

    const updatedJob = await refreshJobPaymentStatus(businessId, job._id);
    await postCarWashPaymentLedger({ businessId, payment, cashbookAccountId: cashbook._id, job: updatedJob || job, userId: null });
    if (updatedJob) {
      await accrueCommissionForJob({ req: null, job: updatedJob });
      const remaining = round2(Math.max(0, outstanding - payAmount));
      let loyaltySmsBody = null;
      if (["paid", "partial"].includes(updatedJob.paymentStatus)) {
        try {
          const stampResult = await awardLoyaltyStamp({ business: businessId, job: updatedJob, overridePhone: phone, suppressSms: true });
          loyaltySmsBody = stampResult?.smsBody || null;
        } catch (err) {
          console.error("[STK] Stamp failed job=%s: %s", updatedJob.jobNumber, err?.message || err);
        }
      }
      await sendPaymentConfirmationSms({ business: businessId, job: updatedJob, amount: payAmount, remaining, overridePhone: phone, loyaltySmsBody });
      if (updatedJob.paymentStatus === "paid") {
        await markJobCommissionsPayable({ business: businessId, jobId: updatedJob._id });
      }
    }
    console.log(`[STK] Recorded receipt=${receiptNumber} job=${job.jobNumber} amount=${payAmount}`);
  } catch (err) {
    console.error("[STK] Callback error:", err?.message || err);
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
  } catch (err) {
    console.error("[CW Validation] Unexpected error: %s", err?.message || err);
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

    const maskedMsisdn = !normalizedMsisdn && msisdn ? msisdn : "";
    notifBase = { ...notifBase, transactionCode, billRefNumber, plate, amount, msisdn: normalizedMsisdn || "", maskedMsisdn, senderName, transactionDate: transDate };

    if (!plate || amount <= 0) {
      await saveNotif({ status: "error", resultCode: 0, resultDesc: "Accepted – insufficient data" });
      return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted – insufficient data" });
    }

    // Reject blank transaction codes — the unique index only protects non-empty references,
    // so a blank code would bypass duplicate detection and could double-create payments.
    if (!transactionCode) {
      await saveNotif({ status: "unmatched", resultCode: 0, resultDesc: "Accepted – no transaction code" });
      return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted – no transaction code" });
    }

    // Duplicate check — same transaction code already processed
    const dup = await CarWashMpesaNotification.findOne({ transactionCode, status: "matched" }).lean();
    if (dup) {
      await saveNotif({ status: "duplicate", resultCode: 0, resultDesc: "Duplicate transaction" });
      return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted – duplicate" });
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
      // If the plate belongs to an active prepaid account, auto-top-up the wallet
      const prepaidAcc = plate ? await CarWashCreditAccount.findOne({
        business: businessId,
        plates: plate,
        status: "active",
        accountType: "prepaid",
      }) : null;

      if (prepaidAcc) {
        await CarWashCreditAccount.updateOne(
          { _id: prepaidAcc._id },
          { $inc: { accountCredit: amount } }
        );

        const cashbookId = config?.defaultCashbookAccountId;
        const cashbook = cashbookId && mongoose.Types.ObjectId.isValid(String(cashbookId))
          ? await ChartOfAccount.findOne({ _id: cashbookId, business: businessId, type: "asset", isPosting: true }).lean()
          : null;

        const topup = await CarWashAccountTopup.create({
          business: businessId,
          account: prepaidAcc._id,
          amount,
          method: "mpesa",
          reference: transactionCode || "",
          cashbookAccount: cashbook?._id || null,
          paymentDate: transDate,
          notes: `Auto top-up via M-Pesa C2B (${senderName || "Unknown payer"})`,
        });

        if (cashbook) {
          postCarWashTopupLedger({ businessId, topup, cashbookAccountId: cashbook._id, userId: null }).catch(() => {});
        }

        await saveNotif({ status: "matched", resultCode: 0, resultDesc: `Auto top-up to prepaid account ${prepaidAcc.accountNumber}` });

        // Send top-up confirmation SMS
        (async () => {
          try {
            const newBalance = round2((prepaidAcc.accountCredit || 0) + amount);
            const body = await resolveCarWashSmsBody(businessId, "carwash_topup_confirmed", {
              payerName:    senderName || "Valued Customer",
              amount:       Number(amount).toLocaleString(),
              balance:      Number(newBalance).toLocaleString(),
              businessName: company.name || "Car Wash",
            });
            if (body) {
              if (normalizedMsisdn) {
                await sendAdHocSms({ businessId, phone: normalizedMsisdn, body, templateKey: "carwash_topup_confirmed" });
              } else if (maskedMsisdn) {
                sendAdHocSmsToMasked({ businessId, maskedNumber: maskedMsisdn, body, templateKey: "carwash_topup_confirmed", recipientName: senderName || "" }).catch(() => {});
              }
            }
          } catch (_err) {}
        })();

        return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted – prepaid wallet topped up" });
      }

      await saveNotif({ status: "unmatched", resultCode: 0, resultDesc: `No open job found for plate ${plate}` });
      sendUnmatchedPaymentSms({ business: businessId, businessName: company.name, senderName, amount, phone: normalizedMsisdn, maskedMsisdn }).catch(() => {});
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

    const paidAmount = round2(amount);
    // Cap the recorded payment at the outstanding amount — excess is routed separately
    const appliedAmount = round2(Math.min(paidAmount, outstanding));
    let payment;
    try {
      payment = await CarWashPayment.create({
        business: businessId,
        branch: branchId,
        job: job._id,
        amount: appliedAmount,
        method: "mpesa",
        cashbookAccount: cashbook._id,
        reference: transactionCode || "",
        receivedFromPhone: normalizedMsisdn,
        paymentDate: transDate,
      });
    } catch (payErr) {
      // E11000 = unique-index violation: same M-Pesa receipt already created a payment
      if (payErr.code === 11000) {
        await saveNotif({ matchedJob: job._id, status: "duplicate", resultCode: 0, resultDesc: "Duplicate receipt — payment already recorded" });
        return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted – duplicate receipt" });
      }
      throw payErr;
    }

    // Save matched notification immediately so it appears in the UI
    const savedNotif = await saveNotif({ matchedJob: job._id, matchedPayment: payment._id, status: "matched", resultCode: 0, resultDesc: "Payment matched and recorded" });

    // If MSISDN was hashed: prefer TSQ (resolves real phone + sends SMS after).
    // Fall back to AT masked-number endpoint only when TSQ is not configured.
    const tsqWillFire = !normalizedMsisdn && transactionCode && config?.initiatorName && (config?.securityCredential || config?.initiatorPassword);
    console.log(`[TxnStatus Check] msisdn=${normalizedMsisdn} txnCode=${transactionCode} initiatorName=${config?.initiatorName || ""} hasCred=${Boolean(config?.securityCredential || config?.initiatorPassword)} hasCallbackBase=${Boolean(process.env.MPESA_CALLBACK_BASE_URL)}`);
    if (tsqWillFire) {
      triggerTransactionStatusQuery({ config, transId: transactionCode, businessId, notifId: savedNotif?._id }).catch(() => {});
    }

    const jobUpdates = { ...(branchId && !job.branch ? { branch: branchId } : {}) };
    // M-Pesa number is Safaricom-verified — always overwrite job & customer phone
    if (normalizedMsisdn) jobUpdates.phone = normalizedMsisdn;
    // Store masked MSISDN on job so SMS icon shows even without a real phone
    if (!normalizedMsisdn && msisdn) jobUpdates.maskedMsisdn = msisdn;
    // M-Pesa sender name (Safaricom-verified) always overrides job customerName
    if (senderName) jobUpdates.customerName = senderName;
    if (Object.keys(jobUpdates).length) {
      await CarWashJob.updateOne({ _id: job._id, business: businessId }, { $set: jobUpdates });
    }
    await autoEnrollPlate({ business: businessId, plate: job.plateNumber, customerName: job.customerName, phone: normalizedMsisdn, maskedMsisdn: !normalizedMsisdn && msisdn ? msisdn : null, payerName: senderName })
      .catch((err) => console.error('[CW M-Pesa] autoEnroll failed:', err?.message));

    const updatedJob = await refreshJobPaymentStatus(businessId, job._id);
    await postCarWashPaymentLedger({ businessId, payment, cashbookAccountId: cashbook._id, job: updatedJob || job, userId: null });

    // Route M-Pesa overpayment: prepaid/credit account gets wallet top-up;
    // cash customers (no account) get a CarWashCustomerCredit so the balance
    // shows on their next visit and is tracked in the GL.
    const overpayment = round2(paidAmount - outstanding);
    if (overpayment > 0.009 && plate) {
      (async () => {
        try {
          const overpayAcc = await CarWashCreditAccount.findOneAndUpdate(
            { business: businessId, plates: plate, status: "active" },
            { $inc: { accountCredit: overpayment } },
            { new: true }
          );
          if (overpayAcc) {
            // Has a credit/prepaid account — top up wallet and post Dr Cashbook / Cr 4400
            const topupDoc = await CarWashAccountTopup.create({
              business: businessId,
              account: overpayAcc._id,
              amount: overpayment,
              method: "mpesa",
              reference: transactionCode || "",
              cashbookAccount: cashbook._id,
              paymentDate: transDate,
              notes: `Overpayment credited from M-Pesa C2B (${senderName || "Unknown"})`,
            });
            postCarWashTopupLedger({ businessId, topup: topupDoc, cashbookAccountId: cashbook._id, userId: null }).catch(() => {});
          } else {
            // No credit account — save as customer credit and post Dr Cashbook / Cr 2162
            const customer = await CarWashCustomer.findOne({ business: businessId, plates: buildPlateRegex(plate) }).lean();
            if (!customer) return;
            const creditDoc = await CarWashCustomerCredit.create({
              business: businessId,
              customer: customer._id,
              plates: [plate],
              amount: overpayment,
              status: "active",
              sourceJob: job._id,
              sourcePayment: payment._id,
              notes: `M-Pesa overpayment from C2B – ${transactionCode || "N/A"} (${senderName || "Unknown"})`,
            });
            postCarWashCustomerCreditCreationLedger({ businessId, creditDoc, cashbookAccountId: cashbook._id, userId: null })
              .catch((e) => console.error("[C2B] Credit GL posting failed plate=%s: %s", plate, e?.message));
          }
        } catch (e) {
          console.error("[C2B] Overpayment handling failed plate=%s amount=%s: %s", plate, overpayment, e?.message);
        }
      })();
    }

    if (updatedJob) {
      await accrueCommissionForJob({ req: null, job: updatedJob });
      const remainingBalance = round2(Math.max(0, outstanding - appliedAmount));
      const mpesaMasked1 = !normalizedMsisdn && msisdn && !tsqWillFire ? msisdn : null;
      let loyaltySmsBody = null;
      if (["paid", "partial"].includes(updatedJob.paymentStatus)) {
        try {
          const stampResult = await awardLoyaltyStamp({ business: businessId, job: updatedJob, overridePhone: normalizedMsisdn, maskedMsisdn: mpesaMasked1, suppressSms: true, payerName: senderName });
          loyaltySmsBody = stampResult?.smsBody || null;
        } catch (err) {
          console.error("[C2B] Stamp failed job=%s: %s", updatedJob.jobNumber, err?.message || err);
        }
      }
      await sendPaymentConfirmationSms({ business: businessId, job: updatedJob, amount: paidAmount, remaining: remainingBalance, overridePhone: normalizedMsisdn, maskedMsisdn: mpesaMasked1, loyaltySmsBody, payerName: senderName });
      // When TSQ defers delivery, stash the stamp body so the TSQ handler can include it
      if (tsqWillFire && loyaltySmsBody && savedNotif?._id) {
        CarWashMpesaNotification.findByIdAndUpdate(savedNotif._id, { $set: { pendingStampSmsBody: loyaltySmsBody } }).catch(() => {});
      }
      if (updatedJob.paymentStatus === "paid") {
        await markJobCommissionsPayable({ business: businessId, jobId: updatedJob._id });
      }
    }

    return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (err) {
    console.error("[CarWash M-Pesa] Callback error:", err?.message || err);
    await saveNotif({ status: "error", resultCode: 0, resultDesc: err?.message || "Server error" }).catch(() => {});
    return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  }
};

// ─── Mark notification as reversed (manual — when reversed from M-Pesa portal) ─
export const markNotificationReversed = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const notif = await CarWashMpesaNotification.findOne({ _id: req.params.id, business });
    if (!notif) return next(createError(404, "Notification not found"));
    if (notif.isReversed) return next(createError(409, "Already marked as reversed"));

    const reversalRef = String(req.body?.reversalRef || "").trim() || "Marked reversed manually";

    notif.isReversed   = true;
    notif.reversalDate = new Date();
    notif.reversalRef  = reversalRef;
    notif.notes        = [notif.notes, `Reversed: ${reversalRef}`].filter(Boolean).join(" | ");
    await notif.save();

    res.json({ success: true, data: notif, message: "Notification marked as reversed — allocation blocked" });
  } catch (err) {
    next(err);
  }
};

// ─── List notifications (authenticated) ──────────────────────────────────────
export const listMpesaNotifications = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const branchId = resolveActiveBranchId(req);

    const filter = { business };
    if (branchId) filter.branch = new mongoose.Types.ObjectId(String(branchId));
    if (req.query.status) filter.status = req.query.status;
    if (req.query.plate) {
      const p = normalizePlate(req.query.plate);
      if (p) filter.plate = buildPlateRegex(p);
    }
    if (req.query.search) {
      const re = new RegExp(String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ transactionCode: re }, { senderName: re }];
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

    const summaryMatch = { business: new mongoose.Types.ObjectId(String(business)) };
    if (branchId) summaryMatch.branch = new mongoose.Types.ObjectId(String(branchId));
    const summary = await CarWashMpesaNotification.aggregate([
      { $match: summaryMatch },
      { $group: { _id: "$status", count: { $sum: 1 }, totalAmount: { $sum: "$amount" } } },
    ]);

    // Backcompat: old matched notifications predate allocatedAmount — populate from matchedPayment
    for (const n of notifications) {
      if (n.status === "matched" && !n.allocatedAmount && n.matchedPayment?.amount) {
        n.allocatedAmount = round2(n.matchedPayment.amount);
      }
    }

    res.json({ success: true, data: { notifications, pagination: { page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) }, summary } });
  } catch (error) {
    next(error);
  }
};

// ─── Reassign / correct a wrong-account notification ─────────────────────────
export const reassignMpesaNotification = async (req, res, next) => {
  try {
    if (!req.user?.adminAccess && !req.user?.isSystemAdmin && req.user?.role !== "manager") {
      return next(createError(403, "Manager or admin access required to reassign M-Pesa notifications"));
    }

    const business = resolveActiveBusinessId(req);
    const { id } = req.params;
    const { jobId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(jobId)) {
      return res.status(400).json({ success: false, message: "Invalid notification or job ID" });
    }

    const notif = await CarWashMpesaNotification.findOne({ _id: id, business });
    if (!notif) return res.status(404).json({ success: false, message: "Notification not found" });
    if (notif.isReversed) return res.status(409).json({ success: false, message: "Cannot reassign a reversed notification" });
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

    const paidAmount    = round2(notif.amount);
    const appliedAmount = round2(Math.min(paidAmount, outstanding));
    const branch = job.branch || notif.branch || null;
    const normalizedMsisdn = notif.msisdn || null;
    // Masked MSISDN: stored on new notifications; fall back to rawPayload for older records
    const rawMasked = normalizeText(notif.maskedMsisdn || notif.rawPayload?.MSISDN || notif.rawPayload?.Msisdn || "");
    const maskedMsisdn = !normalizedMsisdn && rawMasked.length > 15 ? rawMasked : null;

    let payment;
    try {
      payment = await CarWashPayment.create({
        business,
        branch,
        job: job._id,
        amount: appliedAmount,
        method: "mpesa",
        cashbookAccount: cashbook._id,
        reference: notif.transactionCode || "",
        receivedFromPhone: normalizedMsisdn,
        paymentDate: notif.transactionDate || notif.createdAt,
        notes: `Manually assigned from M-Pesa notification (original ref: ${notif.billRefNumber})`,
      });
    } catch (payErr) {
      if (payErr.code === 11000) {
        return res.status(409).json({ success: false, message: "This M-Pesa receipt is already linked to a payment" });
      }
      throw payErr;
    }

    const assignActorName = [req.user?.otherNames, req.user?.surname].filter(Boolean).join(" ") || req.user?.email || "Admin";
    notif.status = "matched";
    notif.matchedJob = job._id;
    notif.matchedPayment = payment._id;
    notif.resultDesc = `Manually assigned to job ${job.jobNumber || job._id} by ${assignActorName}`;
    notif.notes = `Corrected — original account reference: ${notif.billRefNumber}`;
    await notif.save();

    const updatedJob = await refreshJobPaymentStatus(business, job._id);
    await postCarWashPaymentLedger({ businessId: business, payment, cashbookAccountId: cashbook._id, job: updatedJob || job, userId: req.user?._id || null });

    // Update job + customer with payer's M-Pesa identity (Safaricom-verified)
    const jobContactUpdates = {};
    if (normalizedMsisdn) jobContactUpdates.phone = normalizedMsisdn;
    else if (maskedMsisdn) jobContactUpdates.maskedMsisdn = maskedMsisdn;
    if (notif.senderName) jobContactUpdates.customerName = notif.senderName;
    if (Object.keys(jobContactUpdates).length) {
      CarWashJob.updateOne({ _id: job._id, business }, { $set: jobContactUpdates }).catch(() => {});
    }
    autoEnrollPlate({
      business,
      plate: normalizePlate(job.plateNumber),
      customerName: notif.senderName || job.customerName,
      phone: normalizedMsisdn || null,
      maskedMsisdn: maskedMsisdn || null,
      payerName: notif.senderName || null,
    }).catch(() => {});

    if (updatedJob) {
      accrueCommissionForJob({ req, job: updatedJob }).catch(() => {});
      const reassignRemaining = round2(Math.max(0, outstanding - appliedAmount));
      let loyaltySmsBody = null;
      if (["paid", "partial"].includes(updatedJob.paymentStatus)) {
        try {
          const stampResult = await awardLoyaltyStamp({ business, job: updatedJob, overridePhone: normalizedMsisdn, maskedMsisdn, suppressSms: true, payerName: notif.senderName || null });
          loyaltySmsBody = stampResult?.smsBody || null;
        } catch (err) {
          console.error("[CW Reassign] Stamp failed job=%s: %s", updatedJob.jobNumber || job._id, err?.message || err);
        }
      }
      await sendPaymentConfirmationSms({ business, job: updatedJob, amount: appliedAmount, remaining: reassignRemaining, overridePhone: normalizedMsisdn, maskedMsisdn, loyaltySmsBody, payerName: notif.senderName || null });
      if (updatedJob.paymentStatus === "paid") {
        markJobCommissionsPayable({ business, jobId: updatedJob._id }).catch(() => {});
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

// ─── List unpaid jobs (for allocation modal) ──────────────────────────────────
export const listUnpaidJobs = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const since = new Date();
    since.setMonth(since.getMonth() - 6);

    const jobs = await CarWashJob.find({ business, status: { $nin: ["cancelled"] }, createdAt: { $gte: since } })
      .select("jobNumber plateNumber customerName serviceName price discountAmount createdAt creditAccount")
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    if (!jobs.length) return res.json({ success: true, data: [] });

    const jobIds = jobs.map((j) => j._id);
    const payTotals = await CarWashPayment.aggregate([
      { $match: { business: new mongoose.Types.ObjectId(String(business)), job: { $in: jobIds } } },
      { $group: { _id: "$job", paid: { $sum: "$amount" } } },
    ]);
    const paidMap = new Map(payTotals.map((p) => [String(p._id), round2(p.paid)]));

    const unpaid = [];
    for (const j of jobs) {
      const net         = round2(Math.max(0, Number(j.price || 0) - Number(j.discountAmount || 0)));
      const paid        = paidMap.get(String(j._id)) || 0;
      const outstanding = round2(net - paid);
      if (outstanding > 0) unpaid.push({ ...j, net, paid, outstanding });
    }

    res.json({ success: true, data: unpaid });
  } catch (err) {
    next(err);
  }
};

// ─── Allocate one M-Pesa notification across multiple jobs ───────────────────
export const allocateNotification = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const notif = await CarWashMpesaNotification.findOne({ _id: req.params.id, business });
    if (!notif) return next(createError(404, "Notification not found"));
    if (notif.isReversed) return next(createError(409, "Cannot allocate a reversed notification"));

    const allocations = Array.isArray(req.body.allocations) ? req.body.allocations : [];
    if (!allocations.length) return next(createError(400, "No allocations provided"));

    const alreadyAllocated = round2(notif.allocatedAmount || 0);
    const remaining        = round2(notif.amount - alreadyAllocated);
    const totalNew         = round2(allocations.reduce((s, a) => s + Number(a.amount || 0), 0));
    if (totalNew <= 0)          return next(createError(400, "Total allocation must be greater than 0"));
    if (totalNew > remaining + 0.01) return next(createError(400, `Total (${totalNew}) exceeds remaining amount (${remaining})`));

    const company   = await Company.findById(business).lean();
    const configs   = getRawMpesaPaybillConfigs(company?.paymentIntegration || {});
    const config    = configs.find((c) => normalizeText(c?.shortCode) === normalizeText(notif.shortCode)) || getPrimaryMpesaPaybillConfig(configs);
    const cashbookId = config?.defaultCashbookAccountId;
    if (!cashbookId) return next(createError(422, "Cashbook not configured on M-Pesa paybill settings"));
    const cashbook = await ChartOfAccount.findOne({ _id: cashbookId, business, type: "asset", isPosting: true }).lean();
    if (!cashbook) return next(createError(422, "Cashbook account not found"));

    const normalizedMsisdn = notif.msisdn || null;
    const rawMasked   = normalizeText(notif.maskedMsisdn || notif.rawPayload?.MSISDN || "");
    const maskedMsisdn = !normalizedMsisdn && rawMasked.length > 15 ? rawMasked : null;

    const results = [];
    for (const alloc of allocations) {
      const amount = round2(Number(alloc.amount || 0));
      if (amount <= 0) continue;

      const job = await CarWashJob.findOne({ _id: alloc.jobId, business, status: { $nin: ["cancelled"] } }).lean();
      if (!job) continue;

      const pt   = await CarWashPayment.aggregate([{ $match: { business: job.business, job: job._id } }, { $group: { _id: null, paid: { $sum: "$amount" } } }]);
      const jobOutstanding = round2(Math.max(netJobPrice(job) - (pt?.[0]?.paid || 0), 0));
      if (jobOutstanding <= 0) continue;

      const payAmount = round2(Math.min(amount, jobOutstanding));
      const payment = await CarWashPayment.create({
        business,
        branch:            job.branch || notif.branch || null,
        job:               job._id,
        amount:            payAmount,
        method:            "mpesa",
        cashbookAccount:   cashbook._id,
        reference:         notif.transactionCode || "",
        receivedFromPhone: normalizedMsisdn,
        paymentDate:       notif.transactionDate || notif.createdAt,
        notes: `Allocated from M-Pesa notification (ref: ${notif.transactionCode || notif.billRefNumber})`,
      });

      const updatedJob = await refreshJobPaymentStatus(business, job._id);
      postCarWashPaymentLedger({ businessId: business, payment, cashbookAccountId: cashbook._id, job: updatedJob || job, userId: req.user?._id || null }).catch(() => {});

      if (updatedJob) {
        accrueCommissionForJob({ req, job: updatedJob }).catch(() => {});
        const jobContactUpdates = {};
        if (normalizedMsisdn) jobContactUpdates.phone = normalizedMsisdn;
        else if (maskedMsisdn) jobContactUpdates.maskedMsisdn = maskedMsisdn;
        if (notif.senderName) jobContactUpdates.customerName = notif.senderName;
        if (Object.keys(jobContactUpdates).length) {
          CarWashJob.updateOne({ _id: job._id, business }, { $set: jobContactUpdates }).catch(() => {});
        }
        autoEnrollPlate({ business, plate: normalizePlate(job.plateNumber), customerName: notif.senderName || job.customerName, phone: normalizedMsisdn, maskedMsisdn, payerName: notif.senderName || null }).catch(() => {});
        const allocRemaining = round2(Math.max(0, jobOutstanding - payAmount));
        let loyaltySmsBody = null;
        if (["paid", "partial"].includes(updatedJob.paymentStatus)) {
          try {
            const stampResult = await awardLoyaltyStamp({ business, job: updatedJob, overridePhone: normalizedMsisdn, maskedMsisdn, suppressSms: true, payerName: notif.senderName || null });
            loyaltySmsBody = stampResult?.smsBody || null;
          } catch (err) {
            console.error("[CW Allocate] Stamp failed job=%s: %s", updatedJob.jobNumber || job._id, err?.message || err);
          }
        }
        await sendPaymentConfirmationSms({ business, job: updatedJob, amount: payAmount, remaining: allocRemaining, overridePhone: normalizedMsisdn, maskedMsisdn, loyaltySmsBody, payerName: notif.senderName || null });
        if (updatedJob.paymentStatus === "paid") {
          markJobCommissionsPayable({ business, jobId: updatedJob._id }).catch(() => {});
        }
      }
      results.push({ jobId: job._id, jobNumber: job.jobNumber, plateNumber: job.plateNumber, amount: payAmount });
    }

    if (!results.length) return next(createError(400, "No valid allocations could be processed"));

    const newAllocated = round2(alreadyAllocated + results.reduce((s, r) => s + r.amount, 0));
    notif.allocatedAmount = newAllocated;
    if (newAllocated >= notif.amount - 0.01) {
      notif.status = "matched";
      if (!notif.matchedJob && results.length === 1) notif.matchedJob = results[0].jobId;
    }
    const allocActorName = [req.user?.otherNames, req.user?.surname].filter(Boolean).join(" ") || req.user?.email || "Admin";
    notif.notes = (notif.notes ? notif.notes + " | " : "") + `Allocated to ${results.length} job(s) via multi-allocation by ${allocActorName}`;
    await notif.save();

    const populated = await CarWashMpesaNotification.findById(notif._id)
      .populate("matchedJob",     "jobNumber plateNumber customerName status paymentStatus price")
      .populate("matchedPayment", "amount reference paymentDate")
      .lean();
    if (populated && !populated.allocatedAmount && populated.matchedPayment?.amount) {
      populated.allocatedAmount = round2(populated.matchedPayment.amount);
    }

    res.json({ success: true, data: { notification: populated, allocated: results }, message: `Allocated to ${results.length} job(s)` });
  } catch (err) {
    next(err);
  }
};

// ─── Register C2B validation/confirmation URLs with Safaricom ─────────────────
export const registerCarWashPaybillUrls = async (req, res, next) => {
  try {
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

// ─── CSV helpers ──────────────────────────────────────────────────────────────

const normalizeHeader = (h) => String(h || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const parseCsvText = (text) => {
  const rows = [];
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQ = !inQ; }
      } else if (ch === "," && !inQ) {
        cells.push(cur.trim()); cur = "";
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    rows.push(cells);
  }
  return rows;
};

// M-Pesa portal dates: "20/06/2026 14:23:00" in EAT (UTC+3)
const parseMpesaPortalDate = (raw = "") => {
  const m = String(raw).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):?(\d{2})?$/);
  if (m) {
    const [, dd, mm, yyyy, hh, min, ss = "00"] = m;
    const dt = new Date(Date.UTC(+yyyy, +mm - 1, +dd, +hh - 3, +min, +ss));
    return Number.isNaN(dt.getTime()) ? new Date() : dt;
  }
  const p = new Date(raw);
  return Number.isNaN(p.getTime()) ? new Date() : p;
};

const extractCsvRow = (rawHeaders, cells, fmt) => {
  const normHeaders = rawHeaders.map(normalizeHeader);
  const gc = (key) => {
    const i = normHeaders.indexOf(key);
    return i >= 0 ? (cells[i] || "").trim() : "";
  };

  if (fmt === "portal") {
    const txnStatus = gc("transactionstatus");
    if (txnStatus && !["completed", "success"].includes(txnStatus.toLowerCase())) {
      return { skip: true, reason: `Skipped — status: ${txnStatus}` };
    }
    const transactionCode = gc("receiptno");
    const amount          = round2(Number((gc("paidin") || gc("amountpaidin") || "0").replace(/,/g, "")));
    const billRefNumber   = gc("details") || gc("accountreference");
    const date            = parseMpesaPortalDate(gc("completiontime"));
    const msisdn          = normalizeMsisdn(gc("phonenumber") || gc("msisdn") || "") || "";
    const senderName      = gc("sendername") || gc("initiatorname") || "";
    return { transactionCode, amount, billRefNumber, date, msisdn, senderName };
  }

  if (fmt === "daraja") {
    const transactionCode = gc("transid");
    const amount          = round2(Number((gc("transamount") || "0").replace(/,/g, "")));
    const billRefNumber   = gc("billrefnumber") || gc("accountreference");
    const date            = parseMpesaDate(gc("transtime"));
    const msisdn          = normalizeMsisdn(gc("msisdn") || "") || "";
    const firstName       = gc("firstname");
    const middleName      = gc("middlename");
    const lastName        = gc("lastname");
    const senderName      = [firstName, middleName, lastName].filter(Boolean).join(" ");
    return { transactionCode, amount, billRefNumber, date, msisdn, senderName };
  }

  return { skip: true, reason: "Unknown format" };
};

// ─── Bulk upload M-Pesa statement CSV ─────────────────────────────────────────
export const bulkUploadMpesaStatement = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const branchId = resolveActiveBranchId(req);
    const sendSms  = req.body?.sendSms === "true" || req.body?.sendSms === true;

    if (!req.file) return next(createError(400, "No CSV file uploaded"));

    const text = req.file.buffer.toString("utf-8");
    const rows = parseCsvText(text);
    if (rows.length < 2) return next(createError(400, "CSV has no data rows"));
    if (rows.length > 2001) return next(createError(400, "CSV exceeds the 2 000 row limit — split into smaller files and upload each separately"));

    // Detect format
    const rawHeaders  = rows[0];
    const normHeaders = rawHeaders.map(normalizeHeader);
    let fmt = null;
    if (normHeaders.includes("receiptno") || normHeaders.includes("paidin") || normHeaders.includes("amountpaidin")) fmt = "portal";
    else if (normHeaders.includes("transid") || normHeaders.includes("billrefnumber")) fmt = "daraja";
    if (!fmt) return next(createError(400, "Unrecognised CSV format. Expected M-Pesa Business Portal or Daraja C2B export."));

    // Resolve cashbook
    const company    = await Company.findById(business).lean();
    const configs    = getRawMpesaPaybillConfigs(company?.paymentIntegration || {});
    const config     = getPrimaryMpesaPaybillConfig(configs);
    const cashbookId = config?.defaultCashbookAccountId;
    const cashbook   = cashbookId && mongoose.Types.ObjectId.isValid(String(cashbookId))
      ? await ChartOfAccount.findOne({ _id: cashbookId, business, type: "asset", isPosting: true }).lean()
      : null;
    if (!cashbook) return next(createError(422, "M-Pesa cashbook not configured — check Settings → Payments → M-Pesa Paybill"));

    const results = [];
    let matched = 0, duplicate = 0, unmatched = 0, skipped = 0, errorCount = 0, totalMatched = 0;

    for (let idx = 0; idx < rows.length - 1; idx++) {
      const cells  = rows[idx + 1];
      if (cells.every((c) => !c)) continue;

      const rowNum = idx + 2; // 1-indexed, offset by header row
      let extracted;
      try {
        extracted = extractCsvRow(rawHeaders, cells, fmt);
      } catch (e) {
        results.push({ row: rowNum, status: "error", reason: `Parse error: ${e.message}` });
        errorCount++;
        continue;
      }

      if (extracted.skip) {
        results.push({ row: rowNum, status: "skipped", reason: extracted.reason });
        skipped++;
        continue;
      }

      const { transactionCode, amount, billRefNumber, date, msisdn, senderName } = extracted;
      const plate = normalizePlate(billRefNumber);

      if (!transactionCode) {
        results.push({ row: rowNum, status: "skipped", reason: "No transaction code", billRefNumber, amount });
        skipped++;
        continue;
      }
      if (!amount || amount <= 0) {
        results.push({ row: rowNum, status: "skipped", reason: "Amount is zero or invalid", transactionCode, billRefNumber });
        skipped++;
        continue;
      }
      if (!plate) {
        results.push({ row: rowNum, status: "unmatched", reason: "No valid plate in account reference", transactionCode, billRefNumber: billRefNumber || "—", amount });
        unmatched++;
        continue;
      }

      // Duplicate guard — notification already matched
      const existingNotif = await CarWashMpesaNotification.findOne({ transactionCode, status: "matched" }).lean();
      if (existingNotif) {
        results.push({ row: rowNum, status: "duplicate", reason: "Already processed", transactionCode, plate, amount });
        duplicate++;
        continue;
      }

      // Duplicate guard — payment already recorded with this reference
      const existingPayment = await CarWashPayment.findOne({ business, method: "mpesa", reference: transactionCode }).lean();
      if (existingPayment) {
        results.push({ row: rowNum, status: "duplicate", reason: "Payment already recorded", transactionCode, plate, amount });
        duplicate++;
        continue;
      }

      // Find most-recent open job for this plate
      const job = await CarWashJob.findOne({
        business,
        plateNumber: buildPlateRegex(plate),
        status: { $nin: ["cancelled"] },
        paymentStatus: { $in: ["unpaid", "partial"] },
      }).sort({ createdAt: -1 }).lean();

      if (!job) {
        await CarWashMpesaNotification.create({
          business, branch: branchId || null,
          transactionCode, billRefNumber, plate, amount,
          msisdn: msisdn || "", senderName: senderName || "",
          transactionDate: date, status: "unmatched",
          resultDesc: `No open job for plate ${plate}`,
          notes: "Uploaded via CSV statement",
          rawPayload: { source: "manual_upload", format: fmt, row: rowNum },
        }).catch(() => {});
        results.push({ row: rowNum, status: "unmatched", reason: `No open job for plate ${plate}`, transactionCode, plate, amount });
        unmatched++;
        continue;
      }

      // Cap payment at outstanding
      const totals = await CarWashPayment.aggregate([
        { $match: { business: job.business, job: job._id } },
        { $group: { _id: null, amount: { $sum: "$amount" } } },
      ]);
      const alreadyPaid   = round2(totals?.[0]?.amount || 0);
      const outstanding   = round2(Math.max(netJobPrice(job) - alreadyPaid, 0));
      if (outstanding <= 0) {
        results.push({ row: rowNum, status: "duplicate", reason: "Job already fully paid", transactionCode, plate, amount, jobNumber: job.jobNumber });
        duplicate++;
        continue;
      }
      const appliedAmount = round2(Math.min(amount, outstanding));

      let payment;
      try {
        payment = await CarWashPayment.create({
          business, branch: branchId || null,
          job: job._id, amount: appliedAmount,
          method: "mpesa", cashbookAccount: cashbook._id,
          reference: transactionCode,
          receivedFromPhone: msisdn || null,
          paymentDate: date,
          notes: "Recorded via CSV statement upload",
        });
      } catch (payErr) {
        if (payErr.code === 11000) {
          results.push({ row: rowNum, status: "duplicate", reason: "Duplicate receipt", transactionCode, plate, amount });
          duplicate++;
          continue;
        }
        throw payErr;
      }

      // Save matched notification
      await CarWashMpesaNotification.create({
        business, branch: branchId || null,
        transactionCode, billRefNumber, plate, amount: appliedAmount,
        msisdn: msisdn || "", senderName: senderName || "",
        transactionDate: date, status: "matched",
        matchedJob: job._id, matchedPayment: payment._id,
        allocatedAmount: appliedAmount,
        resultCode: 0, resultDesc: "Matched via CSV upload",
        notes: "Uploaded via CSV statement",
        rawPayload: { source: "manual_upload", format: fmt, row: rowNum },
      }).catch(() => {});

      // Update job contact info if we have it
      const jobUpdates = {};
      if (msisdn) jobUpdates.phone = msisdn;
      if (senderName) jobUpdates.customerName = senderName;
      if (Object.keys(jobUpdates).length) {
        CarWashJob.updateOne({ _id: job._id, business }, { $set: jobUpdates }).catch(() => {});
      }
      if (msisdn || senderName) {
        autoEnrollPlate({ business, plate, customerName: job.customerName, phone: msisdn || null, payerName: senderName || null }).catch(() => {});
      }

      const updatedJob = await refreshJobPaymentStatus(business, job._id);
      postCarWashPaymentLedger({ businessId: business, payment, cashbookAccountId: cashbook._id, job: updatedJob || job, userId: req.user?._id || null }).catch(() => {});

      if (updatedJob) {
        accrueCommissionForJob({ req, job: updatedJob }).catch(() => {});
        if (sendSms) {
          const remaining = round2(Math.max(0, outstanding - appliedAmount));
          let loyaltySmsBody = null;
          if (["paid", "partial"].includes(updatedJob.paymentStatus)) {
            try {
              const stampResult = await awardLoyaltyStamp({ business, job: updatedJob, overridePhone: msisdn || null, suppressSms: true });
              loyaltySmsBody = stampResult?.smsBody || null;
            } catch (err) {
              console.error("[CSV Upload] Stamp failed job=%s: %s", updatedJob.jobNumber, err?.message || err);
            }
          }
          sendPaymentConfirmationSms({ business, job: updatedJob, amount: appliedAmount, remaining, overridePhone: msisdn || null, loyaltySmsBody }).catch(() => {});
        }
        if (updatedJob.paymentStatus === "paid") {
          markJobCommissionsPayable({ business, jobId: updatedJob._id }).catch(() => {});
        }
      }

      matched++;
      totalMatched = round2(totalMatched + appliedAmount);
      results.push({ row: rowNum, status: "matched", transactionCode, plate, amount: appliedAmount, jobNumber: job.jobNumber, customerName: job.customerName || "" });
    }

    res.json({
      success: true,
      summary: { total: results.length, matched, duplicate, unmatched, skipped, error: errorCount, totalMatched },
      results,
    });
  } catch (err) {
    console.error("[CSV Upload] Error:", err?.message || err);
    next(err);
  }
};

// ─── Dev-only: test masked/hashed number SMS without a real payment ───────────
// Blocked in production. Finds the first company with AT enabled automatically.
export const devTestHashedSms = async (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ message: 'Not available in production' });
  }
  try {
    const { maskedNumber, message } = req.body;
    if (!maskedNumber || !message) {
      return res.status(400).json({ message: 'maskedNumber and message are required' });
    }

    const companies = await Company.find({}).select('companyName communication').lean();
    let businessId = null;
    let companyName = null;
    for (const company of companies) {
      const profiles = getRawSmsProfiles(company.communication || {});
      const profile  = getPrimarySmsProfile(profiles, company.communication?.defaultSmsProfileId || null);
      if (profile?.enabled && String(profile?.provider || '').toLowerCase() === 'africas_talking') {
        businessId  = company._id;
        companyName = company.companyName;
        break;
      }
    }

    if (!businessId) {
      return res.status(404).json({ message: "No active Africa's Talking SMS profile found in any company" });
    }

    console.log(`[devTestHashedSms] Company: ${companyName} | maskedNumber: ${maskedNumber}`);

    const result = await sendAdHocSmsToMasked({
      businessId,
      maskedNumber,
      body: message,
      templateKey: 'test_hashed_sms',
      recipientName: 'Test',
    });

    res.json({
      success: true,
      company: companyName,
      result,
      note: 'Full raw AT response is printed in server console logs above',
    });
  } catch (err) {
    next(err);
  }
};
