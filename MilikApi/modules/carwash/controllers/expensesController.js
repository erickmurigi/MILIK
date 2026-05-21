import { createError } from "../../../utils/error.js";
import mongoose from "mongoose";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import CarWashExpense from "../models/CarWashExpense.js";
import { currentUserId, escapeRegex, parseDateRange, resolveActiveBusinessId, resolveActiveBranchId } from "../services/businessScope.js";

const METHODS = new Set(["cash", "mpesa", "bank", "card", "other"]);
const STATUSES = new Set(["draft", "approved", "paid", "cancelled"]);

const generateExpenseNumber = async (business) => {
  const { start, end } = parseDateRange(new Date());
  const count = await CarWashExpense.countDocuments({ business, createdAt: { $gte: start, $lt: end } });
  const stamp = start.toISOString().slice(0, 10).replace(/-/g, "");
  return `CWE-${stamp}-${String(count + 1).padStart(4, "0")}`;
};

const resolveCashbookAccount = async (business, value, required = false) => {
  const accountId = String(value || "").trim();
  if (!accountId) {
    if (required) throw createError(400, "Cashbook account is required for paid Car Wash expenses");
    return null;
  }
  if (!mongoose.Types.ObjectId.isValid(accountId)) {
    throw createError(400, "Invalid Car Wash expense cashbook account");
  }

  const account = await ChartOfAccount.findOne({
    _id: accountId,
    business,
    type: "asset",
    isPosting: true,
    subGroup: { $regex: "cashbook", $options: "i" },
  }).lean();

  if (!account) {
    throw createError(400, "Select a valid posting cashbook account for this Car Wash expense");
  }

  return account._id;
};

const buildFilter = (req, business) => {
  const filter = { business };
  const branchId = resolveActiveBranchId(req);
  if (branchId) filter.branch = branchId;
  if (req.query.status) filter.status = String(req.query.status).trim().toLowerCase();
  if (req.query.category) filter.category = new RegExp(escapeRegex(String(req.query.category).trim()), "i");
  if (req.query.method) filter.method = String(req.query.method).trim().toLowerCase();
  if (req.query.cashbookAccount && mongoose.Types.ObjectId.isValid(String(req.query.cashbookAccount))) {
    filter.cashbookAccount = String(req.query.cashbookAccount);
  }
  if (req.query.search) {
    const search = escapeRegex(String(req.query.search).trim());
    filter.$or = [
      { expenseNumber: new RegExp(search, "i") },
      { payee: new RegExp(search, "i") },
      { category: new RegExp(search, "i") },
      { description: new RegExp(search, "i") },
      { reference: new RegExp(search, "i") },
    ];
  }
  if (req.query.date) {
    const { start, end } = parseDateRange(req.query.date);
    filter.expenseDate = { $gte: start, $lt: end };
  } else if (req.query.startDate || req.query.endDate) {
    filter.expenseDate = {};
    if (req.query.startDate) filter.expenseDate.$gte = parseDateRange(req.query.startDate).start;
    if (req.query.endDate) filter.expenseDate.$lt = parseDateRange(req.query.endDate).end;
  }
  return filter;
};

const toAggregateFilter = (filter = {}) => {
  const aggregateFilter = { ...filter };
  if (aggregateFilter.business && mongoose.Types.ObjectId.isValid(String(aggregateFilter.business))) {
    aggregateFilter.business = new mongoose.Types.ObjectId(String(aggregateFilter.business));
  }
  if (aggregateFilter.cashbookAccount && mongoose.Types.ObjectId.isValid(String(aggregateFilter.cashbookAccount))) {
    aggregateFilter.cashbookAccount = new mongoose.Types.ObjectId(String(aggregateFilter.cashbookAccount));
  }
  return aggregateFilter;
};

const summarizeExpenses = async (filter) => {
  const [statusRows, methodRows, categoryRows] = await Promise.all([
    CarWashExpense.aggregate([{ $match: toAggregateFilter(filter) }, { $group: { _id: "$status", amount: { $sum: "$amount" }, count: { $sum: 1 } } }]),
    CarWashExpense.aggregate([{ $match: { ...toAggregateFilter(filter), status: { $ne: "cancelled" } } }, { $group: { _id: "$method", amount: { $sum: "$amount" }, count: { $sum: 1 } } }]),
    CarWashExpense.aggregate([
      { $match: { ...toAggregateFilter(filter), status: { $ne: "cancelled" } } },
      { $group: { _id: "$category", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
      { $sort: { amount: -1, count: -1 } },
      { $limit: 20 },
    ]),
  ]);

  const summary = {
    draft: { amount: 0, count: 0 },
    approved: { amount: 0, count: 0 },
    paid: { amount: 0, count: 0 },
    cancelled: { amount: 0, count: 0 },
    totalAmount: 0,
    totalCount: 0,
    byMethod: {},
    byCategory: categoryRows.map((row) => ({ category: row._id || "Unspecified", amount: Number(row.amount || 0), count: Number(row.count || 0) })),
  };

  statusRows.forEach((row) => {
    const key = row._id || "draft";
    if (!summary[key]) return;
    summary[key] = { amount: Number(row.amount || 0), count: Number(row.count || 0) };
    if (key !== "cancelled") {
      summary.totalAmount += Number(row.amount || 0);
      summary.totalCount += Number(row.count || 0);
    }
  });
  methodRows.forEach((row) => {
    summary.byMethod[row._id || "other"] = { amount: Number(row.amount || 0), count: Number(row.count || 0) };
  });
  return summary;
};

export const listExpenses = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = buildFilter(req, business);
    const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 100);
    const page = Math.max(Number(req.query.page || 1), 1);
    const skip = (page - 1) * limit;

    const [expenses, total, summary] = await Promise.all([
      CarWashExpense.find(filter)
        .populate("cashbookAccount", "code name type subGroup balance")
        .populate("createdBy", "name username email")
        .populate("approvedBy", "name username email")
        .populate("paidBy", "name username email")
        .populate("branch", "name")
        .sort({ expenseDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      CarWashExpense.countDocuments(filter),
      summarizeExpenses(filter),
    ]);
    const pagination = { page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) };
    res.status(200).json({ success: true, data: { expenses, pagination, summary }, expenses, pagination, summary });
  } catch (error) {
    next(error);
  }
};

export const createExpense = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const amount = Number(req.body.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) return next(createError(400, "Expense amount must be greater than zero"));

    const category = String(req.body.category || "").trim();
    if (!category) return next(createError(400, "Expense category is required"));

    const method = String(req.body.method || "cash").trim().toLowerCase();
    if (!METHODS.has(method)) return next(createError(400, "Invalid Car Wash expense payment method"));

    const status = String(req.body.status || "paid").trim().toLowerCase();
    if (!STATUSES.has(status)) return next(createError(400, "Invalid Car Wash expense status"));
    if (status === "cancelled") return next(createError(400, "Create the expense first before cancelling it"));

    const cashbookAccount = await resolveCashbookAccount(business, req.body.cashbookAccount, status === "paid");
    const userId = currentUserId(req);
    const branchId = resolveActiveBranchId(req);
    const expense = await CarWashExpense.create({
      business,
      branch: branchId || null,
      expenseNumber: String(req.body.expenseNumber || "").trim() || (await generateExpenseNumber(business)),
      expenseDate: req.body.expenseDate ? new Date(req.body.expenseDate) : new Date(),
      payee: String(req.body.payee || "").trim(),
      category,
      description: String(req.body.description || "").trim(),
      amount,
      method,
      cashbookAccount,
      reference: String(req.body.reference || "").trim(),
      status,
      notes: String(req.body.notes || "").trim(),
      createdBy: userId,
      approvedBy: status === "approved" || status === "paid" ? userId : null,
      approvedAt: status === "approved" || status === "paid" ? new Date() : null,
      paidBy: status === "paid" ? userId : null,
      paidAt: status === "paid" ? new Date() : null,
      updatedBy: userId,
    });
    res.status(201).json({ success: true, data: expense, expense, message: "Car Wash expense recorded" });
  } catch (error) {
    next(error);
  }
};

export const updateExpenseStatus = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const status = String(req.body.status || "").trim().toLowerCase();
    if (!STATUSES.has(status)) return next(createError(400, "Invalid Car Wash expense status"));

    const expense = await CarWashExpense.findOne({ _id: req.params.id, business });
    if (!expense) return next(createError(404, "Car Wash expense not found"));
    if (expense.status === "cancelled") return next(createError(400, "Cancelled Car Wash expenses cannot be changed"));
    if (expense.status === "paid" && status !== "paid") {
      return next(createError(400, "Paid Car Wash expenses cannot be changed from paid in this version"));
    }
    if (expense.status === "approved" && status === "draft") {
      return next(createError(400, "Approved Car Wash expenses cannot be moved back to draft"));
    }
    if (status === "cancelled" && expense.status === "paid") {
      return next(createError(400, "Paid Car Wash expenses cannot be cancelled in this version"));
    }

    const userId = currentUserId(req);
    if (status === "paid") {
      const cashbookAccount = await resolveCashbookAccount(business, req.body.cashbookAccount || expense.cashbookAccount, true);
      expense.cashbookAccount = cashbookAccount;
      expense.paidBy = userId;
      expense.paidAt = new Date();
      if (!expense.approvedAt) {
        expense.approvedBy = userId;
        expense.approvedAt = new Date();
      }
    }

    if (status === "approved" && !expense.approvedAt) {
      expense.approvedBy = userId;
      expense.approvedAt = new Date();
    }

    expense.status = status;
    expense.notes = String(req.body.notes ?? expense.notes ?? "").trim();
    expense.updatedBy = userId;
    await expense.save();

    const populated = await CarWashExpense.findById(expense._id)
      .populate("cashbookAccount", "code name type subGroup balance")
      .populate("createdBy", "name username email")
      .populate("approvedBy", "name username email")
      .populate("paidBy", "name username email");
    res.status(200).json({ success: true, data: populated, expense: populated, message: "Car Wash expense status updated" });
  } catch (error) {
    next(error);
  }
};
