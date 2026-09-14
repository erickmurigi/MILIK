import axios from "axios";
import mongoose from "mongoose";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import Company from "../../models/Company.js";
import MpesaCollection from "../../models/MpesaCollection.js";
import RentPayment from "../../models/RentPayment.js";
import Tenant from "../../models/Tenant.js";
import User from "../../models/User.js";
import { getRawMpesaPaybillConfigs, getPrimaryMpesaPaybillConfig } from "../../utils/companyModules.js";
import { createAutoReceipt } from "./rentPayment.js";
import { createError } from "../../utils/error.js";
import { parsePagination } from "../../utils/pagination.js";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const escapeRegExp = (value = "") => String(value || "").replace(/[|\\{}()\[\]^$+*?.]/g, "\\$&");
const safeLower = (value = "") => String(value || "").trim().toLowerCase();
const round2 = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const normalizeText = (value = "") => String(value || "").trim();
const normalizeUpper = (value = "") => normalizeText(value).toUpperCase();
const normalizePhoneDigits = (value = "") => String(value || "").replace(/\D+/g, "");

const normalizeKenyanPhone = (value = "") => {
  const digits = normalizePhoneDigits(value);
  if (!digits) return "";
  if (digits.startsWith("254") && digits.length >= 12) return digits.slice(0, 12);
  if (digits.startsWith("0") && digits.length >= 10) return `254${digits.slice(1, 10)}`;
  if (digits.length === 9) return `254${digits}`;
  return digits;
};

const buildPayerName = (parts = []) =>
  parts
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .join(" ")
    .trim();

const parseDateFromText = (value = "") => {
  const raw = normalizeText(value);
  if (!raw) return null;

  if (/^\d{14}$/.test(raw)) {
    const year = Number(raw.slice(0, 4));
    const month = Number(raw.slice(4, 6));
    const day = Number(raw.slice(6, 8));
    const hour = Number(raw.slice(8, 10));
    const minute = Number(raw.slice(10, 12));
    const second = Number(raw.slice(12, 14));
    const dt = new Date(year, month - 1, day, hour, minute, second);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  if (/^\d{8}$/.test(raw)) {
    const year = Number(raw.slice(0, 4));
    const month = Number(raw.slice(4, 6));
    const day = Number(raw.slice(6, 8));
    const dt = new Date(year, month - 1, day);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(raw)) {
    const [a, b, c] = raw.split(/[/-]/).map(Number);
    const year = c < 100 ? 2000 + c : c;
    const dt = new Date(year, b - 1, a);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const extractTransactionCode = (value = "") => {
  const match = normalizeUpper(value).match(/\b([A-Z0-9]{8,14})\b/);
  return match ? match[1] : "";
};

const extractAmount = (value = "") => {
  const candidates = String(value || "")
    .match(/\d+(?:[.,]\d{1,2})?/g)
    || [];
  const parsed = candidates
    .map((item) => Number(String(item).replace(/,/g, "")))
    .filter((item) => Number.isFinite(item) && item > 0)
    .sort((a, b) => b - a)[0];
  return round2(parsed || 0);
};

const buildExternalSignature = ({ source = "", shortCode = "", transactionCode = "", amount = 0, accountReference = "", msisdn = "", transactionDate = null, rawLine = "" }) => {
  if (transactionCode) return "";
  const dateToken = transactionDate instanceof Date && !Number.isNaN(transactionDate.getTime())
    ? transactionDate.toISOString().slice(0, 19)
    : "";
  const signature = [
    safeLower(source),
    normalizeText(shortCode),
    round2(amount).toFixed(2),
    normalizeUpper(accountReference),
    normalizeKenyanPhone(msisdn),
    dateToken,
    normalizeUpper(rawLine).slice(0, 180),
  ].join("|");
  return signature.replace(/\s+/g, " ").trim();
};

const selectCompanyMpesaConfig = (company = {}, explicitShortCode = "") => {
  const configs = getRawMpesaPaybillConfigs(company?.paymentIntegration || {});
  if (configs.length === 0) return null;
  const normalizedShortCode = normalizeText(explicitShortCode);
  if (normalizedShortCode) {
    const exact = configs.find((item) => normalizeText(item?.shortCode) === normalizedShortCode);
    if (exact) return exact;
  }
  return getPrimaryMpesaPaybillConfig(configs);
};

const resolveCompanyAndConfig = async ({ businessId = "", shortCode = "" }) => {
  if (businessId && !isValidObjectId(businessId)) {
    const error = new Error("Invalid company id for M-Pesa collection request.");
    error.statusCode = 400;
    throw error;
  }

  let company = null;
  if (businessId) {
    company = await Company.findById(businessId).lean();
  } else if (shortCode) {
    company = await Company.findOne({
      $or: [
        { "paymentIntegration.mpesaPaybills.shortCode": normalizeText(shortCode) },
        { "paymentIntegration.mpesaPaybill.shortCode": normalizeText(shortCode) },
      ],
    }).lean();
  }

  if (!company) {
    const error = new Error("Company with the requested M-Pesa paybill configuration was not found.");
    error.statusCode = 404;
    throw error;
  }

  const config = selectCompanyMpesaConfig(company, shortCode);
  if (!config) {
    const error = new Error("No M-Pesa paybill configuration is available for this company.");
    error.statusCode = 400;
    throw error;
  }

  return { company, config };
};

const parseManualBatchLines = (rawText = "") =>
  String(rawText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const cells = line.split(/\t|,/).map((item) => item.trim()).filter(Boolean);
      const transactionCode = extractTransactionCode(line);
      const phone = cells.find((item) => /^(?:0\d{9}|254\d{9})$/.test(item.replace(/\s+/g, ""))) || "";
      const dateCell = cells.find((item) => /\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{8,14}/.test(item)) || "";
      const accountReference = cells.find((item) => /(tt\d+|unit|house|acc|account)/i.test(item)) || "";
      const payer = cells.find(
        (item) => /[a-z]/i.test(item) && item !== phone && item !== dateCell && item !== accountReference
      ) || "";

      return {
        rowId: `${transactionCode || "line"}-${index + 1}`,
        rawLine: line,
        transactionCode,
        amount: extractAmount(line),
        msisdn: phone,
        payerName: payer,
        accountReference,
        billRefNumber: accountReference,
        transactionDate: parseDateFromText(dateCell),
        transTimeRaw: normalizeText(dateCell),
      };
    });

const extractCallbackFields = (payload = {}) => {
  const body = payload?.Body?.stkCallback || payload?.Body || payload || {};
  const top = payload || {};
  const metadataItems = Array.isArray(body?.CallbackMetadata?.Item) ? body.CallbackMetadata.Item : [];
  const metadataMap = new Map(
    metadataItems.map((item) => [String(item?.Name || ""), item?.Value])
  );

  const transactionCode = normalizeText(
    top.TransID || top.TransId || top.transId || metadataMap.get("MpesaReceiptNumber") || body?.CheckoutRequestID || ""
  );
  const transAmount = Number(
    top.TransAmount || top.Transamount || top.Amount || metadataMap.get("Amount") || 0
  );
  const billRefNumber = normalizeText(
    top.BillRefNumber || top.BillRefNo || top.AccountReference || metadataMap.get("BillRefNumber") || metadataMap.get("AccountReference") || ""
  );
  const msisdn = normalizeText(
    top.MSISDN || top.Msisdn || top.MSISDNNumber || top.PhoneNumber || metadataMap.get("MSISDN") || metadataMap.get("PhoneNumber") || ""
  );
  const transTimeRaw = normalizeText(
    top.TransTime || top.TransactionTime || metadataMap.get("TransactionDate") || metadataMap.get("TransactionTime") || ""
  );
  const firstName = normalizeText(top.FirstName || metadataMap.get("FirstName") || "");
  const middleName = normalizeText(top.MiddleName || metadataMap.get("MiddleName") || "");
  const lastName = normalizeText(top.LastName || metadataMap.get("LastName") || "");

  return {
    transactionCode,
    amount: round2(transAmount),
    accountReference: billRefNumber,
    billRefNumber,
    msisdn,
    payerName: buildPayerName([firstName, middleName, lastName]),
    firstName,
    middleName,
    lastName,
    orgAccountBalance: normalizeText(top.OrgAccountBalance || metadataMap.get("OrgAccountBalance") || ""),
    transType: normalizeText(top.TransType || top.TransactionType || top.BusinessShortCode || body?.MerchantRequestID || ""),
    transTimeRaw,
    transactionDate: parseDateFromText(transTimeRaw),
    rawPayload: payload,
  };
};

const populateCollectionQuery = (query) =>
  query
    .populate({ path: "tenant", select: "name tenantCode phone unit business", populate: { path: "unit", select: "unitNumber property", populate: { path: "property", select: "propertyName" } } })
    .populate({ path: "matchedReceipt", select: "receiptNumber referenceNumber amount paymentDate isConfirmed postingStatus tenant" });

const findTenantMatch = async ({ businessId, accountReference = "", msisdn = "" }) => {
  const normalizedAccountReference = normalizeUpper(accountReference);
  if (normalizedAccountReference) {
    const exactByCode = await Tenant.findOne({
      business: businessId,
      tenantCode: { $regex: `^${escapeRegExp(normalizedAccountReference)}$`, $options: "i" },
    })
      .select("name tenantCode phone unit business")
      .populate({ path: "unit", select: "unitNumber property", populate: { path: "property", select: "propertyName" } })
      .lean();
    if (exactByCode) return exactByCode;
  }

  const phone = normalizeKenyanPhone(msisdn);
  if (!phone) return null;

  const phoneCandidates = [phone];
  if (phone.startsWith("254") && phone.length === 12) {
    phoneCandidates.push(`0${phone.slice(3)}`);
  }

  return Tenant.findOne({
    business: businessId,
    phone: { $in: phoneCandidates },
  })
    .select("name tenantCode phone unit business")
    .populate({ path: "unit", select: "unitNumber property", populate: { path: "property", select: "propertyName" } })
    .lean();
};

const findReceiptMatch = async ({ businessId, transactionCode = "", amount = 0 }) => {
  const normalizedCode = normalizeUpper(transactionCode);
  const filters = [
    { business: businessId },
    { ledgerType: "receipts" },
    { isCancelled: { $ne: true } },
    { isReversed: { $ne: true } },
    { reversalOf: null },
  ];

  if (normalizedCode) {
    const codeRegex = new RegExp(escapeRegExp(normalizedCode), "i");
    filters.push({
      $or: [
        { referenceNumber: codeRegex },
        { receiptNumber: codeRegex },
        { "metadata.mpesa.transactionCode": codeRegex },
      ],
    });
  }

  if (Number(amount || 0) > 0) {
    const rounded = round2(amount);
    filters.push({ amount: { $gte: rounded - 0.01, $lte: rounded + 0.01 } });
  }

  return RentPayment.findOne({ $and: filters })
    .select("receiptNumber referenceNumber amount paymentDate isConfirmed postingStatus tenant")
    .lean();
};

const deriveMatchingStatus = ({ tenant = null, matchedReceipt = null }) => {
  if (matchedReceipt) return "captured";
  return "unmatched"; // tenant known but no receipt yet stays unmatched — auto-receipt handles capture
};

const syncCollectionMatches = async (collection) => {
  const businessId = String(collection?.business || "");
  if (!businessId) return collection;

  const [tenant, matchedReceipt] = await Promise.all([
    collection?.tenant
      ? Tenant.findById(collection.tenant)
          .select("name tenantCode phone unit business")
          .populate({ path: "unit", select: "unitNumber property", populate: { path: "property", select: "propertyName" } })
          .lean()
      : findTenantMatch({ businessId, accountReference: collection.accountReference, msisdn: collection.msisdn }),
    collection?.matchedReceipt
      ? RentPayment.findById(collection.matchedReceipt)
          .select("receiptNumber referenceNumber amount paymentDate isConfirmed postingStatus tenant")
          .lean()
      : findReceiptMatch({ businessId, transactionCode: collection.transactionCode, amount: collection.amount }),
  ]);

  const tenantId = tenant?._id ? String(tenant._id) : "";
  const matchedReceiptId = matchedReceipt?._id ? String(matchedReceipt._id) : "";
  const currentTenantId = collection?.tenant ? String(collection.tenant) : "";
  const currentReceiptId = collection?.matchedReceipt ? String(collection.matchedReceipt) : "";
  const nextStatus = deriveMatchingStatus({ tenant, matchedReceipt });

  if (
    tenantId !== currentTenantId ||
    matchedReceiptId !== currentReceiptId ||
    String(collection?.matchingStatus || "") !== nextStatus
  ) {
    await MpesaCollection.findByIdAndUpdate(collection._id, {
      $set: {
        tenant: tenant?._id || null,
        matchedReceipt: matchedReceipt?._id || null,
        matchingStatus: nextStatus,
      },
    });
  }

  return populateCollectionQuery(MpesaCollection.findById(collection._id)).lean();
};

const upsertCollection = async ({ businessId, config = {}, source = "manual_batch", importBatchId = null, payload = {}, importedBy = null, responseMode = "", skipPopulate = false }) => {
  const transactionCode = normalizeUpper(payload.transactionCode || "");
  const amount = round2(payload.amount || 0);
  const transactionDate = payload.transactionDate instanceof Date && !Number.isNaN(payload.transactionDate.getTime())
    ? payload.transactionDate
    : parseDateFromText(payload.transTimeRaw || payload.transactionDate || "");
  const msisdn = normalizeKenyanPhone(payload.msisdn || "");
  const accountReference = normalizeText(payload.accountReference || payload.billRefNumber || "");
  const externalSignature = buildExternalSignature({
    source,
    shortCode: config?.shortCode || payload.shortCode || "",
    transactionCode,
    amount,
    accountReference,
    msisdn,
    transactionDate,
    rawLine: payload.rawLine || "",
  });

  const duplicateLookup = [];
  if (transactionCode) duplicateLookup.push({ business: businessId, transactionCode });
  if (externalSignature) duplicateLookup.push({ business: businessId, externalSignature });

  const existing = duplicateLookup.length > 0
    ? await MpesaCollection.findOne({ $or: duplicateLookup }).lean()
    : null;

  const matchedTenant = await findTenantMatch({ businessId, accountReference, msisdn });
  const matchedReceipt = await findReceiptMatch({ businessId, transactionCode, amount });
  const matchingStatus = deriveMatchingStatus({ tenant: matchedTenant, matchedReceipt });

  const update = {
    business: businessId,
    configId: config?._id || null,
    configName: config?.name || (config?.shortCode ? `Paybill ${config.shortCode}` : ""),
    shortCode: normalizeText(config?.shortCode || payload.shortCode || ""),
    source,
    importBatchId: importBatchId || null,
    transactionCode,
    externalSignature,
    transactionDate,
    amount,
    accountReference,
    billRefNumber: normalizeText(payload.billRefNumber || accountReference),
    msisdn,
    payerName: normalizeText(payload.payerName || buildPayerName([payload.firstName, payload.middleName, payload.lastName])),
    firstName: normalizeText(payload.firstName || ""),
    middleName: normalizeText(payload.middleName || ""),
    lastName: normalizeText(payload.lastName || ""),
    orgAccountBalance: normalizeText(payload.orgAccountBalance || ""),
    transType: normalizeText(payload.transType || ""),
    transTimeRaw: normalizeText(payload.transTimeRaw || ""),
    rawLine: normalizeText(payload.rawLine || ""),
    rawPayload: payload.rawPayload || null,
    tenant: matchedTenant?._id || null,
    matchedReceipt: matchedReceipt?._id || null,
    matchingStatus,
    duplicateOf: null,
    importedBy: importedBy || null,
    metadata: {
      ...(existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {}),
      responseMode: responseMode || "",
      callbackResultCode: payload.callbackResultCode ?? null,
      callbackResultDesc: payload.callbackResultDesc ?? "",
      lastImportedAt: new Date(),
      duplicateImportCount: Number(existing?.metadata?.duplicateImportCount || 0) + (existing ? 1 : 0),
    },
  };

  let storedId;
  if (existing) {
    await MpesaCollection.findByIdAndUpdate(existing._id, { $set: update });
    storedId = existing._id;
  } else {
    const created = await MpesaCollection.create(update);
    storedId = created._id;
  }

  if (skipPopulate) {
    return { storedId, wasDuplicate: Boolean(existing) };
  }

  const stored = await populateCollectionQuery(MpesaCollection.findById(storedId)).lean();
  return { stored, wasDuplicate: Boolean(existing) };
};

const extractSafaricomError = (err) => {
  const d = err?.response?.data;
  if (!d) return err?.message || "Unknown error";
  if (d.errorMessage) return String(d.errorMessage).trim();
  if (d.fault?.faultstring) return String(d.fault.faultstring).trim();
  if (d.ResultDesc) return String(d.ResultDesc).trim();
  if (d.error_description) return String(d.error_description).trim();
  return err?.message || JSON.stringify(d).slice(0, 200);
};

const tryRegisterC2BUrls = async (safaricomBase, version, accessToken, shortCode, responseType, confirmationURL, validationURL) => {
  const { data } = await axios.post(
    `${safaricomBase}/mpesa/c2b/${version}/registerurl`,
    { ShortCode: shortCode, ResponseType: responseType, ConfirmationURL: confirmationURL, ValidationURL: validationURL },
    { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, timeout: 15000 }
  );
  return data;
};

// Every businessId resolution in this file (here and below) previously put
// req.query.business / req.body.business ahead of req.userCompany — any
// authenticated user could read, import, delete, or reassign another
// company's M-Pesa collections by passing its id. req.userCompany is already
// safely resolved/validated upstream (attachResolvedCompany in
// controllers/verifyToken.js); removed the client-controllable prefix
// everywhere in this file rather than trusting it.
export const registerPmsPaybillUrls = async (req, res, next) => {
  try {
    const businessId = String(req.userCompany || req.user?.company?._id || req.user?.company || "");
    if (!isValidObjectId(businessId)) {
      return next(createError(400, "Valid business id is required"));
    }

    const shortCode = normalizeText(req.body?.shortCode || "");
    if (!shortCode) return next(createError(400, "shortCode is required"));

    const company = await Company.findById(businessId).lean();
    if (!company) return next(createError(404, "Company not found"));

    const configs = getRawMpesaPaybillConfigs(company?.paymentIntegration || {});
    const config =
      configs.find((c) => normalizeText(c?.shortCode) === shortCode) ||
      getPrimaryMpesaPaybillConfig(configs);

    if (!config) {
      return next(createError(404, `No Paybill configuration found for shortcode ${shortCode}`));
    }

    const consumerKey    = normalizeText(config.consumerKey);
    const consumerSecret = normalizeText(config.consumerSecret);
    const responseType   = config.responseType === "Cancelled" ? "Cancelled" : "Completed";

    if (!consumerKey || !consumerSecret) {
      return next(createError(422, "Save the Consumer Key and Consumer Secret before registering URLs with Safaricom."));
    }

    const envBase  = normalizeText(process.env.MPESA_CALLBACK_BASE_URL || "");
    const apiBase  = (envBase || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    const validationURL   = `${apiBase}/api/pms/pay/validation/${shortCode}`;
    const confirmationURL = `${apiBase}/api/pms/pay/confirmation/${shortCode}`;

    const safaricomBase = normalizeText(process.env.MPESA_ENVIRONMENT || "production") === "sandbox"
      ? "https://sandbox.safaricom.co.ke"
      : "https://api.safaricom.co.ke";

    let accessToken;
    try {
      const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
      const tokenRes = await axios.get(`${safaricomBase}/oauth/v1/generate?grant_type=client_credentials`, {
        headers: { Authorization: `Basic ${auth}` },
        timeout: 15000,
      });
      accessToken = String(tokenRes.data?.access_token || "").trim();
    } catch (tokenErr) {
      return next(createError(502, `Failed to authenticate with Safaricom. Verify your Consumer Key and Secret. (${extractSafaricomError(tokenErr)})`));
    }

    if (!accessToken) {
      return next(createError(502, "No access token returned by Safaricom. Check your credentials."));
    }

    const isAlreadyRegistered = (msg = "") => /already.registered|url.*registered|registered.*url/i.test(msg);
    let safaricomResponse;
    let v1Error;
    let alreadyRegistered = false;

    try {
      safaricomResponse = await tryRegisterC2BUrls(safaricomBase, "v1", accessToken, shortCode, responseType, confirmationURL, validationURL);
      console.log("[PMS-RegisterURLs] v1 succeeded for %s: %j", shortCode, safaricomResponse);
    } catch (err) {
      v1Error = extractSafaricomError(err);
      console.warn("[PMS-RegisterURLs] v1 failed (%s) — retrying with v2", v1Error);
      try {
        safaricomResponse = await tryRegisterC2BUrls(safaricomBase, "v2", accessToken, shortCode, responseType, confirmationURL, validationURL);
        v1Error = null;
        console.log("[PMS-RegisterURLs] v2 succeeded for %s: %j", shortCode, safaricomResponse);
      } catch (err2) {
        const v2Error = extractSafaricomError(err2);
        if (isAlreadyRegistered(v2Error) || isAlreadyRegistered(v1Error)) {
          alreadyRegistered = true;
          safaricomResponse = { note: "already_registered" };
          console.warn("[PMS-RegisterURLs] already_registered for %s — manual Daraja update may be needed", shortCode);
        } else {
          return next(createError(502,
            `Safaricom rejected the URL registration. ` +
            `v1: ${v1Error} | v2: ${v2Error}. ` +
            `Ensure your Daraja app has the C2B API product enabled and the Consumer Key belongs to shortcode ${shortCode}.`
          ));
        }
      }
    }

    return res.json({
      success: true,
      alreadyRegistered,
      message: alreadyRegistered
        ? `Safaricom reports URLs are already registered for shortcode ${shortCode}. ` +
          `The system has submitted the updated URLs (${confirmationURL}) — ` +
          `do a test payment to confirm callbacks are arriving. ` +
          `If they are not, log in to the Daraja portal and manually update the C2B confirmation URL to: ${confirmationURL}`
        : `Callback URLs registered with Safaricom successfully. Confirmation URL: ${confirmationURL}`,
      data: { validationURL, confirmationURL, safaricomResponse },
    });
  } catch (error) {
    next(error);
  }
};

export const listMpesaCollections = async (req, res, next) => {
  try {
    const businessId = String(req.userCompany || req.user?.company?._id || req.user?.company || "");
    if (!isValidObjectId(businessId)) {
      return next(createError(400, "Valid business id is required"));
    }

    const { page, limit, skip } = parsePagination(req, { defaultLimit: 50, maxLimit: 200 });

    const filters = { business: businessId };
    const status    = normalizeText(req.query.status);
    const source    = normalizeText(req.query.source);
    const shortCode = normalizeText(req.query.shortCode);
    const search    = normalizeText(req.query.search);
    const dateFrom  = normalizeText(req.query.dateFrom);
    const dateTo    = normalizeText(req.query.dateTo);

    if (status)    filters.matchingStatus = status;
    if (source)    filters.source         = source;
    if (shortCode) filters.shortCode      = shortCode;
    if (dateFrom || dateTo) {
      filters.transactionDate = {};
      if (dateFrom) { const d = new Date(dateFrom); d.setUTCHours(0, 0, 0, 0);    filters.transactionDate.$gte = d; }
      if (dateTo)   { const d = new Date(dateTo);   d.setUTCHours(23, 59, 59, 999); filters.transactionDate.$lte = d; }
      if (!dateFrom && !dateTo) delete filters.transactionDate;
    }
    if (search) {
      const regex = new RegExp(escapeRegExp(search), "i");
      filters.$or = [
        { transactionCode: regex },
        { accountReference: regex },
        { billRefNumber: regex },
        { payerName: regex },
        { msisdn: regex },
        { rawLine: regex },
      ];
    }

    const [total, summaryRows, rows] = await Promise.all([
      MpesaCollection.countDocuments(filters),
      MpesaCollection.aggregate([
        { $match: { business: new mongoose.Types.ObjectId(String(businessId)) } },
        { $group: { _id: "$matchingStatus", count: { $sum: 1 }, totalAmount: { $sum: "$amount" } } },
      ]),
      populateCollectionQuery(
        MpesaCollection.find(filters).sort({ transactionDate: -1, createdAt: -1 }).skip(skip).limit(limit)
      ).lean(),
    ]);

    // ── Batch sync ────────────────────────────────────────────────────────────
    // 1. Rows already captured with both references populated → skip all DB I/O.
    // 2. Rows with known tenant/receipt IDs → batch-fetch in two queries.
    // 3. Rows with no references → still need individual search queries.
    // 4. Collect updates → single bulkWrite instead of N findByIdAndUpdate.
    // 5. Return merged result without a per-row populate round-trip.

    const captured = [];
    const needsSync = [];
    for (const row of rows) {
      const status = String(row.matchingStatus || "");
      if (
        // Terminal statuses set by explicit user action — never auto-sync over them
        status === "ignored" ||
        status === "duplicate" ||
        // Fully captured with both references already populated — no DB I/O needed
        (status === "captured" && row.tenant?._id && row.matchedReceipt?._id)
      ) {
        captured.push(row);
      } else {
        needsSync.push(row);
      }
    }

    // Batch-fetch tenants and receipts for rows that already have references.
    const knownTenantIds = [...new Set(
      needsSync.filter((r) => r.tenant?._id || r.tenant).map((r) => String(r.tenant?._id || r.tenant))
    )];
    const knownReceiptIds = [...new Set(
      needsSync.filter((r) => r.matchedReceipt?._id || r.matchedReceipt).map((r) => String(r.matchedReceipt?._id || r.matchedReceipt))
    )];

    const [batchedTenants, batchedReceipts] = await Promise.all([
      knownTenantIds.length
        ? Tenant.find({ _id: { $in: knownTenantIds } })
            .select("name tenantCode phone unit business")
            .populate({ path: "unit", select: "unitNumber property", populate: { path: "property", select: "propertyName" } })
            .lean()
        : [],
      knownReceiptIds.length
        ? RentPayment.find({ _id: { $in: knownReceiptIds } })
            .select("receiptNumber referenceNumber amount paymentDate isConfirmed postingStatus tenant")
            .lean()
        : [],
    ]);
    const tenantById = new Map(batchedTenants.map((t) => [String(t._id), t]));
    const receiptById = new Map(batchedReceipts.map((r) => [String(r._id), r]));

    // Process each row that needs sync, using pre-fetched data where possible.
    const bulkOps = [];
    const syncedRows = await Promise.all(
      needsSync.map(async (row) => {
        const existingTenantId = String(row.tenant?._id || row.tenant || "");
        const existingReceiptId = String(row.matchedReceipt?._id || row.matchedReceipt || "");

        const [tenant, matchedReceipt] = await Promise.all([
          existingTenantId && tenantById.has(existingTenantId)
            ? tenantById.get(existingTenantId)
            : findTenantMatch({ businessId, accountReference: row.accountReference, msisdn: row.msisdn }),
          existingReceiptId && receiptById.has(existingReceiptId)
            ? receiptById.get(existingReceiptId)
            : findReceiptMatch({ businessId, transactionCode: row.transactionCode, amount: row.amount }),
        ]);

        const tenantId = tenant?._id ? String(tenant._id) : "";
        const matchedReceiptId = matchedReceipt?._id ? String(matchedReceipt._id) : "";
        const nextStatus = deriveMatchingStatus({ tenant, matchedReceipt });

        const currentTenantId = String(row.tenant?._id || row.tenant || "");
        const currentReceiptId = String(row.matchedReceipt?._id || row.matchedReceipt || "");

        if (
          tenantId !== currentTenantId ||
          matchedReceiptId !== currentReceiptId ||
          String(row.matchingStatus || "") !== nextStatus
        ) {
          bulkOps.push({
            updateOne: {
              filter: { _id: row._id },
              update: {
                $set: {
                  tenant: tenant?._id || null,
                  matchedReceipt: matchedReceipt?._id || null,
                  matchingStatus: nextStatus,
                },
              },
            },
          });
        }

        return {
          ...row,
          tenant: tenant || null,
          matchedReceipt: matchedReceipt || null,
          matchingStatus: nextStatus,
        };
      })
    );

    if (bulkOps.length > 0) {
      await MpesaCollection.bulkWrite(bulkOps, { ordered: false });
    }

    // Preserve original sort order.
    const idOrder = new Map(rows.map((r, i) => [String(r._id), i]));
    const allRows = [...captured, ...syncedRows].sort(
      (a, b) => (idOrder.get(String(a._id)) ?? 0) - (idOrder.get(String(b._id)) ?? 0)
    );

    res.status(200).json({
      success: true,
      data: allRows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      summary: summaryRows,
    });
  } catch (error) {
    next(error);
  }
};

export const importMpesaBatch = async (req, res, next) => {
  try {
    const businessId = String(req.userCompany || req.user?.company?._id || req.user?.company || "");
    const rawText = String(req.body.rawText || "");
    const shortCode = normalizeText(req.body.shortCode || "");

    if (!isValidObjectId(businessId)) {
      return next(createError(400, "Valid business id is required"));
    }

    if (!rawText.trim()) {
      return next(createError(400, "Paste at least one M-Pesa batch line before importing"));
    }

    const { company, config } = await resolveCompanyAndConfig({ businessId, shortCode });
    const lines = parseManualBatchLines(rawText);
    if (lines.length === 0) {
      return next(createError(400, "No valid batch rows were detected in the provided text"));
    }

    const importBatchId = new mongoose.Types.ObjectId();
    const rawResults = [];
    for (const row of lines) {
      const result = await upsertCollection({
        businessId: String(company._id),
        config,
        source: "manual_batch",
        importBatchId,
        payload: row,
        importedBy: req.user?._id || null,
        skipPopulate: true,
      });
      rawResults.push(result);
    }

    // Batch-populate all upserted records in one query instead of N individual findById+populate.
    const allIds = rawResults.map((r) => r.storedId).filter(Boolean);
    const populatedDocs = allIds.length
      ? await populateCollectionQuery(MpesaCollection.find({ _id: { $in: allIds } })).lean()
      : [];
    const docById = new Map(populatedDocs.map((d) => [String(d._id), d]));

    const importedRows = rawResults.map((r) => ({
      ...(docById.get(String(r.storedId)) || {}),
      wasDuplicate: r.wasDuplicate,
    }));

    const duplicates = importedRows.filter((item) => item?.wasDuplicate === true).length;
    res.status(200).json({
      success: true,
      message: `Imported ${importedRows.length} M-Pesa row(s).`,
      data: {
        importBatchId,
        count: importedRows.length,
        duplicates,
        items: importedRows,
      },
    });
  } catch (error) {
    next(error);
  }
};

const attemptAutoReceipt = async ({ stored, config }) => {
  const tenant = stored?.tenant;
  if (!tenant?._id) return;
  if (stored.matchingStatus === "captured" || stored.matchingStatus === "duplicate" || stored.matchingStatus === "ignored") return;

  const unitId = tenant?.unit?._id || tenant?.unit;
  if (!unitId) {
    console.warn("[PMS-AutoReceipt] No unit on tenant=%s collection=%s — skipping", tenant._id, stored._id);
    await MpesaCollection.findByIdAndUpdate(stored._id, {
      $set: { "metadata.autoReceiptSkipReason": "Tenant has no unit assigned" },
    });
    return;
  }

  const configAccountId = config?.defaultCashbookAccountId;
  if (!configAccountId) {
    console.warn("[PMS-AutoReceipt] No cashbook account on config — skipping collection=%s", stored._id);
    await MpesaCollection.findByIdAndUpdate(stored._id, {
      $set: { "metadata.autoReceiptSkipReason": "Paybill config has no default cashbook account" },
    });
    return;
  }

  try {
    // Resolve cashbook name live from ChartOfAccount (avoids stale config cache)
    let cashbookAccountId   = configAccountId;
    let cashbookAccountName = config?.defaultCashbookAccountName || "M-Pesa";
    if (isValidObjectId(String(cashbookAccountId))) {
      const acct = await ChartOfAccount.findOne(
        { _id: cashbookAccountId, business: String(stored.business) },
        { name: 1 }
      ).lean();
      if (acct?.name) cashbookAccountName = acct.name;
    }

    const receipt = await createAutoReceipt({
      businessId: String(stored.business),
      tenantId: String(tenant._id),
      unitId: String(unitId),
      amount: stored.amount,
      referenceNumber: stored.transactionCode,
      paymentDate: stored.transactionDate instanceof Date ? stored.transactionDate : new Date(),
      cashbookAccountId,
      cashbookAccountName,
      configName: config?.name || "M-Pesa Paybill",
      description: `M-Pesa Auto – ${stored.transactionCode}${stored.payerName ? ` – ${stored.payerName}` : ""}`,
    });
    await MpesaCollection.findByIdAndUpdate(stored._id, {
      $set: { matchingStatus: "captured", matchedReceipt: receipt._id, "metadata.autoReceiptSkipReason": "" },
    });
  } catch (err) {
    if (err.isDuplicate) {
      await MpesaCollection.findByIdAndUpdate(stored._id, {
        $set: { matchingStatus: "captured", matchedReceipt: err.existingId, "metadata.autoReceiptSkipReason": "" },
      });
      console.warn("[PMS-AutoReceipt] Duplicate ref=%s linked to existing=%s", stored.transactionCode, err.existingId);
    } else {
      await MpesaCollection.findByIdAndUpdate(stored._id, {
        $set: { "metadata.autoReceiptSkipReason": err.message || "Auto-receipt failed" },
      });
      console.error("[PMS-AutoReceipt] Failed ref=%s tenant=%s: %s", stored.transactionCode, tenant._id, err.message);
    }
  }
};

export const mpesaValidationCallback = async (req, res, next) => {
  const shortCode = normalizeText(req.params.shortCode || req.body?.BusinessShortCode || "");
  let company = null;
  let config = null;

  try {
    ({ company, config } = await resolveCompanyAndConfig({ shortCode }));
  } catch {
    console.warn("[PMS-Validation] Unknown shortCode=%s", shortCode);
    return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  }

  const responseType = normalizeText(config?.responseType || "Completed");
  const accepted = responseType !== "Cancelled";

  // Respond to Safaricom immediately, then persist in background
  res.status(200).json({
    ResultCode: accepted ? 0 : 1,
    ResultDesc: accepted ? "Accepted" : "Cancelled by company configuration",
  });

  upsertCollection({
    businessId: String(company._id),
    config,
    source: "callback_validation",
    payload: {
      ...extractCallbackFields(req.body || {}),
      callbackResultCode: accepted ? 0 : 1,
      callbackResultDesc: accepted ? "Accepted" : "Cancelled by company configuration",
    },
    responseMode: responseType,
  }).catch((err) => console.error("[PMS-Validation] Save error shortCode=%s: %s", shortCode, err.message));
};

export const mpesaConfirmationCallback = async (req, res, next) => {
  // Respond to Safaricom immediately to avoid the 5s timeout
  res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });

  const shortCode = normalizeText(req.params.shortCode || req.body?.BusinessShortCode || "");
  try {
    const { company, config } = await resolveCompanyAndConfig({ shortCode });
    const { stored } = await upsertCollection({
      businessId: String(company._id),
      config,
      source: "callback_confirmation",
      payload: extractCallbackFields(req.body || {}),
      responseMode: normalizeText(config?.responseType || "Completed"),
    });

    if (stored?.tenant?._id) {
      await attemptAutoReceipt({ stored, config });
    }
  } catch (error) {
    console.error("[PMS-Confirmation] Processing error shortCode=%s: %s", shortCode, error.message);
  }
};


export const deleteMpesaCollection = async (req, res, next) => {
  try {
    const businessId = String(req.userCompany || req.user?.company?._id || req.user?.company || "");
    if (!isValidObjectId(businessId)) {
      return next(createError(400, "Valid business id is required"));
    }

    const row = await MpesaCollection.findOne({ _id: req.params.id, business: businessId })
      .populate({ path: "matchedReceipt", select: "_id isConfirmed" })
      .lean();

    if (!row) {
      return next(createError(404, "M-Pesa collection row not found"));
    }

    if (row?.matchedReceipt?._id) {
      return next(createError(400, "This M-Pesa notification is already linked to a receipt. Delete or reverse the receipt first."));
    }

    await MpesaCollection.deleteOne({ _id: row._id, business: businessId });
    return res.status(200).json({ success: true, message: "M-Pesa notification removed successfully." });
  } catch (error) {
    next(error);
  }
};

export const assignTenantToCollection = async (req, res, next) => {
  try {
    const businessId = String(req.userCompany || req.user?.company?._id || req.user?.company || "");
    if (!isValidObjectId(businessId)) return next(createError(400, "Valid business id is required"));

    const row = await MpesaCollection.findOne({ _id: req.params.id, business: businessId }).lean();
    if (!row) return next(createError(404, "M-Pesa collection not found"));
    if (row.matchingStatus === "ignored") return next(createError(400, "Cannot assign tenant to an ignored collection"));

    const tenantId = normalizeText(req.body?.tenantId || "");
    if (!tenantId || !isValidObjectId(tenantId)) return next(createError(400, "Valid tenant id is required"));

    const tenant = await Tenant.findOne({ _id: tenantId, business: businessId })
      .select("name tenantCode phone unit business")
      .populate({ path: "unit", select: "unitNumber property", populate: { path: "property", select: "propertyName" } })
      .lean();
    if (!tenant) return next(createError(404, "Tenant not found in this business"));

    const matchedReceipt = await findReceiptMatch({ businessId, transactionCode: row.transactionCode, amount: row.amount });
    const nextStatus = deriveMatchingStatus({ tenant, matchedReceipt });

    // Resolve assigning user's display name
    let assignedByName = "Unknown";
    const actorId = req.user?.id || req.user?._id;
    if (req.user?.isSystemAdmin || req.user?.superAdminAccess) {
      assignedByName = "MILIK ADMIN";
    } else if (actorId) {
      const actorUser = await User.findById(actorId).select("surname otherNames profile").lean().catch(() => null);
      if (actorUser) {
        assignedByName = [actorUser.otherNames, actorUser.surname].filter(Boolean).join(" ") || actorUser.profile || "User";
      }
    }

    await MpesaCollection.findByIdAndUpdate(row._id, {
      $set: {
        tenant: tenant._id,
        matchingStatus: nextStatus,
        matchedReceipt: matchedReceipt?._id || null,
        "metadata.manualAssignment": {
          assignedBy: actorId || null,
          assignedByName,
          assignedAt: new Date(),
        },
      },
    });

    // No existing receipt — attempt auto-receipt; if it fails the row stays unmatched (tenant is stored)
    if (nextStatus === "unmatched") {
      const { config } = await resolveCompanyAndConfig({ businessId, shortCode: row.shortCode }).catch(() => ({ config: null }));
      const stored = { ...row, tenant, matchingStatus: nextStatus, matchedReceipt: null };
      await attemptAutoReceipt({ stored, config });
    }

    const updated = await populateCollectionQuery(MpesaCollection.findById(row._id)).lean();
    return res.status(200).json({ success: true, message: `Assigned to ${tenant.name}`, data: updated });
  } catch (error) {
    next(error);
  }
};

export const ignoreCollection = async (req, res, next) => {
  try {
    const businessId = String(req.userCompany || req.user?.company?._id || req.user?.company || "");
    if (!isValidObjectId(businessId)) return next(createError(400, "Valid business id is required"));

    const row = await MpesaCollection.findOne({ _id: req.params.id, business: businessId }).lean();
    if (!row) return next(createError(404, "M-Pesa collection not found"));
    if (row.matchedReceipt) return next(createError(400, "Cannot ignore a collection already linked to a receipt"));

    const notes = normalizeText(req.body?.notes || "");
    await MpesaCollection.findByIdAndUpdate(row._id, {
      $set: { matchingStatus: "ignored", notes: [row.notes, notes].filter(Boolean).join(" | ") },
    });

    const updated = await populateCollectionQuery(MpesaCollection.findById(row._id)).lean();
    return res.status(200).json({ success: true, message: "Collection marked as ignored", data: updated });
  } catch (error) {
    next(error);
  }
};

export const unignoreCollection = async (req, res, next) => {
  try {
    const businessId = String(req.userCompany || req.user?.company?._id || req.user?.company || "");
    if (!isValidObjectId(businessId)) return next(createError(400, "Valid business id is required"));

    const row = await MpesaCollection.findOne({ _id: req.params.id, business: businessId }).lean();
    if (!row) return next(createError(404, "M-Pesa collection not found"));

    const tenant = row.tenant ? await Tenant.findById(row.tenant).select("_id").lean() : await findTenantMatch({ businessId, accountReference: row.accountReference, msisdn: row.msisdn });
    const matchedReceipt = await findReceiptMatch({ businessId, transactionCode: row.transactionCode, amount: row.amount });
    const nextStatus = deriveMatchingStatus({ tenant, matchedReceipt });

    await MpesaCollection.findByIdAndUpdate(row._id, {
      $set: { matchingStatus: nextStatus, tenant: tenant?._id || null, matchedReceipt: matchedReceipt?._id || null },
    });

    const updated = await populateCollectionQuery(MpesaCollection.findById(row._id)).lean();
    return res.status(200).json({ success: true, message: "Collection restored", data: updated });
  } catch (error) {
    next(error);
  }
};
