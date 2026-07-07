import mongoose from "mongoose";
import Company from "../../models/Company.js";
import CoopCollection from "../../models/CoopCollection.js";
import RentPayment from "../../models/RentPayment.js";
import Tenant from "../../models/Tenant.js";

const isValidObjectId = (v)  => mongoose.Types.ObjectId.isValid(String(v || ""));
const normalizeText  = (v)   => String(v  || "").trim();
const normalizeUpper = (v)   => normalizeText(v).toUpperCase();
const safeLower      = (v)   => normalizeText(v).toLowerCase();
const round2         = (v)   => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
const escapeRegExp   = (v)   => String(v || "").replace(/[|\\{}()\[\]^$+*?.]/g, "\\$&");

// Split "1177572#TNT0001" → "TNT0001"; if no "#" return the full value.
const parseTenantCode = (ref = "") => {
  const s = normalizeUpper(ref);
  const idx = s.indexOf("#");
  return idx !== -1 ? s.slice(idx + 1).trim() : s;
};

const authenticateRequest = (header = {}, config = {}) => {
  const id  = normalizeText(header.connectionID);
  const pw  = normalizeText(header.connectionPassword);
  return (
    id  === normalizeText(config.connectionID) &&
    pw  === normalizeText(config.connectionPassword) &&
    Boolean(id) && Boolean(pw)
  );
};

const buildResponse = (messageID, statusCode, statusDescription, response = null) => ({
  header:   { messageID: normalizeText(messageID), statusCode, statusDescription },
  response: response || null,
});

const findConfig = (company, institutionCode) =>
  (company?.paymentIntegration?.coopB2BConfigs || []).find(
    (c) => safeLower(c.institutionCode) === safeLower(institutionCode)
  ) || null;

const findCompanyByInstitution = (institutionCode) =>
  Company.findOne({
    "paymentIntegration.coopB2BConfigs.institutionCode": institutionCode,
  }).lean();

const populateQuery = (query) =>
  query
    .populate({
      path:    "tenant",
      select:  "name tenantCode phone unit business",
      populate: {
        path:    "unit",
        select:  "unitNumber property",
        populate: { path: "property", select: "propertyName" },
      },
    })
    .populate({
      path:   "matchedReceipt",
      select: "receiptNumber referenceNumber amount paymentDate isConfirmed postingStatus tenant",
    });

const findTenantByCode = (businessId, tenantCode) => {
  if (!tenantCode) return null;
  return Tenant.findOne({
    business: businessId,
    tenantCode: { $regex: `^${escapeRegExp(normalizeUpper(tenantCode))}$`, $options: "i" },
  })
    .select("name tenantCode phone unit business")
    .populate({ path: "unit", select: "unitNumber property", populate: { path: "property", select: "propertyName" } })
    .lean();
};

// ─── Public callbacks (Co-op Bank calls these) ───────────────────────────────

export const handleCoopValidation = async (req, res) => {
  const { institutionCode } = req.params;
  const { header = {}, request = {} } = req.body || {};
  const messageID = normalizeText(header.messageID);

  try {
    const company = await findCompanyByInstitution(institutionCode);
    if (!company) {
      return res.json(buildResponse(messageID, "999", "Institution not found"));
    }

    const config = findConfig(company, institutionCode);
    if (!config?.enabled) {
      return res.json(buildResponse(messageID, "999", "Integration not active"));
    }

    if (!authenticateRequest(header, config)) {
      return res.json(buildResponse(messageID, "400", "Authentication failed"));
    }

    const rawRef    = normalizeText(request.TransactionReferenceCode || request.AccountNumber || "");
    const tenantCode = parseTenantCode(rawRef);

    if (!tenantCode) {
      return res.json(buildResponse(messageID, "001", "Invalid account reference"));
    }

    const tenant = await findTenantByCode(company._id, tenantCode);
    if (!tenant) {
      return res.json(buildResponse(messageID, "001", "Account not found"));
    }

    return res.json(buildResponse(messageID, "000", "Customer validated successfully", {
      TransactionReferenceCode: rawRef,
      TransactionDate:          normalizeText(request.TransactionDate),
      TotalAmount:              0,
      Currency:                 "KES",
      AdditionalInfo:           normalizeText(tenant.name),
      AccountNumber:            rawRef,
      AccountName:              normalizeText(tenant.name),
      InstitutionCode:          normalizeText(config.institutionCode),
      InstitutionName:          normalizeText(config.institutionName),
    }));
  } catch (err) {
    console.error("Co-op B2B validation error:", err);
    return res.json(buildResponse(messageID, "999", "Internal error"));
  }
};

export const handleCoopAdvise = async (req, res) => {
  const { institutionCode } = req.params;
  const { header = {}, request = {} } = req.body || {};
  const messageID = normalizeText(header.messageID);

  try {
    const company = await findCompanyByInstitution(institutionCode);
    if (!company) {
      return res.json(buildResponse(messageID, "999", "Institution not found"));
    }

    const config = findConfig(company, institutionCode);
    if (!config?.enabled) {
      return res.json(buildResponse(messageID, "999", "Integration not active"));
    }

    if (!authenticateRequest(header, config)) {
      return res.json(buildResponse(messageID, "400", "Authentication failed"));
    }

    const txRef  = normalizeUpper(request.TransactionReferenceCode || "");
    const docRef = normalizeText(request.DocumentReferenceNumber || request.AccountNumber || "");
    const amount = round2(request.TotalAmount || request.PaymentAmount || 0);

    if (!txRef) {
      return res.json(buildResponse(messageID, "001", "TransactionReferenceCode is required"));
    }

    // Dedup — Co-op may retry; return 200 success so they don't keep retrying.
    const existing = await CoopCollection.findOne({
      business: company._id,
      transactionReferenceCode: txRef,
    }).lean();

    if (existing) {
      return res.json(buildResponse(messageID, "000", "Payment already received", {
        TransactionReferenceCode: txRef,
        TransactionDate:          normalizeText(request.TransactionDate),
        TransactionAmount:        String(amount),
        TotalAmount:              String(amount),
        AccountNumber:            docRef,
        AccountName:              normalizeText(request.AccountName),
        InstitutionCode:          normalizeText(config.institutionCode),
        InstitutionName:          normalizeText(config.institutionName),
        Currency:                 "KES",
        AdditionalInfo:           "",
      }));
    }

    const tenantCode = parseTenantCode(docRef || txRef);
    const tenant     = await findTenantByCode(company._id, tenantCode);
    const matchingStatus = tenant ? "matched_tenant" : "unmatched";

    const paymentDate   = request.PaymentDate   ? new Date(request.PaymentDate)   : null;
    const transactionDate = request.TransactionDate ? new Date(request.TransactionDate) : new Date();

    await CoopCollection.create({
      business:                company._id,
      coopConfigId:            config._id  || null,
      institutionCode:         normalizeText(config.institutionCode),
      transactionReferenceCode: txRef,
      documentReferenceNumber: docRef,
      tenantCode,
      amount,
      currency:                normalizeText(request.Currency) || "KES",
      paymentDate:             paymentDate   || transactionDate,
      transactionDate,
      bankCode:                normalizeText(request.BankCode),
      branchCode:              normalizeText(request.BranchCode),
      paymentMode:             normalizeText(request.PaymentMode),
      payerName:               normalizeText(request.AdditionalInfo || request.AccountName),
      accountNumber:           normalizeText(request.AccountNumber || docRef),
      accountName:             normalizeText(request.AccountName),
      matchingStatus,
      tenant:                  tenant?._id || null,
      rawPayload:              req.body,
    });

    return res.json(buildResponse(messageID, "000", "Payment successfully received", {
      TransactionReferenceCode: txRef,
      TransactionDate:          normalizeText(request.TransactionDate),
      TransactionAmount:        String(amount),
      TotalAmount:              String(amount),
      AccountNumber:            normalizeText(request.AccountNumber || docRef),
      AccountName:              normalizeText(request.AccountName),
      InstitutionCode:          normalizeText(config.institutionCode),
      InstitutionName:          normalizeText(config.institutionName),
      Currency:                 "KES",
      AdditionalInfo:           tenantCode,
    }));
  } catch (err) {
    console.error("Co-op B2B advice error:", err);
    return res.json(buildResponse(messageID, "999", "Internal error"));
  }
};

// ─── Management (authenticated) ──────────────────────────────────────────────

export const listCoopCollections = async (req, res) => {
  try {
    const businessId = normalizeText(req.query.business || req.userCompany || req.user?.company?._id || req.user?.company || "");
    if (!isValidObjectId(businessId)) {
      return res.status(400).json({ success: false, message: "Valid business id is required" });
    }

    const page  = Math.max(Number(req.query.page  || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const skip  = (page - 1) * limit;

    const filters = { business: businessId };

    const status    = normalizeText(req.query.status);
    const search    = normalizeText(req.query.search);
    const dateFrom  = normalizeText(req.query.dateFrom);
    const dateTo    = normalizeText(req.query.dateTo);

    if (status) filters.matchingStatus = status;

    if (dateFrom || dateTo) {
      filters.transactionDate = {};
      if (dateFrom) { const d = new Date(dateFrom); d.setUTCHours(0, 0, 0, 0);       filters.transactionDate.$gte = d; }
      if (dateTo)   { const d = new Date(dateTo);   d.setUTCHours(23, 59, 59, 999);  filters.transactionDate.$lte = d; }
    }

    if (search) {
      const re = new RegExp(escapeRegExp(search), "i");
      filters.$or = [
        { transactionReferenceCode: re },
        { documentReferenceNumber:  re },
        { tenantCode:               re },
        { payerName:                re },
        { accountNumber:            re },
      ];
    }

    const [total, summaryRows, rows] = await Promise.all([
      CoopCollection.countDocuments(filters),
      CoopCollection.aggregate([
        { $match: { business: new mongoose.Types.ObjectId(businessId) } },
        { $group: { _id: "$matchingStatus", count: { $sum: 1 }, totalAmount: { $sum: "$amount" } } },
      ]),
      populateQuery(
        CoopCollection.find(filters).sort({ transactionDate: -1, createdAt: -1 }).skip(skip).limit(limit)
      ).lean(),
    ]);

    const summary = { unmatched: 0, matched_tenant: 0, captured: 0, ignored: 0, totalAmount: 0 };
    for (const row of summaryRows) {
      const key = row._id;
      if (key in summary) summary[key] = row.count;
      summary.totalAmount += row.totalAmount || 0;
    }

    return res.json({
      success: true,
      data:    rows,
      summary,
      total,
      page,
      limit,
      pages:   Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("listCoopCollections error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch Co-op collections" });
  }
};

export const assignTenantToCoopCollection = async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId } = req.body || {};
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, message: "Invalid collection id" });

    const businessId = normalizeText(req.userCompany || req.user?.company?._id || req.user?.company || "");
    const collection = await CoopCollection.findOne({ _id: id, business: businessId });
    if (!collection) return res.status(404).json({ success: false, message: "Collection not found" });

    if (collection.matchingStatus === "captured") {
      return res.status(400).json({ success: false, message: "Collection already captured" });
    }

    if (tenantId && !isValidObjectId(tenantId)) {
      return res.status(400).json({ success: false, message: "Invalid tenant id" });
    }

    const tenant = tenantId
      ? await Tenant.findOne({ _id: tenantId, business: businessId }).select("name tenantCode phone unit business").lean()
      : null;

    collection.tenant         = tenant?._id  || null;
    collection.matchingStatus = tenant ? "matched_tenant" : "unmatched";
    await collection.save();

    const updated = await populateQuery(CoopCollection.findById(collection._id)).lean();
    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error("assignTenantToCoopCollection error:", err);
    return res.status(500).json({ success: false, message: "Failed to assign tenant" });
  }
};

export const ignoreCoopCollection = async (req, res) => {
  try {
    const { id } = req.params;
    const businessId = normalizeText(req.userCompany || req.user?.company?._id || req.user?.company || "");
    const collection = await CoopCollection.findOne({ _id: id, business: businessId });
    if (!collection) return res.status(404).json({ success: false, message: "Collection not found" });
    if (collection.matchingStatus === "captured") {
      return res.status(400).json({ success: false, message: "Cannot ignore a captured collection" });
    }
    collection.matchingStatus = "ignored";
    await collection.save();
    return res.json({ success: true, data: collection });
  } catch (err) {
    console.error("ignoreCoopCollection error:", err);
    return res.status(500).json({ success: false, message: "Failed to ignore collection" });
  }
};

export const unignoreCoopCollection = async (req, res) => {
  try {
    const { id } = req.params;
    const businessId = normalizeText(req.userCompany || req.user?.company?._id || req.user?.company || "");
    const collection = await CoopCollection.findOne({ _id: id, business: businessId });
    if (!collection) return res.status(404).json({ success: false, message: "Collection not found" });

    const tenant = collection.tenant
      ? await Tenant.findById(collection.tenant).select("_id").lean()
      : null;

    collection.matchingStatus = tenant ? "matched_tenant" : "unmatched";
    await collection.save();
    return res.json({ success: true, data: collection });
  } catch (err) {
    console.error("unignoreCoopCollection error:", err);
    return res.status(500).json({ success: false, message: "Failed to unignore collection" });
  }
};

export const deleteCoopCollection = async (req, res) => {
  try {
    const { id } = req.params;
    const businessId = normalizeText(req.userCompany || req.user?.company?._id || req.user?.company || "");
    const collection = await CoopCollection.findOne({ _id: id, business: businessId });
    if (!collection) return res.status(404).json({ success: false, message: "Collection not found" });
    if (collection.matchingStatus === "captured") {
      return res.status(400).json({ success: false, message: "Cannot delete a captured collection" });
    }
    await collection.deleteOne();
    return res.json({ success: true, message: "Collection deleted" });
  } catch (err) {
    console.error("deleteCoopCollection error:", err);
    return res.status(500).json({ success: false, message: "Failed to delete collection" });
  }
};
