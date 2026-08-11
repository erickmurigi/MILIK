import mongoose from "mongoose";
import { escapeRegex } from "../../utils/escapeRegex.js";
import ServiceProvider from "../../models/ServiceProvider.js";
import ExpenseRequisition from "../../models/ExpenseRequisition.js";
import PaymentVoucher from "../../models/PaymentVoucher.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import { resolveBusinessId } from "../../utils/requestContext.js";
import { parsePagination } from "../../utils/pagination.js";
import { createError } from "../../utils/error.js";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

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

    const whtRate = Math.min(30, Math.max(0, Number(req.body?.whtRate || 0)));
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
      accountName: req.body?.accountName || "",
      subjectToWht: Boolean(req.body?.subjectToWht) && whtRate > 0,
      whtRate:      Boolean(req.body?.subjectToWht) && whtRate > 0 ? whtRate : 0,
      whtCategory:  String(req.body?.whtCategory || "").trim(),
      isActive: req.body?.isActive !== false,
      notes: req.body?.notes || "",
    });

    res.status(201).json(doc);
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
      ServiceProvider.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      ServiceProvider.countDocuments(filter),
    ]);
    res.status(200).json({ success: true, data: rows, total, page: pageNum, pages: Math.max(1, Math.ceil(total / limitNum)) });
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

    const allowed = ["name", "contactPerson", "email", "phone", "category", "kraPin", "accountNumber", "paybillNumber", "bankName", "accountName", "subjectToWht", "whtRate", "whtCategory", "isActive", "notes"];
    allowed.forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(req.body || {}, field)) return;
      if (field === "name") { row[field] = String(req.body[field] || "").trim(); return; }
      row[field] = req.body[field];
    });

    if (!String(row.name || "").trim()) {
      return next(createError(400, "Service provider name is required"));
    }
    // Normalize WHT fields: clamp rate, clear subjectToWht if rate is effectively zero
    row.whtRate = Math.min(30, Math.max(0, Number(row.whtRate || 0)));
    if (row.subjectToWht && row.whtRate <= 0) row.subjectToWht = false;
    if (!row.subjectToWht) row.whtRate = 0;
    await row.save();
    res.status(200).json(row);
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
