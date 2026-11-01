import mongoose from "mongoose";
import { escapeRegex } from "../../utils/escapeRegex.js";
import ServiceProvider from "../../models/ServiceProvider.js";
import ExpenseRequisition from "../../models/ExpenseRequisition.js";
import PaymentVoucher from "../../models/PaymentVoucher.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import { resolveBusinessId } from "../../utils/requestContext.js";
import { parsePagination } from "../../utils/pagination.js";
import { createError } from "../../utils/error.js";
import { clampWhtRate } from "../../utils/withholdingTax.js";
import { round2 } from "../../utils/math.js";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const resolveExpenseAccountId = async (businessId, rawValue) => {
  if (!isValidObjectId(rawValue)) return null;
  const account = await ChartOfAccount.findOne({
    _id: rawValue,
    business: businessId,
    isPosting: { $ne: false },
    isHeader: { $ne: true },
  })
    .select("_id")
    .lean();
  return account?._id || null;
};

// Flags (never blocks) a new/edited provider whose KRA PIN, bank account, paybill/till or M-Pesa
// number exactly matches another provider already on file for this company — the classic
// fake-vendor fraud signature (a bank account genuinely belongs to one legal entity), but still
// something a human should confirm rather than the system silently rejecting, since a sole
// proprietor can legitimately register two trading names under one KRA PIN.
const findDuplicateServiceProviderMatches = async (businessId, candidate, excludeId) => {
  const checks = [
    { field: "kraPin", label: "KRA PIN", value: String(candidate.kraPin || "").trim() },
    { field: "accountNumber", label: "bank account number", value: String(candidate.accountNumber || "").trim() },
    { field: "paybillNumber", label: "paybill/till number", value: String(candidate.paybillNumber || "").trim() },
    { field: "mobileNumber", label: "M-Pesa number", value: String(candidate.mobileNumber || "").trim() },
  ].filter((c) => c.value);
  if (!checks.length) return [];

  const or = checks.map((c) => ({ [c.field]: { $regex: `^${escapeRegex(c.value)}$`, $options: "i" } }));
  const filter = { business: businessId, $or: or };
  if (excludeId) filter._id = { $ne: excludeId };

  const matches = await ServiceProvider.find(filter, "name providerCode kraPin accountNumber paybillNumber mobileNumber").lean();
  if (!matches.length) return [];

  const warnings = [];
  for (const check of checks) {
    const hit = matches.find((m) => String(m[check.field] || "").trim().toLowerCase() === check.value.toLowerCase());
    if (hit) {
      warnings.push({
        field: check.field,
        label: check.label,
        value: check.value,
        matchedProviderId: hit._id,
        matchedProviderName: hit.name,
        matchedProviderCode: hit.providerCode,
      });
    }
  }
  return warnings;
};

// Net outstanding (invoiced - paid) per provider, scoped to just the given ids so a list
// page only pays for the providers it's actually displaying rather than the whole creditor book.
const computeOutstandingMap = async (businessId, providerIds) => {
  if (!providerIds.length) return new Map();
  const businessIdObj = new mongoose.Types.ObjectId(String(businessId));
  const [invoicedAgg, paidAgg] = await Promise.all([
    FinancialLedgerEntry.aggregate([
      {
        $match: {
          business: businessIdObj,
          serviceProvider: { $in: providerIds },
          status: "approved",
          "metadata.postingRole": { $in: ["liability_accrual", "ap_invoice_liability"] },
        },
      },
      { $group: { _id: "$serviceProvider", total: { $sum: "$credit" } } },
    ]),
    FinancialLedgerEntry.aggregate([
      {
        $match: {
          business: businessIdObj,
          serviceProvider: { $in: providerIds },
          status: "approved",
          "metadata.postingRole": "liability_settlement",
        },
      },
      { $group: { _id: "$serviceProvider", total: { $sum: "$debit" } } },
    ]),
  ]);
  const invoicedMap = new Map(invoicedAgg.map((r) => [String(r._id), r.total]));
  const paidMap = new Map(paidAgg.map((r) => [String(r._id), r.total]));
  const outstandingMap = new Map();
  providerIds.forEach((id) => {
    const key = String(id);
    outstandingMap.set(key, round2((invoicedMap.get(key) || 0) - (paidMap.get(key) || 0)));
  });
  return outstandingMap;
};

const AGING_BUCKET_DEFS = [
  { key: "current", min: null, max: 0 },
  { key: "d1_30", min: 1, max: 30 },
  { key: "d31_60", min: 31, max: 60 },
  { key: "d61_90", min: 61, max: 90 },
  { key: "d90plus", min: 91, max: null },
];
const assignAgingBucket = (daysOverdue) => {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "d1_30";
  if (daysOverdue <= 60) return "d31_60";
  if (daysOverdue <= 90) return "d61_90";
  return "d90plus";
};

// The real AP aging engine: per vendor, FIFO-allocate every approved payment against that vendor's
// approved accruals in date order, then age whatever's left on each accrual by its own posting
// date. This is what Payment Aged Analysis / AR-AP Aging Report's vendor side calls — it replaced
// an earlier approach that read pending PaymentVoucher records directly, which missed any accrual
// that was never (yet) turned into a voucher — exactly the case for a vendor take-on balance, and
// for any approved requisition still awaiting a voucher. Deliberately exported (not duplicated)
// since the FIFO allocation logic is non-trivial and should have exactly one implementation —
// mirrors computeOutstandingMap's own postingRole filters so the two can never disagree.
export const computeVendorApAgingRows = async (businessId, asOfDate) => {
  const businessIdObj = new mongoose.Types.ObjectId(String(businessId));
  const asOf = asOfDate ? new Date(asOfDate) : new Date();
  asOf.setHours(23, 59, 59, 999);

  const [invoiceEntries, paymentEntries, providers] = await Promise.all([
    FinancialLedgerEntry.find({
      business: businessIdObj,
      serviceProvider: { $ne: null },
      status: "approved",
      "metadata.postingRole": { $in: ["liability_accrual", "ap_invoice_liability"] },
      transactionDate: { $lte: asOf },
    })
      .sort({ transactionDate: 1 })
      .select("serviceProvider transactionDate credit sourceTransactionId metadata notes")
      .lean(),
    FinancialLedgerEntry.find({
      business: businessIdObj,
      serviceProvider: { $ne: null },
      status: "approved",
      "metadata.postingRole": "liability_settlement",
      transactionDate: { $lte: asOf },
    })
      .select("serviceProvider debit")
      .lean(),
    ServiceProvider.find({ business: businessId }).select("name providerCode").lean(),
  ]);

  const providerById = new Map(providers.map((p) => [String(p._id), p]));

  const paidByProvider = new Map();
  for (const p of paymentEntries) {
    const key = String(p.serviceProvider);
    paidByProvider.set(key, round2((paidByProvider.get(key) || 0) + Number(p.debit || 0)));
  }

  const invoicesByProvider = new Map();
  for (const inv of invoiceEntries) {
    const key = String(inv.serviceProvider);
    if (!invoicesByProvider.has(key)) invoicesByProvider.set(key, []);
    invoicesByProvider.get(key).push(inv);
  }

  const rows = [];
  const totals = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 };

  for (const [providerId, invoices] of invoicesByProvider) {
    let remainingPayment = paidByProvider.get(providerId) || 0;
    const provider = providerById.get(providerId);
    for (const inv of invoices) {
      const invoiceAmount = round2(Number(inv.credit || 0));
      if (invoiceAmount <= 0) continue;
      const applied = Math.min(remainingPayment, invoiceAmount);
      remainingPayment = round2(remainingPayment - applied);
      const outstanding = round2(invoiceAmount - applied);
      if (outstanding <= 0) continue;

      const daysOverdue = Math.floor((asOf - new Date(inv.transactionDate)) / 86_400_000);
      const bucket = assignAgingBucket(daysOverdue);
      totals[bucket] = round2(totals[bucket] + outstanding);
      totals.total = round2(totals.total + outstanding);

      rows.push({
        reference: inv.metadata?.requisitionNo || inv.metadata?.voucherNo || String(inv.sourceTransactionId || ""),
        narration: inv.notes || "—",
        vendorName: provider?.name || "—",
        serviceProviderId: providerId,
        propertyName: "—",
        landlordName: "—",
        category: null,
        status: "approved",
        dueDate: inv.transactionDate,
        amount: outstanding,
        daysOverdue,
        bucket,
      });
    }
  }

  return { rows, totals };
};

const generateProviderCode = async (businessId) => {
  const prefix = "SP";
  const last = await ServiceProvider.findOne(
    { business: businessId, providerCode: { $regex: `^${prefix}\\d+$` } },
    { providerCode: 1 },
    { sort: { createdAt: -1 } }
  ).lean();

  const seq = last?.providerCode ? (parseInt(last.providerCode.replace(prefix, ""), 10) || 0) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
};

export const createServiceProvider = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Company context is required"));
    const name = String(req.body?.name || "").trim();
    if (!name) return next(createError(400, "Service provider name is required"));

    const whtRate = clampWhtRate(req.body?.whtRate);
    const defaultExpenseAccount = await resolveExpenseAccountId(businessId, req.body?.defaultExpenseAccount);
    const doc = await ServiceProvider.create({
      business: businessId,
      providerCode: await generateProviderCode(businessId),
      name,
      contactPerson: req.body?.contactPerson || "",
      email: req.body?.email || "",
      phone: req.body?.phone || "",
      category: req.body?.category || "general",
      kraPin: req.body?.kraPin || "",
      accountNumber: req.body?.accountNumber || "",
      paybillNumber: req.body?.paybillNumber || "",
      bankName: req.body?.bankName || "",
      branchName: req.body?.branchName || "",
      accountName: req.body?.accountName || "",
      mobileNumber: req.body?.mobileNumber || "",
      defaultExpenseAccount,
      subjectToWht: Boolean(req.body?.subjectToWht) && whtRate > 0,
      whtRate:      Boolean(req.body?.subjectToWht) && whtRate > 0 ? whtRate : 0,
      whtCategory:  String(req.body?.whtCategory || "").trim(),
      isActive: req.body?.isActive !== false,
      notes: req.body?.notes || "",
    });

    const duplicateWarnings = await findDuplicateServiceProviderMatches(businessId, doc, doc._id);
    res.status(201).json({ ...doc.toObject(), duplicateWarnings });
  } catch (error) {
    next(error);
  }
};

export const getServiceProviders = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Company context is required"));

    const filter = { business: businessId };
    if (req.query?.active === "true") filter.isActive = true;
    if (req.query?.active === "false") filter.isActive = false;
    const searchTerm = escapeRegex(String(req.query?.search || "").trim());
    const nameFilter = String(req.query?.name || "").trim();
    const categoryFilter = String(req.query?.category || "").trim();

    if (nameFilter) {
      filter.name = { $regex: nameFilter, $options: "i" };
    }

    if (categoryFilter && categoryFilter !== "all") {
      filter.category = { $regex: `^${categoryFilter}$`, $options: "i" };
    }

    if (searchTerm) {
      filter.$or = [
        { providerCode: { $regex: searchTerm, $options: "i" } },
        { name: { $regex: searchTerm, $options: "i" } },
        { contactPerson: { $regex: searchTerm, $options: "i" } },
        { email: { $regex: searchTerm, $options: "i" } },
        { phone: { $regex: searchTerm, $options: "i" } },
        { category: { $regex: searchTerm, $options: "i" } },
      ];
    }

    const { page: pageNum, limit: limitNum, skip } = parsePagination(req, { defaultLimit: 50, maxLimit: 200 });

    const [rows, total] = await Promise.all([
      ServiceProvider.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).populate("defaultExpenseAccount", "code name").lean(),
      ServiceProvider.countDocuments(filter),
    ]);
    const outstandingMap = await computeOutstandingMap(businessId, rows.map((r) => r._id));
    const data = rows.map((r) => ({ ...r, outstanding: outstandingMap.get(String(r._id)) || 0 }));
    res.status(200).json({ success: true, data, total, page: pageNum, pages: Math.max(1, Math.ceil(total / limitNum)) });
  } catch (error) {
    next(error);
  }
};

export const updateServiceProvider = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Company context is required"));

    const row = await ServiceProvider.findOne({ _id: req.params.id, business: businessId });
    if (!row) return next(createError(404, "Service provider not found"));

    const allowed = ["name", "contactPerson", "email", "phone", "category", "kraPin", "accountNumber", "paybillNumber", "bankName", "branchName", "accountName", "mobileNumber", "subjectToWht", "whtRate", "whtCategory", "isActive", "notes"];
    allowed.forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(req.body || {}, field)) return;
      if (field === "name") { row[field] = String(req.body[field] || "").trim(); return; }
      row[field] = req.body[field];
    });
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "defaultExpenseAccount")) {
      row.defaultExpenseAccount = await resolveExpenseAccountId(businessId, req.body.defaultExpenseAccount);
    }

    if (!String(row.name || "").trim()) {
      return next(createError(400, "Service provider name is required"));
    }
    // Normalize WHT fields: clamp rate, clear subjectToWht if rate is effectively zero
    row.whtRate = clampWhtRate(row.whtRate);
    if (row.subjectToWht && row.whtRate <= 0) row.subjectToWht = false;
    if (!row.subjectToWht) row.whtRate = 0;
    await row.save();
    const duplicateWarnings = await findDuplicateServiceProviderMatches(businessId, row, row._id);
    res.status(200).json({ ...row.toObject(), duplicateWarnings });
  } catch (error) {
    next(error);
  }
};

export const deleteServiceProvider = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Company context is required"));

    const row = await ServiceProvider.findOne({ _id: req.params.id, business: businessId });
    if (!row) return next(createError(404, "Service provider not found"));

    const [hasRequisitions, hasVouchers, hasLedgerEntries] = await Promise.all([
      ExpenseRequisition.exists({ business: businessId, serviceProvider: row._id }),
      PaymentVoucher.exists({ business: businessId, serviceProvider: row._id }),
      FinancialLedgerEntry.exists({ business: businessId, serviceProvider: row._id }),
    ]);
    if (hasRequisitions || hasVouchers || hasLedgerEntries) {
      return next(createError(400, "This provider has linked requisitions, vouchers or ledger entries and cannot be deleted. Mark it inactive instead to keep it out of new transactions."));
    }

    await ServiceProvider.deleteOne({ _id: row._id, business: businessId });
    res.status(200).json({ success: true, message: "Service provider deleted" });
  } catch (error) {
    next(error);
  }
};

export const getCreditorsSummary = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Company context is required"));

    const businessIdObj = new mongoose.Types.ObjectId(String(businessId));
    const providers = await ServiceProvider.find({ business: businessId }).sort({ name: 1 }).lean();
    if (!providers.length) return res.status(200).json([]);

    const providerIds = providers.map((p) => p._id);

    const [invoicedAgg, paidAgg] = await Promise.all([
      FinancialLedgerEntry.aggregate([
        {
          $match: {
            business: businessIdObj,
            serviceProvider: { $in: providerIds },
            status: "approved",
            "metadata.postingRole": { $in: ["liability_accrual", "ap_invoice_liability"] },
          },
        },
        { $group: { _id: "$serviceProvider", totalInvoiced: { $sum: "$credit" } } },
      ]),
      FinancialLedgerEntry.aggregate([
        {
          $match: {
            business: businessIdObj,
            serviceProvider: { $in: providerIds },
            status: "approved",
            "metadata.postingRole": "liability_settlement",
          },
        },
        { $group: { _id: "$serviceProvider", totalPaid: { $sum: "$debit" } } },
      ]),
    ]);

    const invoicedMap = new Map(invoicedAgg.map((r) => [String(r._id), r.totalInvoiced]));
    const paidMap = new Map(paidAgg.map((r) => [String(r._id), r.totalPaid]));

    const result = providers.map((p) => {
      const totalInvoiced = invoicedMap.get(String(p._id)) || 0;
      const totalPaid = paidMap.get(String(p._id)) || 0;
      return { ...p, totalInvoiced, totalPaid, outstanding: totalInvoiced - totalPaid };
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const getCreditorStatement = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Company context is required"));

    const providerId = req.params.id;
    if (!isValidObjectId(providerId)) return next(createError(400, "Invalid provider ID"));

    const [provider, glEntries] = await Promise.all([
      ServiceProvider.findOne({ _id: providerId, business: businessId }).lean(),
      FinancialLedgerEntry.find({
        business: new mongoose.Types.ObjectId(String(businessId)),
        serviceProvider: new mongoose.Types.ObjectId(String(providerId)),
        status: "approved",
        "metadata.postingRole": { $in: ["liability_accrual", "ap_invoice_liability", "liability_settlement"] },
      })
        .sort({ transactionDate: 1, createdAt: 1 })
        .lean(),
    ]);

    if (!provider) return next(createError(404, "Service provider not found"));

    let balance = 0;
    const lines = glEntries.map((e) => {
      const isInvoice = ["liability_accrual", "ap_invoice_liability"].includes(e.metadata?.postingRole);
      const invoiced = isInvoice ? Number(e.credit || 0) : 0;
      const paid = !isInvoice ? Number(e.debit || 0) : 0;
      balance += invoiced - paid;
      return {
        date: e.transactionDate,
        ref: e.metadata?.voucherNo || e.metadata?.requisitionNo || String(e.sourceTransactionId || ""),
        type: isInvoice ? "invoice" : "payment",
        sourceType: e.sourceTransactionType,
        description: e.notes || "",
        invoiced,
        paid,
        balance,
      };
    });

    const totalInvoiced = lines.reduce((s, l) => s + l.invoiced, 0);
    const totalPaid = lines.reduce((s, l) => s + l.paid, 0);

    res.status(200).json({
      provider,
      lines,
      summary: { totalInvoiced, totalPaid, outstanding: totalInvoiced - totalPaid },
    });
  } catch (error) {
    next(error);
  }
};
