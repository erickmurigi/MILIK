import mongoose from "mongoose";
import ExpenseRequisition from "../../models/ExpenseRequisition.js";
import ServiceProvider from "../../models/ServiceProvider.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import Budget from "../../models/Budget.js";
import CompanySettings from "../../models/CompanySettings.js";
import Company from "../../models/Company.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";
import { postEntry, postReversal } from "../../services/ledgerPostingService.js";
import { aggregateChartOfAccountBalances } from "../../services/chartAccountAggregationService.js";
import { resolveConfiguredAccountingDefaultAccount } from "../../services/companyAccountingDefaultsService.js";
import { resolveBusinessId } from "../../utils/requestContext.js";
import { parsePagination } from "../../utils/pagination.js";
import { createError } from "../../utils/error.js";
import { toObjectId } from "../../utils/db.js";
import { round2 } from "../../utils/math.js";
import { hasCompanyActionPermission, isSystemAdminUser } from "../../utils/permissionControl.js";

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
    .populate("expenseAccount", "code name type")
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

  if (Object.prototype.hasOwnProperty.call(body || {}, "expenseAccount")) {
    row.expenseAccount = await resolveExpenseAccountId(row.business, body?.expenseAccount);
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
    requisition.expenseAccount
      ? ChartOfAccount.findOne({
          _id: requisition.expenseAccount,
          business: requisition.business,
          isPosting: { $ne: false },
          isHeader: { $ne: true },
        }).lean()
      : resolveRequisitionExpenseAccount(requisition.business, requisition.category),
    // "accountsPayableAccount" — not "purchaseClearingAccount" (a stray, unrelated inventory-module
    // key that happens to share a similar name but is read by a completely different resolver).
    // Using the wrong key here meant getAccountingDefaultDefinition always returned null, so this
    // accrual's AP leg silently never posted for any expense requisition, ever — paymentVoucher.js's
    // settlement leg already (correctly) resolves this same account via "accountsPayableAccount",
    // so the two legs of the same vendor liability were never actually using the same control
    // account to begin with. Found via the vendor take-on balance test asserting on real GL entries.
    resolveConfiguredAccountingDefaultAccount({ businessId: requisition.business, field: "accountsPayableAccount" }),
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
      metadata: { postingRole: "ap_invoice_expense", requisitionNo: requisition.requisitionNo || requisition.referenceNo || "", isTakeOnBalance: requisition.isTakeOnBalance === true },
    });
    await postEntry({
      ...base, direction: "credit", debit: 0, credit: amount, accountId: apAccount._id,
      metadata: { postingRole: "ap_invoice_liability", offsetOfEntryId: String(debitLeg._id), requisitionNo: requisition.requisitionNo || requisition.referenceNo || "", isTakeOnBalance: requisition.isTakeOnBalance === true },
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

// ─── BUDGET HEADROOM CHECK ───────────────────────────────────────────────────
// A lightweight, advisory check (not a hard block) against Budget's account-keyed lines — see
// budgets.js's computeActuals/computeMonthlyActuals for the report-grade equivalent this mirrors.
// Deliberately re-implemented here (single account, not a whole budget's lines) rather than
// exported/reused, to keep this module's only real dependency on Budget being "read a line", not
// an internal aggregation helper that budgets.js is free to change shape later.

const REPORT_LEDGER_STATUSES = ["approved", "reversed"]; // reversal nets: original flips to
// "reversed" (keeps its amount), offsetting entry posts "approved" — both legs needed to net right.

const monthKeyOf = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const computeAccountActual = async (businessId, accountId, start, end) => {
  const rangeEnd = new Date(end);
  rangeEnd.setHours(23, 59, 59, 999);
  const [row] = await FinancialLedgerEntry.aggregate([
    {
      $match: {
        business: toObjectId(businessId),
        accountId: toObjectId(accountId),
        status: { $in: REPORT_LEDGER_STATUSES },
        // A take-on balance is historical debt carried forward, not spend actually incurred during
        // this budget period — exclude it the same way computeCommittedAmount already does.
        "metadata.isTakeOnBalance": { $ne: true },
        transactionDate: { $gte: new Date(start), $lte: rangeEnd },
      },
    },
    {
      $group: {
        _id: null,
        debit: { $sum: { $cond: [{ $eq: ["$direction", "debit"] }, { $ifNull: ["$amount", 0] }, 0] } },
        credit: { $sum: { $cond: [{ $eq: ["$direction", "credit"] }, { $ifNull: ["$amount", 0] }, 0] } },
      },
    },
  ]).allowDiskUse(true);
  // Expense accounts are normal debit-side: actual spend = debit - credit.
  return round2((row?.debit || 0) - (row?.credit || 0));
};

const computeCommittedAmount = async ({ businessId, accountId, excludeRequisitionId, start, end }) => {
  const match = {
    business: toObjectId(businessId),
    expenseAccount: toObjectId(accountId),
    status: { $in: ["submitted", "approved"] },
    // A take-on balance is historical debt, not a new commitment against this period's budget.
    isTakeOnBalance: { $ne: true },
    requestDate: { $gte: new Date(start), $lte: new Date(end) },
  };
  if (excludeRequisitionId) match._id = { $ne: toObjectId(excludeRequisitionId) };
  const [row] = await ExpenseRequisition.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: { $ifNull: ["$amount", 0] } } } },
  ]);
  return round2(row?.total || 0);
};

// Returns null when there's no active budget / no line for this account — meaning "no budget
// constraint configured", not "zero budget". Callers must treat null as advisory-skip, not overBudget.
const computeBudgetCheck = async ({ businessId, accountId, amount, excludeRequisitionId, asOfDate }) => {
  if (!accountId) return null;
  const date = asOfDate ? new Date(asOfDate) : new Date();

  const budget = await Budget.findOne({
    business: businessId,
    status: "active",
    periodStart: { $lte: date },
    periodEnd: { $gte: date },
  })
    .sort({ periodStart: -1 })
    .lean();
  if (!budget) return null;

  const line = (budget.lines || []).find((l) => String(l.account) === String(accountId));
  if (!line) return null;

  let budgeted = Number(line.budgetedAmount || 0);
  let period = budget.name;
  let rangeStart = budget.periodStart;
  let rangeEnd = budget.periodEnd;

  if (Array.isArray(line.monthlyAmounts) && line.monthlyAmounts.length) {
    const monthStr = monthKeyOf(date);
    const monthEntry = line.monthlyAmounts.find((m) => m.month === monthStr);
    budgeted = Number(monthEntry?.amount || 0);
    period = monthStr;
    rangeStart = new Date(date.getFullYear(), date.getMonth(), 1);
    rangeEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  }

  const [committed, actual] = await Promise.all([
    computeCommittedAmount({ businessId, accountId, excludeRequisitionId, start: rangeStart, end: rangeEnd }),
    computeAccountActual(businessId, accountId, rangeStart, rangeEnd),
  ]);

  const available = round2(budgeted - committed - actual);

  return {
    budgetId: budget._id,
    lineId: line._id,
    period,
    budgeted: round2(budgeted),
    committed,
    actual,
    available,
    overBudget: Number(amount) > available,
    checkedAt: new Date(),
  };
};

const applyBudgetCheck = async (row, { excludeSelf = true } = {}) => {
  if (!row.expenseAccount) return null;
  const check = await computeBudgetCheck({
    businessId: row.business,
    accountId: row.expenseAccount,
    amount: row.amount,
    excludeRequisitionId: excludeSelf ? row._id : null,
    asOfDate: new Date(),
  });
  if (check) row.budgetCheck = check;
  return check;
};

// ─── AMOUNT-BASED APPROVAL TIER ──────────────────────────────────────────────
// expenses.approve (checked at the route level) covers approval up to the company's configured
// threshold. Above it, the approver additionally needs expenses.approveHighValue. A null/unset
// threshold disables tiering entirely — every company that hasn't configured one keeps today's
// flat-permission behavior.

const getExpenseApprovalThreshold = async (businessId) => {
  const settings = await CompanySettings.findOne({ company: businessId })
    .select("expenseApprovalThreshold")
    .lean();
  const value = Number(settings?.expenseApprovalThreshold);
  return Number.isFinite(value) && value > 0 ? value : null;
};

const ensureHighValueApprovalPermission = async (req, businessId, amount, threshold) => {
  if (!threshold || Number(amount) <= Number(threshold)) return;
  if (isSystemAdminUser(req.user)) return;
  // Loaded directly from businessId (already resolved by the caller) rather than via
  // attachResolvedCompany, which depends on req.headers/req.body carrying the active company —
  // context this controller already has independently of how the route got there.
  const company = await Company.findById(businessId).lean();
  const allowed = hasCompanyActionPermission({
    user: req.user,
    company,
    moduleKey: "accounts",
    resource: "expenses",
    action: "approveHighValue",
  });
  if (!allowed) {
    const error = new Error(
      `This requisition (${amount}) exceeds the company's high-value approval threshold of ${threshold}. A senior approver is required.`
    );
    error.statusCode = 403;
    throw error;
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
    const expenseAccountId = await resolveExpenseAccountId(businessId, req.body?.expenseAccount);

    const doc = new ExpenseRequisition({
      business: businessId,
      requisitionNo,
      referenceNo: requisitionNo,
      property: req.body.property,
      unit: isValidObjectId(req.body?.unit) ? req.body.unit : null,
      landlord: isValidObjectId(req.body?.landlord) ? req.body.landlord : null,
      serviceProvider: serviceProviderId,
      expenseAccount: expenseAccountId,
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

    if (requestedStatus === "submitted") {
      await applyBudgetCheck(doc, { excludeSelf: false });
    }

    await doc.save();

    await doc.populate([
      { path: "property", select: "propertyName propertyCode name" },
      { path: "unit", select: "unitNumber name" },
      { path: "landlord", select: "landlordName firstName lastName" },
      { path: "serviceProvider", select: "name providerCode phone email category" },
      { path: "expenseAccount", select: "code name type" },
      { path: "requestedBy", select: "username email firstName lastName" },
      { path: "submittedBy", select: "username email firstName lastName" },
    ]);
    return res.status(201).json(doc);
  } catch (error) {
    next(error);
  }
};

// Records what a vendor was already owed before they were onboarded here — created pre-approved
// (skips draft/submit/approve and the budget check entirely, since it's historical fact, not a
// new spending decision) and posts the exact same accrual GL entry a normal approval would, so it
// shows up in the vendor's Outstanding balance, creditor statement and AP aging automatically with
// no changes needed to any of those. No property is required (see the model's conditional
// `required`) — a take-on balance is a vendor/AP matter, not necessarily tied to one property.
// Correcting a mistake uses the normal lifecycle already in place for every other requisition:
// cancel it (reverses the GL entry via reverseRequisitionAccrualGL) then delete it.
export const createVendorTakeOnBalance = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    const actorUserId = await resolveActorUserId(req, businessId);
    if (!businessId) return next(createError(400, "Company context is required"));
    if (!actorUserId) return next(createError(400, "Authenticated user is required"));

    if (!isValidObjectId(req.body?.serviceProvider)) {
      return next(createError(400, "A service provider is required for an opening balance"));
    }
    const provider = await ServiceProvider.findOne({ _id: req.body.serviceProvider, business: businessId }).select("name providerCode").lean();
    if (!provider) return next(createError(404, "Service provider not found"));

    const amount = Number(req.body?.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return next(createError(400, "A valid opening balance amount is required"));
    }

    const expenseAccountId = await resolveExpenseAccountId(businessId, req.body?.expenseAccount);
    if (!expenseAccountId) {
      return next(createError(400, "A valid expense account is required to post the opening balance"));
    }

    const effectiveDate = parseDate(req.body?.effectiveDate, new Date());
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (effectiveDate > today) {
      return next(createError(400, "The effective date cannot be in the future"));
    }

    const requisitionNo = await generateRequisitionNo(businessId);
    const title = String(req.body?.title || "").trim() || `Opening Balance — ${provider.name}`;

    const doc = new ExpenseRequisition({
      business: businessId,
      requisitionNo,
      referenceNo: requisitionNo,
      property: null,
      serviceProvider: provider._id,
      vendorName: provider.name,
      expenseAccount: expenseAccountId,
      title,
      description: String(req.body?.notes || req.body?.description || "").trim(),
      notes: String(req.body?.notes || "").trim(),
      amount,
      requestDate: effectiveDate,
      category: "general",
      status: "approved",
      isTakeOnBalance: true,
      requestedBy: actorUserId,
      approvedBy: actorUserId,
      approvedAt: effectiveDate,
    });

    await doc.save();
    await postRequisitionAccrualGL({ requisition: doc, actorUserId });

    await doc.populate([
      { path: "serviceProvider", select: "name providerCode phone email category" },
      { path: "expenseAccount", select: "code name type" },
      { path: "requestedBy", select: "username email firstName lastName" },
      { path: "approvedBy", select: "username email firstName lastName" },
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
    if (req.query?.status && req.query.status !== "all") {
      filter.status = req.query.status;
    } else if (req.query?.includeCancelled !== "true") {
      // cancelled requisitions are kept for the audit trail but stay out of the working list unless asked for
      filter.status = { $ne: "cancelled" };
    }
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
      await applyBudgetCheck(row);
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
      await applyBudgetCheck(row);
    } else if (status === "approved") {
      const threshold = await getExpenseApprovalThreshold(businessId);
      await ensureHighValueApprovalPermission(req, businessId, row.amount, threshold);

      const budgetCheck = await applyBudgetCheck(row);
      if (budgetCheck?.overBudget) {
        const overrideNote = sanitizeReason(req.body?.approvalOverrideNote || req.body?.overrideNote || "");
        if (!overrideNote) {
          const overBudgetError = createError(
            400,
            `This requisition exceeds available budget (available: ${budgetCheck.available}, requested: ${row.amount}). An approval override note is required to approve it anyway.`
          );
          overBudgetError.data = { budgetCheck };
          return next(overBudgetError);
        }
        row.approvalOverrideNote = overrideNote;
      }

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

export const batchDeleteExpenseRequisitions = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Company context is required"));

    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    const validIds = Array.from(
      new Set(ids.map((id) => String(id || "").trim()).filter((id) => mongoose.Types.ObjectId.isValid(id)))
    );

    if (!validIds.length) {
      return next(createError(400, "At least one requisition id is required."));
    }

    const rows = await ExpenseRequisition.find({ _id: { $in: validIds }, business: businessId });
    const rowMap = new Map(rows.map((row) => [String(row._id), row]));

    const succeeded = [];
    const failed = [];
    const deletableIds = [];

    validIds.forEach((id) => {
      const row = rowMap.get(id);
      if (!row) {
        failed.push({ id, reason: "Expense requisition not found." });
        return;
      }

      if (!["draft", "rejected", "cancelled"].includes(String(row.status))) {
        failed.push({ id, requisitionNo: row.requisitionNo, reason: "Only draft, rejected, or cancelled requisitions can be deleted." });
        return;
      }

      if (row.linkedVoucher) {
        failed.push({ id, requisitionNo: row.requisitionNo, reason: "This requisition is linked to a payment voucher and cannot be deleted." });
        return;
      }

      deletableIds.push(row._id);
      succeeded.push({ id, requisitionNo: row.requisitionNo });
    });

    if (deletableIds.length) {
      await ExpenseRequisition.deleteMany({ _id: { $in: deletableIds }, business: businessId });
    }

    return res.status(200).json({
      succeeded,
      failed,
      succeededCount: succeeded.length,
      failedCount: failed.length,
    });
  } catch (error) {
    next(error);
  }
};
