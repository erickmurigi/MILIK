import mongoose from "mongoose";
import AccountingPeriod from "../../models/AccountingPeriod.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";

const toObjectId = (v) => {
  const raw = typeof v === "object" && v?._id ? v._id : v;
  if (!raw || !mongoose.Types.ObjectId.isValid(String(raw))) return null;
  return new mongoose.Types.ObjectId(String(raw));
};

const resolveBusinessId = (req) => {
  const authenticated = req.user?.company?._id || req.user?.company || null;
  const requested = req.query?.business || req.query?.company || req.body?.business || req.body?.company || null;
  if (req.user?.isSystemAdmin || req.user?.superAdminAccess) {
    return toObjectId(requested || authenticated);
  }
  return toObjectId(authenticated || requested);
};

// ─── LIST ─────────────────────────────────────────────────────────────────────
export const getAccountingPeriods = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return res.status(400).json({ message: "Missing business" });

    const periods = await AccountingPeriod.find({ business: businessId })
      .populate("closedBy", "name email")
      .populate("lockedBy", "name email")
      .populate("reopenedBy", "name email")
      .sort({ startDate: -1 })
      .lean();

    return res.status(200).json(periods);
  } catch (err) {
    next(err);
  }
};

// ─── GET ONE ──────────────────────────────────────────────────────────────────
export const getAccountingPeriod = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    const period = await AccountingPeriod.findOne({ _id: req.params.id, business: businessId })
      .populate("closedBy", "name email")
      .populate("lockedBy", "name email")
      .lean();
    if (!period) return res.status(404).json({ message: "Period not found" });
    return res.status(200).json(period);
  } catch (err) {
    next(err);
  }
};

// ─── CREATE ───────────────────────────────────────────────────────────────────
export const createAccountingPeriod = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return res.status(400).json({ message: "Missing business" });

    const { name, startDate, endDate, notes } = req.body;
    if (!name || !startDate || !endDate)
      return res.status(400).json({ message: "name, startDate and endDate are required" });

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    if (start >= end)
      return res.status(400).json({ message: "startDate must be before endDate" });

    // Prevent overlapping open/closed periods
    const overlap = await AccountingPeriod.findOne({
      business: businessId,
      status: { $in: ["open", "closed"] },
      $or: [
        { startDate: { $lte: end }, endDate: { $gte: start } },
      ],
    }).lean();
    if (overlap)
      return res.status(409).json({
        message: `Period overlaps with existing period "${overlap.name}" (${overlap.status})`,
      });

    const period = await AccountingPeriod.create({
      business: businessId,
      name,
      startDate: start,
      endDate: end,
      notes: notes || "",
      status: "open",
    });

    return res.status(201).json(period);
  } catch (err) {
    next(err);
  }
};

// ─── UPDATE ───────────────────────────────────────────────────────────────────
export const updateAccountingPeriod = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    const period = await AccountingPeriod.findOne({ _id: req.params.id, business: businessId });
    if (!period) return res.status(404).json({ message: "Period not found" });

    if (period.status === "locked")
      return res.status(400).json({ message: "Locked periods cannot be edited" });

    const { name, notes } = req.body;
    if (name) period.name = name;
    if (notes !== undefined) period.notes = notes;

    await period.save();
    return res.status(200).json(period);
  } catch (err) {
    next(err);
  }
};

// ─── CLOSE ───────────────────────────────────────────────────────────────────
export const closeAccountingPeriod = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    const period = await AccountingPeriod.findOne({ _id: req.params.id, business: businessId });
    if (!period) return res.status(404).json({ message: "Period not found" });

    if (period.status !== "open")
      return res.status(400).json({ message: `Period is already ${period.status}` });

    period.status = "closed";
    period.closedBy = req.user?._id || null;
    period.closedAt = new Date();
    await period.save();

    return res.status(200).json({ message: "Period closed successfully", period });
  } catch (err) {
    next(err);
  }
};

// ─── REOPEN ──────────────────────────────────────────────────────────────────
export const reopenAccountingPeriod = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    const period = await AccountingPeriod.findOne({ _id: req.params.id, business: businessId });
    if (!period) return res.status(404).json({ message: "Period not found" });

    if (period.status === "locked")
      return res.status(400).json({ message: "Locked periods cannot be reopened" });

    if (period.status === "open")
      return res.status(400).json({ message: "Period is already open" });

    period.status = "open";
    period.reopenedBy = req.user?._id || null;
    period.reopenedAt = new Date();
    await period.save();

    return res.status(200).json({ message: "Period reopened successfully", period });
  } catch (err) {
    next(err);
  }
};

// ─── LOCK ─────────────────────────────────────────────────────────────────────
export const lockAccountingPeriod = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    const period = await AccountingPeriod.findOne({ _id: req.params.id, business: businessId });
    if (!period) return res.status(404).json({ message: "Period not found" });

    if (period.status === "locked")
      return res.status(400).json({ message: "Period is already locked" });

    if (period.status === "open")
      return res.status(400).json({
        message: "Close the period before locking it",
      });

    period.status = "locked";
    period.lockedBy = req.user?._id || null;
    period.lockedAt = new Date();
    await period.save();

    return res.status(200).json({ message: "Period locked permanently", period });
  } catch (err) {
    next(err);
  }
};

// ─── PERIOD STATS (entry counts, amounts for the period) ─────────────────────
export const getAccountingPeriodStats = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    const period = await AccountingPeriod.findOne({ _id: req.params.id, business: businessId }).lean();
    if (!period) return res.status(404).json({ message: "Period not found" });

    const [stats] = await FinancialLedgerEntry.aggregate([
      {
        $match: {
          business: toObjectId(businessId),
          transactionDate: { $gte: period.startDate, $lte: period.endDate },
          status: { $in: ["approved", "reversed"] },
        },
      },
      {
        $group: {
          _id: null,
          totalEntries: { $sum: 1 },
          totalDebits: { $sum: "$debit" },
          totalCredits: { $sum: "$credit" },
          approvedCount: { $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] } },
          reversedCount: { $sum: { $cond: [{ $eq: ["$status", "reversed"] }, 1, 0] } },
        },
      },
    ]);

    return res.status(200).json({
      period,
      stats: stats || {
        totalEntries: 0,
        totalDebits: 0,
        totalCredits: 0,
        approvedCount: 0,
        reversedCount: 0,
      },
    });
  } catch (err) {
    next(err);
  }
};
