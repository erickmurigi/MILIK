import { createError } from "../../../utils/error.js";
import mongoose from "mongoose";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import CarWashExpense from "../models/CarWashExpense.js";
import CarWashBranch from "../models/CarWashBranch.js";
import CarWashExpenseCategoryConfig from "../models/CarWashExpenseCategoryConfig.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import { currentUserId, escapeRegex, parseDateRange, resolveActiveBusinessId, resolveActiveBranchId } from "../services/businessScope.js";
import { postEntry } from "../../../services/ledgerPostingService.js";
import { aggregateChartOfAccountBalances } from "../../../services/chartAccountAggregationService.js";
import { resolveExpenseAccountForCategory, reverseCarWashExpenseLedger } from "../services/carwashAccountingService.js";

const METHODS  = new Set(["cash", "mpesa", "bank", "card", "other"]);
const STATUSES = new Set(["draft", "approved", "paid", "cancelled"]);

// ── Helpers ───────────────────────────────────────────────────────────────────

const cwDayRange = (value = new Date()) => {
  const d = (value instanceof Date && !Number.isNaN(value.getTime())) ? value : new Date(value);
  const start = new Date(d); start.setHours(0, 0, 0, 0);
  const end   = new Date(start); end.setDate(end.getDate() + 1);
  return { start, end };
};

const normaliseItems = (rawItems) => {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return [];
  return rawItems
    .map((item) => ({
      description: String(item.description || "").trim(),
      qty:         Math.max(Number(item.qty   || 1), 0),
      unitPrice:   Math.max(Number(item.unitPrice || 0), 0),
      amount:      Math.max(Number(item.amount || 0), 0),
    }))
    .filter((item) => item.description && item.amount > 0);
};

const itemsTotal = (items) => items.reduce((sum, i) => sum + i.amount, 0);

const postCwExpenseLedger = async ({ business, expense, cashbookAccountId, userId }) => {
  try {
    const expenseAccount = await resolveExpenseAccountForCategory(business, expense.category);
    if (!expenseAccount?._id || !cashbookAccountId) return;
    // Idempotency guard: skip if this expense already has ledger entries
    const alreadyPosted = await FinancialLedgerEntry.exists({
      business,
      sourceTransactionType: "carwash_expense",
      sourceTransactionId: String(expense._id),
    });
    if (alreadyPosted) return;
    const txDate = expense.expenseDate || expense.paidAt || new Date();
    const { start, end } = cwDayRange(txDate);
    const base = {
      business,
      sourceTransactionType: "carwash_expense",
      sourceTransactionId:   String(expense._id),
      transactionDate:       new Date(txDate),
      statementPeriodStart:  start,
      statementPeriodEnd:    end,
      category:              "CARWASH_EXPENSE",
      amount:                Number(expense.amount),
      payer:                 "n/a",
      receiver:              "vendor",
      createdBy:             userId,
      approvedBy:            userId,
      allowUnscoped:         true,
    };
    const desc = expense.payee || expense.category || expense.expenseNumber || "";
    await postEntry({ ...base, accountId: expenseAccount._id,   direction: "debit",  notes: `CW expense – ${desc}` });
    await postEntry({ ...base, accountId: cashbookAccountId,    direction: "credit", notes: `CW expense paid – ${expense.expenseNumber || ""}` });
    await aggregateChartOfAccountBalances(business, [String(expenseAccount._id), String(cashbookAccountId)]);
  } catch { /* ledger failure must not block the expense */ }
};


const generateExpenseNumber = async (business) => {
  const stamp  = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `CWE-${stamp}-`;
  const latest = await CarWashExpense.findOne(
    { business, expenseNumber: { $regex: `^${prefix}` } },
    { expenseNumber: 1 },
    { sort: { expenseNumber: -1 } }
  ).lean();
  const nextNum = latest ? parseInt(latest.expenseNumber.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(nextNum).padStart(4, "0")}`;
};

const resolveCashbookAccount = async (business, value, required = false) => {
  const accountId = String(value || "").trim();
  if (!accountId) {
    if (required) throw createError(400, "Cashbook account is required for paid expenses");
    return null;
  }
  if (!mongoose.Types.ObjectId.isValid(accountId)) throw createError(400, "Invalid cashbook account");
  const account = await ChartOfAccount.findOne({
    _id: accountId, business, type: "asset", isPosting: true,
    subGroup: { $regex: "cashbook", $options: "i" },
  }).lean();
  if (!account) throw createError(400, "Select a valid posting cashbook account");
  return account._id;
};

const buildFilter = (req, business) => {
  const filter   = { business };
  const branchId = resolveActiveBranchId(req);
  if (branchId) filter.branch = branchId;
  if (req.query.status) filter.status   = String(req.query.status).trim().toLowerCase();
  if (req.query.category) filter.category = new RegExp(escapeRegex(String(req.query.category).trim()), "i");
  if (req.query.method)   filter.method   = String(req.query.method).trim().toLowerCase();
  if (req.query.cashbookAccount && mongoose.Types.ObjectId.isValid(String(req.query.cashbookAccount))) {
    filter.cashbookAccount = String(req.query.cashbookAccount);
  }
  if (req.query.search) {
    const s = escapeRegex(String(req.query.search).trim());
    filter.$or = [
      { expenseNumber: new RegExp(s, "i") },
      { payee:         new RegExp(s, "i") },
      { category:      new RegExp(s, "i") },
      { description:   new RegExp(s, "i") },
      { reference:     new RegExp(s, "i") },
    ];
  }
  if (req.query.date) {
    const { start, end } = parseDateRange(req.query.date);
    filter.expenseDate = { $gte: start, $lt: end };
  } else if (req.query.startDate || req.query.endDate) {
    filter.expenseDate = {};
    if (req.query.startDate) filter.expenseDate.$gte = parseDateRange(req.query.startDate).start;
    if (req.query.endDate)   filter.expenseDate.$lt  = parseDateRange(req.query.endDate).end;
  }
  return filter;
};

const toAggFilter = (filter = {}) => {
  const f = { ...filter };
  if (f.business        && mongoose.Types.ObjectId.isValid(String(f.business)))        f.business        = new mongoose.Types.ObjectId(String(f.business));
  if (f.cashbookAccount && mongoose.Types.ObjectId.isValid(String(f.cashbookAccount))) f.cashbookAccount = new mongoose.Types.ObjectId(String(f.cashbookAccount));
  return f;
};

const summarizeExpenses = async (filter) => {
  const [statusRows, methodRows, categoryRows] = await Promise.all([
    CarWashExpense.aggregate([{ $match: toAggFilter(filter) }, { $group: { _id: "$status",   amount: { $sum: "$amount" }, count: { $sum: 1 } } }]),
    CarWashExpense.aggregate([{ $match: { ...toAggFilter(filter), status: { $ne: "cancelled" } } }, { $group: { _id: "$method",   amount: { $sum: "$amount" }, count: { $sum: 1 } } }]),
    CarWashExpense.aggregate([
      { $match: { ...toAggFilter(filter), status: { $ne: "cancelled" } } },
      { $group: { _id: "$category", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
      { $sort: { amount: -1, count: -1 } },
      { $limit: 20 },
    ]),
  ]);
  const summary = {
    draft: { amount: 0, count: 0 }, approved: { amount: 0, count: 0 },
    paid:  { amount: 0, count: 0 }, cancelled: { amount: 0, count: 0 },
    totalAmount: 0, totalCount: 0, byMethod: {},
    byCategory: categoryRows.map((r) => ({ category: r._id || "Unspecified", amount: Number(r.amount || 0), count: Number(r.count || 0) })),
  };
  statusRows.forEach((r) => {
    const key = r._id || "draft";
    if (!summary[key]) return;
    summary[key] = { amount: Number(r.amount || 0), count: Number(r.count || 0) };
    if (key !== "cancelled") { summary.totalAmount += Number(r.amount || 0); summary.totalCount += Number(r.count || 0); }
  });
  methodRows.forEach((r) => { summary.byMethod[r._id || "other"] = { amount: Number(r.amount || 0), count: Number(r.count || 0) }; });
  return summary;
};

const populateExpense = (query) =>
  query
    .populate("cashbookAccount", "code name type subGroup balance")
    .populate("createdBy",  "name username email")
    .populate("approvedBy", "name username email")
    .populate("paidBy",     "name username email")
    .populate("branch",     "name");

// ── Controllers ───────────────────────────────────────────────────────────────

export const listExpenses = async (req, res, next) => {
  try {
    const business  = resolveActiveBusinessId(req);
    const filter    = buildFilter(req, business);
    const limit     = Math.min(Math.max(Number(req.query.limit || 30), 1), 100);
    const page      = Math.max(Number(req.query.page || 1), 1);
    const [expenses, total, summary] = await Promise.all([
      populateExpense(
        CarWashExpense.find(filter).sort({ expenseDate: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      ).lean(),
      CarWashExpense.countDocuments(filter),
      summarizeExpenses(filter),
    ]);
    const pagination = { page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) };
    res.json({ success: true, data: { expenses, pagination, summary }, expenses, pagination, summary });
  } catch (error) { next(error); }
};

export const createExpense = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);

    // Items or flat amount
    const items  = normaliseItems(req.body.items);
    let   amount = items.length > 0 ? itemsTotal(items) : Number(req.body.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) return next(createError(400, "Expense amount must be greater than zero"));

    const category = String(req.body.category || "").trim();
    if (!category) return next(createError(400, "Expense category is required"));
    const method   = String(req.body.method || "cash").trim().toLowerCase();
    if (!METHODS.has(method))  return next(createError(400, "Invalid payment method"));
    const status   = String(req.body.status || "paid").trim().toLowerCase();
    if (!STATUSES.has(status)) return next(createError(400, "Invalid expense status"));
    if (status === "cancelled") return next(createError(400, "Cannot create a cancelled expense"));

    const cashbookAccount = await resolveCashbookAccount(business, req.body.cashbookAccount, status === "paid");
    const userId          = currentUserId(req);
    const branchId        = resolveActiveBranchId(req);
    const manualNumber    = String(req.body.expenseNumber || "").trim();

    const expenseBase = {
      business,
      branch:       branchId || null,
      expenseDate:  req.body.expenseDate ? new Date(req.body.expenseDate) : new Date(),
      payee:        String(req.body.payee        || "").trim(),
      category,
      description:  String(req.body.description  || "").trim(),
      items,
      amount,
      method,
      cashbookAccount,
      reference:    String(req.body.reference    || "").trim(),
      status,
      notes:        String(req.body.notes        || "").trim(),
      createdBy:    userId,
      approvedBy:   ["approved", "paid"].includes(status) ? userId : null,
      approvedAt:   ["approved", "paid"].includes(status) ? new Date() : null,
      paidBy:       status === "paid" ? userId : null,
      paidAt:       status === "paid" ? new Date() : null,
      updatedBy:    userId,
    };

    let expense;
    for (let attempt = 0; attempt < 3; attempt++) {
      const expenseNumber = manualNumber || (await generateExpenseNumber(business));
      try { expense = await CarWashExpense.create({ ...expenseBase, expenseNumber }); break; }
      catch (err) {
        if (err.code === 11000 && err.keyPattern?.expenseNumber && !manualNumber && attempt < 2) continue;
        throw err;
      }
    }
    if (status === "paid" && cashbookAccount) {
      await postCwExpenseLedger({ business, expense, cashbookAccountId: cashbookAccount, userId });
    }
    res.status(201).json({ success: true, data: expense, expense, message: "Car Wash expense recorded" });
  } catch (error) { next(error); }
};

export const updateExpense = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const expense  = await CarWashExpense.findOne({ _id: req.params.id, business });
    if (!expense) return next(createError(404, "Expense not found"));
    if (!["draft", "approved"].includes(expense.status)) return next(createError(400, "Only draft or approved expenses can be edited"));

    const items  = normaliseItems(req.body.items);
    let   amount = items.length > 0 ? itemsTotal(items) : Number(req.body.amount ?? expense.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) return next(createError(400, "Expense amount must be greater than zero"));

    const category = String(req.body.category ?? expense.category ?? "").trim();
    if (!category) return next(createError(400, "Expense category is required"));
    const method   = String(req.body.method   ?? expense.method   ?? "cash").trim().toLowerCase();
    if (!METHODS.has(method)) return next(createError(400, "Invalid payment method"));

    const cashbookAccount = await resolveCashbookAccount(business, req.body.cashbookAccount ?? expense.cashbookAccount, false);
    const userId = currentUserId(req);

    expense.expenseDate     = req.body.expenseDate ? new Date(req.body.expenseDate) : expense.expenseDate;
    expense.payee           = String(req.body.payee        ?? expense.payee        ?? "").trim();
    expense.category        = category;
    expense.description     = String(req.body.description  ?? expense.description  ?? "").trim();
    expense.items           = items;
    expense.amount          = amount;
    expense.method          = method;
    expense.cashbookAccount = cashbookAccount;
    expense.reference       = String(req.body.reference    ?? expense.reference    ?? "").trim();
    expense.notes           = String(req.body.notes        ?? expense.notes        ?? "").trim();
    expense.updatedBy       = userId;
    await expense.save();

    const populated = await populateExpense(CarWashExpense.findById(expense._id)).lean();
    res.json({ success: true, data: populated, expense: populated, message: "Expense updated" });
  } catch (error) { next(error); }
};

export const deleteExpense = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const expense  = await CarWashExpense.findOne({ _id: req.params.id, business });
    if (!expense) return next(createError(404, "Expense not found"));
    if (expense.status !== "draft") return next(createError(400, "Only draft expenses can be deleted"));
    await expense.deleteOne();
    res.json({ success: true, message: "Expense deleted" });
  } catch (error) { next(error); }
};

const DEFAULT_CATEGORIES = ["Supplies", "Staff Wages", "Water and Utilities", "Equipment Repair", "Rent", "Other"];

export const getExpenseCategories = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const config   = await CarWashExpenseCategoryConfig.findOne({ business }).lean();
    const categories = config?.categories?.length > 0 ? config.categories : DEFAULT_CATEGORIES;
    res.json({ success: true, data: { categories }, categories });
  } catch (error) { next(error); }
};

export const updateExpenseCategories = async (req, res, next) => {
  try {
    const business   = resolveActiveBusinessId(req);
    const categories = (Array.isArray(req.body.categories) ? req.body.categories : [])
      .map((c) => String(c || "").trim())
      .filter(Boolean);
    if (categories.length === 0) return next(createError(400, "At least one category is required"));
    await CarWashExpenseCategoryConfig.findOneAndUpdate({ business }, { categories }, { upsert: true, new: true });
    res.json({ success: true, data: { categories }, categories });
  } catch (error) { next(error); }
};

export const getExpensesReport = async (req, res, next) => {
  try {
    const business   = resolveActiveBusinessId(req);
    const filter     = buildFilter(req, business);
    const baseFilter = toAggFilter(filter);
    const paidFilter = { ...baseFilter, status: "paid" };
    const pendingFilter = { ...baseFilter, status: { $in: ["draft", "approved"] } };

    const [byCategory, byMethod, byBranch, byMonth, byPayee, topExpenses, pendingRows] = await Promise.all([
      CarWashExpense.aggregate([
        { $match: paidFilter },
        { $group: { _id: "$category", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
        { $sort: { amount: -1 } },
      ]),
      CarWashExpense.aggregate([
        { $match: paidFilter },
        { $group: { _id: "$method", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
        { $sort: { amount: -1 } },
      ]),
      CarWashExpense.aggregate([
        { $match: paidFilter },
        { $group: { _id: "$branch", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
        { $sort: { amount: -1 } },
      ]),
      CarWashExpense.aggregate([
        { $match: paidFilter },
        { $group: {
          _id:    { year: { $year: "$expenseDate" }, month: { $month: "$expenseDate" } },
          amount: { $sum: "$amount" },
          count:  { $sum: 1 },
        }},
        { $sort: { "_id.year": 1, "_id.month": 1 } },
      ]),
      // Top 10 payees by paid spend
      CarWashExpense.aggregate([
        { $match: { ...paidFilter, payee: { $nin: ["", null] } } },
        { $group: { _id: "$payee", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
        { $sort: { amount: -1 } },
        { $limit: 10 },
      ]),
      // Top 5 individual paid expenses
      CarWashExpense.find(paidFilter)
        .sort({ amount: -1 })
        .limit(5)
        .select("expenseNumber expenseDate category payee description amount method")
        .lean(),
      // Pending obligations (draft + approved)
      CarWashExpense.aggregate([
        { $match: pendingFilter },
        { $group: { _id: "$status", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
      ]),
    ]);

    const branchIds  = byBranch.map((b) => b._id).filter(Boolean);
    const branchDocs = branchIds.length > 0
      ? await CarWashBranch.find({ _id: { $in: branchIds } }).select("name").lean()
      : [];
    const branchMap  = new Map(branchDocs.map((b) => [String(b._id), b.name]));

    const total = byCategory.reduce((s, c) => s + c.amount, 0);
    const count = byCategory.reduce((s, c) => s + c.count, 0);

    const pending = { draft: 0, approved: 0, total: 0, count: 0 };
    pendingRows.forEach((r) => {
      const key = r._id;
      if (key === "draft" || key === "approved") pending[key] = r.amount;
      pending.total += r.amount;
      pending.count += r.count;
    });

    res.json({
      success: true,
      data: {
        total, count,
        pending,
        byCategory:   byCategory.map((c) => ({ category: c._id || "Unspecified", amount: c.amount, count: c.count })),
        byMethod:     byMethod.map((m)   => ({ method: m._id || "other", amount: m.amount, count: m.count })),
        byBranch:     byBranch.map((b)   => ({ branchId: b._id, branchName: b._id ? (branchMap.get(String(b._id)) || "Unknown") : "Unassigned", amount: b.amount, count: b.count })),
        byMonth:      byMonth.map((m)    => ({ year: m._id.year, month: m._id.month, amount: m.amount, count: m.count })),
        byPayee:      byPayee.map((p)    => ({ payee: p._id, amount: p.amount, count: p.count })),
        topExpenses:  topExpenses.map((e) => ({
          expenseNumber: e.expenseNumber,
          expenseDate:   e.expenseDate,
          category:      e.category,
          payee:         e.payee,
          description:   e.description,
          amount:        e.amount,
          method:        e.method,
        })),
      },
    });
  } catch (error) { next(error); }
};

export const updateExpenseStatus = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const status   = String(req.body.status || "").trim().toLowerCase();
    if (!STATUSES.has(status)) return next(createError(400, "Invalid expense status"));

    const expense = await CarWashExpense.findOne({ _id: req.params.id, business });
    if (!expense) return next(createError(404, "Expense not found"));
    if (expense.status === "cancelled") return next(createError(400, "Cancelled expenses cannot be changed"));
    if (expense.status === "approved" && status === "draft") return next(createError(400, "Approved expenses cannot be moved back to draft"));
    if (expense.status === "paid" && !["paid", "cancelled"].includes(status)) {
      return next(createError(400, "Paid expenses can only be cancelled"));
    }

    const userId   = currentUserId(req);
    const wasPaid  = expense.status === "paid";

    if (status === "paid") {
      const cashbookAccount = await resolveCashbookAccount(business, req.body.cashbookAccount || expense.cashbookAccount, true);
      expense.cashbookAccount = cashbookAccount;
      expense.paidBy = userId;
      expense.paidAt = new Date();
      if (!expense.approvedAt) { expense.approvedBy = userId; expense.approvedAt = new Date(); }
    }
    if (status === "approved" && !expense.approvedAt) {
      expense.approvedBy = userId;
      expense.approvedAt = new Date();
    }

    expense.status    = status;
    expense.notes     = String(req.body.notes ?? expense.notes ?? "").trim();
    expense.updatedBy = userId;
    await expense.save();

    if (status === "paid" && !wasPaid && expense.cashbookAccount) {
      await postCwExpenseLedger({ business, expense, cashbookAccountId: String(expense.cashbookAccount), userId });
    }
    if (status === "cancelled" && wasPaid) {
      await reverseCarWashExpenseLedger({ businessId: business, expense, req });
    }

    const populated = await populateExpense(CarWashExpense.findById(expense._id)).lean();
    res.json({ success: true, data: populated, expense: populated, message: "Expense status updated" });
  } catch (error) { next(error); }
};
