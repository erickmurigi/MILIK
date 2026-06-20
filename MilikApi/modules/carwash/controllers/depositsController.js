import { createError } from "../../../utils/error.js";
import mongoose from "mongoose";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import CarWashDeposit from "../models/CarWashDeposit.js";
import { currentUserId, escapeRegex, parseDateRange, resolveActiveBusinessId, resolveActiveBranchId } from "../services/businessScope.js";

const DESTINATIONS = new Set(["bank", "mpesa", "safe", "other"]);
const STATUSES = new Set(["pending", "confirmed", "cancelled"]);

const generateDepositNumber = async (business) => {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `CWD-${stamp}-`;
  const latest = await CarWashDeposit.findOne(
    { business, depositNumber: { $regex: `^${prefix}` } },
    { depositNumber: 1 },
    { sort: { depositNumber: -1 } }
  ).lean();
  const nextNum = latest ? parseInt(latest.depositNumber.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(nextNum).padStart(4, "0")}`;
};

const buildFilter = (req, business) => {
  const filter = { business };
  const branchId = resolveActiveBranchId(req);
  if (branchId) filter.branch = branchId;
  if (req.query.status) filter.status = String(req.query.status).trim().toLowerCase();
  if (req.query.destination) filter.destination = String(req.query.destination).trim().toLowerCase();
  if (req.query.cashbookAccount && mongoose.Types.ObjectId.isValid(String(req.query.cashbookAccount))) {
    filter.cashbookAccount = String(req.query.cashbookAccount);
  }
  if (req.query.reference) filter.reference = new RegExp(escapeRegex(String(req.query.reference).trim()), "i");
  if (req.query.date) {
    const { start, end } = parseDateRange(req.query.date);
    filter.depositDate = { $gte: start, $lt: end };
  }
  return filter;
};

const resolveCashbookAccount = async (business, value) => {
  const accountId = String(value || "").trim();
  if (!accountId) return null;
  if (!mongoose.Types.ObjectId.isValid(accountId)) {
    throw createError(400, "Invalid Car Wash deposit cashbook account");
  }

  const account = await ChartOfAccount.findOne({
    _id: accountId,
    business,
    type: "asset",
    isPosting: true,
    subGroup: { $regex: "cashbook", $options: "i" },
  }).lean();

  if (!account) {
    throw createError(400, "Select a valid posting cashbook account for this Car Wash deposit");
  }

  return account._id;
};

const summarizeDeposits = async (filter) => {
  const aggregateFilter = { ...filter };
  if (aggregateFilter.business && mongoose.Types.ObjectId.isValid(String(aggregateFilter.business))) {
    aggregateFilter.business = new mongoose.Types.ObjectId(String(aggregateFilter.business));
  }
  if (aggregateFilter.cashbookAccount && mongoose.Types.ObjectId.isValid(String(aggregateFilter.cashbookAccount))) {
    aggregateFilter.cashbookAccount = new mongoose.Types.ObjectId(String(aggregateFilter.cashbookAccount));
  }

  const rows = await CarWashDeposit.aggregate([
    { $match: aggregateFilter },
    { $group: { _id: "$status", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
  ]);
  const summary = {
    pending: { amount: 0, count: 0 },
    confirmed: { amount: 0, count: 0 },
    cancelled: { amount: 0, count: 0 },
    totalAmount: 0,
    totalCount: 0,
  };
  rows.forEach((row) => {
    const key = row._id || "pending";
    if (!summary[key]) return;
    summary[key] = { amount: Number(row.amount || 0), count: Number(row.count || 0) };
    if (key !== "cancelled") {
      summary.totalAmount += Number(row.amount || 0);
      summary.totalCount += Number(row.count || 0);
    }
  });
  return summary;
};

export const listDeposits = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = buildFilter(req, business);
    const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 100);
    const page = Math.max(Number(req.query.page || 1), 1);
    const skip = (page - 1) * limit;
    const [deposits, total, summary] = await Promise.all([
      CarWashDeposit.find(filter)
        .populate("depositedBy", "name username email")
        .populate("confirmedBy", "name username email")
        .populate("cashbookAccount", "code name type subGroup balance")
        .populate("branch", "name")
        .sort({ depositDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      CarWashDeposit.countDocuments(filter),
      summarizeDeposits(filter),
    ]);
    const pagination = { page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) };
    res.status(200).json({ success: true, data: { deposits, pagination, summary }, deposits, pagination, summary });
  } catch (error) {
    next(error);
  }
};

export const createDeposit = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const amount = Number(req.body.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) return next(createError(400, "Deposit amount must be greater than zero"));

    const destination = String(req.body.destination || "bank").trim().toLowerCase();
    if (!DESTINATIONS.has(destination)) return next(createError(400, "Invalid Car Wash deposit destination"));
    const cashbookAccount = await resolveCashbookAccount(business, req.body.cashbookAccount);
    if (!cashbookAccount) return next(createError(400, "Cashbook account is required for Car Wash deposits"));

    const userId = currentUserId(req);
    const ctxBranch  = resolveActiveBranchId(req);
    const bodyBranch = !ctxBranch && req.body.branch && mongoose.Types.ObjectId.isValid(String(req.body.branch)) ? String(req.body.branch) : null;
    const branchId   = ctxBranch || bodyBranch;
    const manualDepositNumber = String(req.body.depositNumber || "").trim();
    const depositBase = {
      business,
      branch: branchId || null,
      depositDate: req.body.depositDate ? new Date(req.body.depositDate) : new Date(),
      amount,
      destination,
      cashbookAccount,
      reference: String(req.body.reference || "").trim(),
      status: "pending",
      notes: String(req.body.notes || "").trim(),
      depositedBy: userId,
      createdBy: userId,
      updatedBy: userId,
    };
    let deposit;
    for (let attempt = 0; attempt < 3; attempt++) {
      const depositNumber = manualDepositNumber || (await generateDepositNumber(business));
      try {
        deposit = await CarWashDeposit.create({ ...depositBase, depositNumber });
        break;
      } catch (err) {
        if (err.code === 11000 && err.keyPattern?.depositNumber && !manualDepositNumber && attempt < 2) continue;
        throw err;
      }
    }
    res.status(201).json({ success: true, data: deposit, deposit, message: "Car Wash deposit recorded" });
  } catch (error) {
    next(error);
  }
};

export const updateDepositStatus = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const status   = String(req.body.status || "").trim().toLowerCase();
    if (!STATUSES.has(status)) return next(createError(400, "Invalid Car Wash deposit status"));

    const deposit = await CarWashDeposit.findOne({ _id: req.params.id, business });
    if (!deposit) return next(createError(404, "Car Wash deposit not found"));

    // State machine guards
    if (deposit.status === "cancelled") return next(createError(400, "Cancelled deposits cannot be changed"));
    if (deposit.status === "confirmed" && status === "pending") return next(createError(400, "Confirmed deposits cannot be moved back to pending — cancel instead"));
    if (deposit.status === status) return next(createError(400, `Deposit is already ${status}`));

    const userId = currentUserId(req);
    deposit.status    = status;
    deposit.notes     = String(req.body.notes || deposit.notes || "").trim();
    deposit.updatedBy = userId;

    if (status === "confirmed") {
      deposit.confirmedBy = userId;
      deposit.confirmedAt = new Date();
    }
    if (status === "cancelled") {
      deposit.cancelledBy     = userId;
      deposit.cancelledAt     = new Date();
      deposit.cancellationNote = String(req.body.notes || "").trim();
    }

    await deposit.save();
    await deposit.populate([
      { path: "depositedBy",  select: "name username email" },
      { path: "confirmedBy",  select: "name username email" },
      { path: "cashbookAccount", select: "code name type subGroup balance" },
    ]);
    res.status(200).json({ success: true, data: deposit, deposit, message: "Car Wash deposit status updated" });
  } catch (error) {
    next(error);
  }
};
