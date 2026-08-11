import mongoose from "mongoose";
import ExpenseRequisition from "../../models/ExpenseRequisition.js";
import ServiceProvider from "../../models/ServiceProvider.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";
import { postEntry, postReversal } from "../../services/ledgerPostingService.js";
import { aggregateChartOfAccountBalances } from "../../services/chartAccountAggregationService.js";
import { resolveConfiguredAccountingDefaultAccount } from "../../services/companyAccountingDefaultsService.js";
import { resolveBusinessId } from "../../utils/requestContext.js";
import { parsePagination } from "../../utils/pagination.js";
import { createError } from "../../utils/error.js";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const VALID_CATEGORIES = ["maintenance", "repair", "utility", "tax", "insurance", "supplies", "other", "general"];
const VALID_PRIORITIES = ["low", "normal", "high", "urgent"];
const VALID_STATUSES = ["draft", "submitted", "approved", "rejected", "converted", "cancelled"];

const resolveActorUserId = async (req, businessId) =>
  resolveAuditActorUserId({
    req,
    businessId,
    fallbackErrorMessage: "No valid company user could be resolved for expense requisition attribution.",
  });

const parseDate = (value, fallback = null) => {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
};

const normalizeCategory = (value) => {
  const normalized = String(value || "other").trim().toLowerCase();
  return VALID_CATEGORIES.includes(normalized) ? normalized : "other";
};

const normalizePriority = (value) => {
  const normalized = String(value || "normal").trim().toLowerCase();
  return VALID_PRIORITIES.includes(normalized) ? normalized : "normal";
};

const normalizeStatus = (value, fallback = "draft") => {
  const normalized = String(value || fallback).trim().toLowerCase();
  return VALID_STATUSES.includes(normalized) ? normalized : fallback;
};

const sanitizeReason = (value, fallback = "") => String(value || fallback).trim();

const populateQuery = (query) =>
  query
    .populate("property", "propertyName propertyCode name")
    .populate("unit", "unitNumber name")
    .populate("landlord", "landlordName firstName lastName")
    .populate("serviceProvider", "name providerCode phone email category")
    .populate("requestedBy", "username email firstName lastName")
    .populate("submittedBy", "username email firstName lastName")
    .populate("approvedBy", "username email firstName lastName")
    .populate("rejectedBy", "username email firstName lastName")
    .populate("cancelledBy", "username email firstName lastName")
    .populate("convertedBy", "username email firstName lastName")
    .populate("linkedVoucher", "voucherNo status amount dueDate reference");

const generateRequisitionNo = async (businessId) => {
  const prefix = "ERQ";
  const last = await ExpenseRequisition.findOne(
    {
      business: businessId,
      $or: [
        { requisitionNo: { $regex: `^${prefix}\\d+$` } },
        { referenceNo: { $regex: `^${prefix}\\d+$` } },
      ],
    },
    { requisitionNo: 1, referenceNo: 1 },
    { sort: { createdAt: -1 } }
  ).lean();

  const lastNo = last?.requisitionNo || last?.referenceNo || "";
  const seq = lastNo ? (parseInt(String(lastNo).replace(prefix, ""), 10) || 0) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
};

const resolveVendorName = async (serviceProviderId, fallbackVendorName = "") => {
  if (isValidObjectId(serviceProviderId)) {
    const provider = await ServiceProvider.findById(serviceProviderId).select("name").lean();
    if (provider?.name) return provider.name;
  }
  return String(fallbackVendorName || "").trim();
};

const ensureEditableDraft = (row) => {
  if (String(row?.status || "") !== "draft") {
    const error = new Error("Only draft expense requisitions can be edited. Recall or reopen the requisition first.");
    error.statusCode = 400;
    throw error;
  }
};

const ensureNoLinkedVoucher = (row, message = "This requisition is already linked to a payment voucher.") => {
  if (row?.linkedVoucher) {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  }
};

const setSubmittedAudit = (row, actorUserId) => {
  row.submittedAt = row.submittedAt || new Date();
  row.submittedBy = row.submittedBy || actorUserId;
  row.cancelledAt = null;
  row.cancelledBy = null;
  row.cancellationReason = "";
};

const clearSubmissionAuditForDraft = (row) => {
  row.submittedAt = null;
  row.submittedBy = null;
};

const setApprovedAudit = (row, actorUserId, approvalNote = "") => {
  row.approvedAt = new Date();
  row.approvedBy = actorUserId;
  row.approvalNote = sanitizeReason(approvalNote, row.approvalNote || "");
  row.rejectedAt = null;
  row.rejectedBy = null;
  row.rejectionReason = "";
  row.cancelledAt = null;
  row.cancelledBy = null;
  row.cancellationReason = "";
};

const setRejectedAudit = (row, actorUserId, reason) => {
  row.rejectedAt = new Date();
  row.rejectedBy = actorUserId;
  row.rejectionReason = sanitizeReason(reason, "Rejected");
};

const setCancelledAudit = (row, actorUserId, reason) => {
  row.cancelledAt = new Date();
  row.cancelledBy = actorUserId;
  row.cancellationReason = sanitizeReason(reason, "Cancelled");
};

const applyDraftFieldUpdates = async (row, body = {}) => {
  if (Object.prototype.hasOwnProperty.call(body || {}, "title")) {
    const title = String(body?.title || "").trim();
    if (!title) {
      const error = new Error("Requisition title is required");
      error.statusCode = 400;
      throw error;
    }
    row.title = title;
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, "description")) {
    row.description = String(body?.description || "").trim();
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, "notes")) {
    row.notes = String(body?.notes || "").trim();
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, "category")) {
    row.category = normalizeCategory(body?.category);
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, "priority")) {
    row.priority = normalizePriority(body?.priority);
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, "amount")) {
    const amount = Number(body?.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      const error = new Error("Valid requisition amount is required");
      error.statusCode = 400;
      throw error;
    }
    row.amount = amount;
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, "property")) {
    if (!isValidObjectId(body?.property)) {
      const error = new Error("Property is required");
      error.statusCode = 400;
      throw error;
    }
    row.property = body.property;
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, "unit")) {
    row.unit = isValidObjectId(body?.unit) ? body.unit : null;
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, "landlord")) {
    row.landlord = isValidObjectId(body?.landlord) ? body.landlord : null;
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, "requestDate")) {
    const requestDate = parseDate(body?.requestDate, null);
    if (!requestDate) {
      const error = new Error("Valid request date is required");
      error.statusCode = 400;
      throw error;
    }
    row.requestDate = requestDate;
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, "neededBy") || Object.prototype.hasOwnProperty.call(body || {}, "neededByDate")) {
    const neededBy = parseDate(body?.neededBy || body?.neededByDate, null);
    row.neededBy = neededBy;
    row.neededByDate = neededBy;
  }

  if (Object.prototype.hasOwnProperty.call(body || {}, "serviceProvider")) {
    row.serviceProvider = isValidObjectId(body?.serviceProvider) ? body.serviceProvider : null;
    row.vendorName = await resolveVendorName(row.serviceProvider, body?.vendorName || row.vendorName);
  } else if (Object.prototype.hasOwnProperty.call(body || {}, "vendorName")) {
    row.vendorName = String(body?.vendorName || "").trim();
  }
};

const ensureAllowedTransition = (row, nextStatus) => {
  const currentStatus = String(row?.status || "draft");

  if (currentStatus === nextStatus) {
    return;
  }

  const allowed = {
    draft: ["submitted", "cancelled"],
    submitted: ["approved", "rejected", "draft", "cancelled"],
    approved: ["cancelled"],
    rejected: ["draft", "cancelled"],
    converted: [],
    cancelled: ["draft"],
  };

  if (!allowed[currentStatus]?.includes(nextStatus)) {
    const error = new Error(`Cannot move expense requisition from ${currentStatus} to ${nextStatus}.`);
    error.statusCode = 400;
    throw error;
  }
};

// ─── GL HELPERS ──────────────────────────────────────────────────────────────

const buildStatementPeriod = (value) => {
  const dt = value ? new Date(value) : new Date();
  const year = dt.getFullYear();
  const month = dt.getMonth();
  return { start: new Date(year, month, 1, 0, 0, 0, 0), end: new Date(year, month + 1, 0, 23, 59, 59, 999) };
};

const CATEGORY_ACCOUNT_CANDIDATES = {
  maintenance: [{ nameRegex: "maintenance", type: "expense" }, { nameRegex: "repair", type: "expense" }],
  repair:      [{ nameRegex: "repair", type: "expense" }, { nameRegex: "maintenance", type: "expense" }],
  utility:     [{ nameRegex: "utilit", type: "expense" }],
  tax:         [{ nameRegex: "tax|rates|levies", type: "expense" }],
  insurance:   [{ nameRegex: "insurance", type: "expense" }],
  supplies:    [{ nameRegex: "supplies|consumable|stationery", type: "expense" }],
  other:       [{ nameRegex: "general.*expense|operating.*expense|other.*expense", type: "expense" }],
  general:     [{ nameRegex: "general.*expense|operating.*expense|other.*expense", type: "expense" }],
};

const resolveRequisitionExpenseAccount = async (businessId, category) => {
  const candidates = CATEGORY_ACCOUNT_CANDIDATES[category] || CATEGORY_ACCOUNT_CANDIDATES.other;
  for (const c of candidates) {
    const account = await ChartOfAccount.findOne({
      business: businessId, type: "expense",
      isPosting: { $ne: false }, isHeader: { $ne: true },
      ...(c.nameRegex && { name: { $regex: c.nameRegex, $options: "i" } }),
    }).lean();
    if (account) return account;
  }
  return ChartOfAccount.findOne({ business: businessId, type: "expense", isPosting: { $ne: false }, isHeader: { $ne: true } }).lean();
};

const postRequisitionAccrualGL = async ({ requisition, actorUserId }) => {
  if (!requisition.serviceProvider || !Number(requisition.amount)) return;

  const [expenseAccount, apAccount] = await Promise.all([
    resolveRequisitionExpenseAccount(requisition.business, requisition.category),
    resolveConfiguredAccountingDefaultAccount({ businessId: requisition.business, field: "purchaseClearingAccount" }),
  ]);
  if (!expenseAccount || !apAccount) return;

  const txDate = requisition.approvedAt || new Date();
  const { start, end } = buildStatementPeriod(txDate);
  const journalGroupId = new mongoose.Types.ObjectId();
  const amount = Math.abs(Number(requisition.amount));
  const narration = `Expense Accrual — ${requisition.title || requisition.requisitionNo}`;

  const base = {
    business: requisition.business,
    property: requisition.property || null,
    allowUnscoped: !requisition.property,
    serviceProvider: requisition.serviceProvider,
    sourceTransactionType: "expense_requisition",
    sourceTransactionId: String(requisition._id),
    transactionDate: txDate,
    statementPeriodStart: start,
    statementPeriodEnd: end,
    category: "EXPENSE_DEDUCTION",
    amount,
    journalGroupId,
    payer: "manager",
    receiver: "vendor",
    notes: narration,
    createdBy: actorUserId,
    approvedBy: actorUserId,
    approvedAt: new Date(),
    status: "approved",
  };

  let debitLeg;
  try {
    debitLeg = await postEntry({
      ...base, direction: "debit", debit: amount, credit: 0, accountId: expenseAccount._id,
      metadata: { postingRole: "ap_invoice_expense", requisitionNo: requisition.requisitionNo || requisition.referenceNo || "" },
    });
    await postEntry({
      ...base, direction: "credit", debit: 0, credit: amount, accountId: apAccount._id,
      metadata: { postingRole: "ap_invoice_liability", offsetOfEntryId: String(debitLeg._id), requisitionNo: requisition.requisitionNo || requisition.referenceNo || "" },
    });
  } catch (error) {
    if (debitLeg?._id) {
      await postReversal({ entryId: debitLeg._id, reason: `Auto-reversal: GL balance protection for requisition accrual ${requisition.requisitionNo || requisition._id}`, userId: actorUserId }).catch(() => null);
    }
    throw error;
  }

  await aggregateChartOfAccountBalances(String(requisition.business), [String(expenseAccount._id), String(apAccount._id)]);
};

const reverseRequisitionAccrualGL = async ({ requisition, actorUserId }) => {
  if (!requisition.serviceProvider) return;
  const entries = await FinancialLedgerEntry.find({
    business: requisition.business,
    sourceTransactionType: "expense_requisition",
    sourceTransactionId: String(requisition._id),
    status: "approved",
    reversalOf: null,
  }).lean();
  for (const entry of entries) {
    await postReversal({
      entryId: entry._id,
      reason: `Requisition cancelled — ${requisition.cancellationReason || requisition.requisitionNo || ""}`,
      userId: actorUserId,
    });
  }
};

// ─── CONTROLLERS ──────────────────────────────────────────────────────────────

export const createExpenseRequisition = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    const actorUserId = await resolveActorUserId(req, businessId);

    if (!businessId) return next(createError(400, "Company context is required"));
    if (!actorUserId) return next(createError(400, "Authenticated user is required"));
    if (!isValidObjectId(req.body?.property)) {
      return next(createError(400, "Property is required"));
    }

    const amount = Number(req.body?.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return next(createError(400, "Valid requisition amount is required"));
    }

    const title = String(req.body?.title || "").trim();
    if (!title) {
      return next(createError(400, "Requisition title is required"));
    }

    const requestedStatus = normalizeStatus(req.body?.status, "draft");
    if (!["draft", "submitted"].includes(requestedStatus)) {
      return next(createError(400, "New expense requisitions can only be saved as draft or submitted for approval."));
    }

    const requisitionNo =
      String(req.body?.requisitionNo || req.body?.referenceNo || "").trim() ||
      (await generateRequisitionNo(businessId));
    const requestedDate = parseDate(req.body?.requestDate, new Date());
    const neededBy = parseDate(req.body?.neededBy || req.body?.neededByDate, null);
    const serviceProviderId = isValidObjectId(req.body?.serviceProvider) ? req.body.serviceProvider : null;

    const doc = await ExpenseRequisition.create({
      business: businessId,
      requisitionNo,
      referenceNo: requisitionNo,
      property: req.body.property,
      unit: isValidObjectId(req.body?.unit) ? req.body.unit : null,
      landlord: isValidObjectId(req.body?.landlord) ? req.body.landlord : null,
      serviceProvider: serviceProviderId,
      title,
      description: String(req.body?.description || "").trim(),
      amount,
      requestDate: requestedDate,
      neededBy,
      neededByDate: neededBy,
      priority: normalizePriority(req.body?.priority),
      category: normalizeCategory(req.body?.category),
      status: requestedStatus,
      notes: String(req.body?.notes || "").trim(),
      vendorName: await resolveVendorName(serviceProviderId, req.body?.vendorName),
      requestedBy: actorUserId,
      submittedBy: requestedStatus === "submitted" ? actorUserId : null,
      submittedAt: requestedStatus === "submitted" ? new Date() : null,
    });

    await doc.populate([
      { path: "property", select: "propertyName propertyCode name" },
      { path: "unit", select: "unitNumber name" },
      { path: "landlord", select: "landlordName firstName lastName" },
      { path: "serviceProvider", select: "name providerCode phone email category" },
      { path: "requestedBy", select: "username email firstName lastName" },
      { path: "submittedBy", select: "username email firstName lastName" },
    ]);
    return res.status(201).json(doc);
  } catch (error) {
    next(error);
  }
};

export const getExpenseRequisitions = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Company context is required"));

    const filter = { business: businessId };
    if (req.query?.status && req.query.status !== "all") filter.status = req.query.status;
    const propId = req.query?.property || req.query?.propertyId;
    if (propId && isValidObjectId(propId)) filter.property = propId;
    if (req.query?.serviceProvider && isValidObjectId(req.query.serviceProvider)) filter.serviceProvider = req.query.serviceProvider;
    if (req.query?.search) {
      const term = String(req.query.search).trim();
      filter.$or = [
        { requisitionNo: { $regex: term, $options: "i" } },
        { referenceNo: { $regex: term, $options: "i" } },
        { title: { $regex: term, $options: "i" } },
        { description: { $regex: term, $options: "i" } },
        { category: { $regex: term, $options: "i" } },
        { vendorName: { $regex: term, $options: "i" } },
        { notes: { $regex: term, $options: "i" } },
      ];
    }

    const { page: pageNum, limit: limitNum, skip } = parsePagination(req, { defaultLimit: 50, maxLimit: 200 });

    const [rows, total] = await Promise.all([
      populateQuery(
        ExpenseRequisition.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum)
      ).lean(),
      ExpenseRequisition.countDocuments(filter),
    ]);

    res.status(200).json({ success: true, data: rows, total, page: pageNum, pages: Math.ceil(total / limitNum) });
  } catch (error) {
    next(error);
  }
};

export const updateExpenseRequisition = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Company context is required"));

    const row = await ExpenseRequisition.findOne({ _id: req.params.id, business: businessId });
    if (!row) return next(createError(404, "Expense requisition not found"));

    ensureEditableDraft(row);

    await applyDraftFieldUpdates(row, req.body || {});

    const requestedStatus = Object.prototype.hasOwnProperty.call(req.body || {}, "status")
      ? normalizeStatus(req.body?.status, row.status)
      : row.status;

    if (!["draft", "submitted"].includes(requestedStatus)) {
      return next(createError(400, "Draft edits can only remain as draft or be submitted for approval."));
    }

    row.status = requestedStatus;
    if (requestedStatus === "submitted") {
      const actorUserId = await resolveActorUserId(req, businessId);
      setSubmittedAudit(row, actorUserId);
    } else {
      clearSubmissionAuditForDraft(row);
    }

    await row.save();
    const populated = await populateQuery(ExpenseRequisition.findById(row._id));
    res.status(200).json(await populated);
  } catch (error) {
    next(error);
  }
};

export const updateExpenseRequisitionStatus = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Company context is required"));

    const status = normalizeStatus(req.body?.status, "");
    if (!status) {
      return next(createError(400, "Invalid requisition status"));
    }

    if (status === "converted") {
      return next(createError(400, "Expense requisitions become converted only when a payment voucher is created from them."));
    }

    const row = await ExpenseRequisition.findOne({ _id: req.params.id, business: businessId });
    if (!row) return next(createError(404, "Expense requisition not found"));

    ensureAllowedTransition(row, status);

    if (["cancelled", "draft", "rejected"].includes(status)) {
      ensureNoLinkedVoucher(
        row,
        "This requisition is linked to a payment voucher. Clear or delete the voucher first."
      );
    }

    const actorUserId = await resolveActorUserId(req, businessId);
    const previousStatus = row.status;

    row.status = status;

    if (status === "submitted") {
      setSubmittedAudit(row, actorUserId);
      row.approvedAt = null;
      row.approvedBy = null;
      row.approvalNote = "";
      row.rejectedAt = null;
      row.rejectedBy = null;
      row.rejectionReason = "";
      row.cancelledAt = null;
      row.cancelledBy = null;
      row.cancellationReason = "";
    } else if (status === "approved") {
      setApprovedAudit(row, actorUserId, req.body?.approvalNote || req.body?.reason || "");
      await postRequisitionAccrualGL({ requisition: row, actorUserId });
    } else if (status === "rejected") {
      const reason = sanitizeReason(req.body?.reason || req.body?.rejectionReason || "");
      if (!reason) {
        return next(createError(400, "Rejection reason is required."));
      }
      setRejectedAudit(row, actorUserId, reason);
    } else if (status === "cancelled") {
      const reason = sanitizeReason(req.body?.reason || req.body?.cancellationReason || "Cancelled");
      setCancelledAudit(row, actorUserId, reason);
      if (previousStatus === "approved") {
        await reverseRequisitionAccrualGL({ requisition: row, actorUserId });
      }
    } else if (status === "draft") {
      clearSubmissionAuditForDraft(row);
      row.approvedAt = null;
      row.approvedBy = null;
      row.approvalNote = "";
      row.rejectedAt = null;
      row.rejectedBy = null;
      row.rejectionReason = "";
      row.cancelledAt = null;
      row.cancelledBy = null;
      row.cancellationReason = "";
    }

    await row.save();
    const populated = await populateQuery(ExpenseRequisition.findById(row._id)).lean();
    res.status(200).json(populated);
  } catch (error) {
    next(error);
  }
};

export const deleteExpenseRequisition = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Company context is required"));

    const row = await ExpenseRequisition.findOne({ _id: req.params.id, business: businessId });
    if (!row) return next(createError(404, "Expense requisition not found"));

    if (!["draft", "rejected", "cancelled"].includes(String(row.status))) {
      return next(createError(400, "Only draft, rejected, or cancelled requisitions can be deleted."));
    }

    ensureNoLinkedVoucher(row, "This requisition is linked to a payment voucher and cannot be deleted.");

    await ExpenseRequisition.deleteOne({ _id: row._id, business: businessId });
    res.status(200).json({
      success: true,
      message: "Expense requisition deleted",
      deletedId: String(row._id),
    });
  } catch (error) {
    next(error);
  }
};
