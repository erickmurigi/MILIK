import mongoose from "mongoose";
import Company from "../../models/Company.js";
import MpesaCollection from "../../models/MpesaCollection.js";
import RentPayment from "../../models/RentPayment.js";
import Tenant from "../../models/Tenant.js";
import { getRawMpesaPaybillConfigs, getPrimaryMpesaPaybillConfig } from "../../utils/companyModules.js";

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
  if (tenant) return "matched_tenant";
  return "unmatched";
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

const upsertCollection = async ({ businessId, config = {}, source = "manual_batch", importBatchId = null, payload = {}, importedBy = null, responseMode = "" }) => {
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

  let stored;
  if (existing) {
    await MpesaCollection.findByIdAndUpdate(existing._id, { $set: update });
    stored = await populateCollectionQuery(MpesaCollection.findById(existing._id)).lean();
  } else {
    const created = await MpesaCollection.create(update);
    stored = await populateCollectionQuery(MpesaCollection.findById(created._id)).lean();
  }

  return { stored, wasDuplicate: Boolean(existing) };
};

export const listMpesaCollections = async (req, res) => {
  try {
    const businessId = String(req.query.business || req.userCompany || req.user?.company?._id || req.user?.company || "");
    if (!isValidObjectId(businessId)) {
      return res.status(400).json({ success: false, message: "Valid business id is required" });
    }

    const filters = { business: businessId };
    const status = normalizeText(req.query.status);
    const source = normalizeText(req.query.source);
    const shortCode = normalizeText(req.query.shortCode);
    const search = normalizeText(req.query.search);

    if (status) filters.matchingStatus = status;
    if (source) filters.source = source;
    if (shortCode) filters.shortCode = shortCode;
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

    const rows = await populateCollectionQuery(
      MpesaCollection.find(filters).sort({ transactionDate: -1, createdAt: -1 }).limit(300)
    ).lean();

    const hydrated = [];
    for (const row of rows) {
      hydrated.push(await syncCollectionMatches(row));
    }

    res.status(200).json({ success: true, data: hydrated });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to load M-Pesa collections" });
  }
};

export const importMpesaBatch = async (req, res) => {
  try {
    const businessId = String(req.body.business || req.userCompany || req.user?.company?._id || req.user?.company || "");
    const rawText = String(req.body.rawText || "");
    const shortCode = normalizeText(req.body.shortCode || "");

    if (!isValidObjectId(businessId)) {
      return res.status(400).json({ success: false, message: "Valid business id is required" });
    }

    if (!rawText.trim()) {
      return res.status(400).json({ success: false, message: "Paste at least one M-Pesa batch line before importing" });
    }

    const { company, config } = await resolveCompanyAndConfig({ businessId, shortCode });
    const lines = parseManualBatchLines(rawText);
    if (lines.length === 0) {
      return res.status(400).json({ success: false, message: "No valid batch rows were detected in the provided text" });
    }

    const importBatchId = new mongoose.Types.ObjectId();
    const importedRows = [];
    for (const row of lines) {
      const { stored, wasDuplicate } = await upsertCollection({
        businessId: String(company._id),
        config,
        source: "manual_batch",
        importBatchId,
        payload: row,
        importedBy: req.user?._id || null,
      });
      importedRows.push({ ...stored, wasDuplicate });
    }

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
    res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to import M-Pesa batch lines" });
  }
};

export const mpesaValidationCallback = async (req, res) => {
  try {
    const shortCode = normalizeText(req.params.shortCode || req.body?.BusinessShortCode || "");
    const { company, config } = await resolveCompanyAndConfig({ shortCode });
    const responseType = normalizeText(config?.responseType || "Completed");
    const accepted = responseType !== "Cancelled";

    await upsertCollection({
      businessId: String(company._id),
      config,
      source: "callback_validation",
      payload: {
        ...extractCallbackFields(req.body || {}),
        callbackResultCode: accepted ? 0 : 1,
        callbackResultDesc: accepted ? "Accepted" : "Cancelled by company configuration",
      },
      responseMode: responseType,
    });

    return res.status(200).json({
      ResultCode: accepted ? 0 : 1,
      ResultDesc: accepted ? "Accepted" : "Cancelled by company configuration",
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      ResultCode: 1,
      ResultDesc: error.message || "Failed to validate M-Pesa callback",
    });
  }
};

export const mpesaConfirmationCallback = async (req, res) => {
  try {
    const shortCode = normalizeText(req.params.shortCode || req.body?.BusinessShortCode || "");
    const { company, config } = await resolveCompanyAndConfig({ shortCode });
    const { stored } = await upsertCollection({
      businessId: String(company._id),
      config,
      source: "callback_confirmation",
      payload: extractCallbackFields(req.body || {}),
      responseMode: normalizeText(config?.responseType || "Completed"),
    });

    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Accepted",
      collectionId: stored?._id || null,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      ResultCode: 1,
      ResultDesc: error.message || "Failed to persist M-Pesa callback",
    });
  }
};
