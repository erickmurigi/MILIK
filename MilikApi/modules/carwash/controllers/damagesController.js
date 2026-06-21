import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import CarWashStaffDamage from "../models/CarWashStaffDamage.js";
import CarWashStaff from "../models/CarWashStaff.js";
import { currentUserId, resolveActiveBusinessId, resolveActiveBranchId } from "../services/businessScope.js";
import { computeDamageInstallment } from "../services/damagesService.js";

const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;

const ensureStaff = async (business, staffId) => {
  if (!staffId || !mongoose.Types.ObjectId.isValid(String(staffId))) throw createError(400, "Invalid staff member");
  const staff = await CarWashStaff.findOne({ _id: staffId, business }).select("_id name").lean();
  if (!staff) throw createError(400, "Staff member does not belong to this business");
  return staff;
};

export const listDamages = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const branchId = resolveActiveBranchId(req);

    const filter = { business };
    if (branchId) filter.branch = new mongoose.Types.ObjectId(String(branchId));
    if (req.query.staff && mongoose.Types.ObjectId.isValid(String(req.query.staff))) {
      filter.staff = new mongoose.Types.ObjectId(String(req.query.staff));
    }
    if (req.query.status && req.query.status !== "all") filter.status = req.query.status;
    if (req.query.dateFrom || req.query.dateTo) {
      filter.damageDate = {};
      if (req.query.dateFrom) { const d = new Date(req.query.dateFrom); d.setUTCHours(0, 0, 0, 0); filter.damageDate.$gte = d; }
      if (req.query.dateTo)   { const d = new Date(req.query.dateTo);   d.setUTCHours(23, 59, 59, 999); filter.damageDate.$lte = d; }
    }

    const page  = Math.max(parseInt(req.query.page  || 1,   10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || 50, 10) || 50, 1), 200);

    const [damages, total] = await Promise.all([
      CarWashStaffDamage.find(filter)
        .populate("staff", "name phone role")
        .populate("job",   "jobNumber plateNumber")
        .populate("commissionPayout", "payoutNumber payoutDate")
        .sort({ damageDate: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      CarWashStaffDamage.countDocuments(filter),
    ]);

    res.json({ success: true, data: damages, damages, total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    next(error);
  }
};

export const createDamage = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const branchId = resolveActiveBranchId(req);
    const userId   = currentUserId(req);

    const staff = await ensureStaff(business, req.body.staff);

    const amount = round2(Number(req.body.amount));
    if (!Number.isFinite(amount) || amount <= 0) return next(createError(400, "Amount must be greater than zero"));

    const description = String(req.body.description || "").trim();
    if (!description) return next(createError(400, "Description is required"));

    const damageDate = req.body.damageDate ? new Date(req.body.damageDate) : new Date();
    if (Number.isNaN(damageDate.getTime())) return next(createError(400, "Invalid damage date"));

    const jobId = req.body.job && mongoose.Types.ObjectId.isValid(String(req.body.job))
      ? req.body.job : null;

    // Installment deduction settings
    const VALID_MODES = ["full", "percent", "fixed"];
    const deductionMode = VALID_MODES.includes(req.body.deductionMode) ? req.body.deductionMode : "full";
    let deductionValue = null;
    if (deductionMode === "percent") {
      const pct = Number(req.body.deductionValue);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return next(createError(400, "Percent deduction must be 1–100"));
      deductionValue = round2(pct);
    } else if (deductionMode === "fixed") {
      const fixed = round2(Number(req.body.deductionValue));
      if (!Number.isFinite(fixed) || fixed <= 0) return next(createError(400, "Fixed deduction amount must be greater than zero"));
      deductionValue = fixed;
    }

    const damage = await CarWashStaffDamage.create({
      business,
      branch:      branchId || null,
      staff:       staff._id,
      amount,
      description,
      damageDate,
      job:         jobId,
      notes:       String(req.body.notes || "").trim(),
      recordedBy:  userId,
      deductionMode,
      deductionValue,
    });

    const populated = await CarWashStaffDamage.findById(damage._id)
      .populate("staff", "name phone role")
      .lean();

    res.status(201).json({ success: true, data: populated, damage: populated, message: "Damage record created" });
  } catch (error) {
    next(error);
  }
};

export const waiveDamage = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const damage   = await CarWashStaffDamage.findOne({ _id: req.params.id, business });
    if (!damage) return next(createError(404, "Damage record not found"));
    if (damage.status === "deducted") return next(createError(400, "Cannot waive a damage that has already been deducted from a payout"));
    if (damage.status === "waived")   return next(createError(400, "Already waived"));

    damage.status   = "waived";
    damage.waivedBy = userId;
    damage.waivedAt = new Date();
    damage.notes    = [damage.notes, String(req.body.notes || "").trim()].filter(Boolean).join(" | ");
    await damage.save();

    res.json({ success: true, data: damage, message: "Damage waived — will not be deducted from payouts" });
  } catch (error) {
    next(error);
  }
};

export const deleteDamage = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const damage   = await CarWashStaffDamage.findOne({ _id: req.params.id, business });
    if (!damage) return next(createError(404, "Damage record not found"));
    if (damage.status === "deducted") return next(createError(400, "Cannot delete a damage that has already been deducted from a payout"));

    await CarWashStaffDamage.deleteOne({ _id: damage._id });
    res.json({ success: true, message: "Damage record deleted" });
  } catch (error) {
    next(error);
  }
};

export const listDamagesBalances = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const branchId = resolveActiveBranchId(req);

    const staffFilter = { business, active: { $ne: false } };
    if (branchId) staffFilter.branch = branchId;

    const dmgFilter = { business };
    if (branchId) dmgFilter.branch = new mongoose.Types.ObjectId(String(branchId));

    // Aggregate damage totals by staff in MongoDB — avoids loading every damage document
    const [allStaff, damageStats] = await Promise.all([
      CarWashStaff.find(staffFilter).select("_id name role").lean(),
      CarWashStaffDamage.aggregate([
        { $match: dmgFilter },
        { $group: {
          _id:           '$staff',
          totalDeducted: { $sum: { $cond: [{ $eq: ['$status', 'deducted'] }, '$amount', 0] } },
          totalWaived:   { $sum: { $cond: [{ $eq: ['$status', 'waived']   }, '$amount', 0] } },
          pendingDocs:   { $push: { $cond: [
            { $and: [{ $ne: ['$status', 'deducted'] }, { $ne: ['$status', 'waived'] }] },
            { amount: '$amount', amountRecovered: '$amountRecovered', deductionMode: '$deductionMode', deductionValue: '$deductionValue' },
            '$$REMOVE',
          ]}},
        }},
        { $match: { $or: [{ totalDeducted: { $gt: 0 } }, { totalWaived: { $gt: 0 } }, { 'pendingDocs.0': { $exists: true } }] } },
      ]),
    ]);

    // Compute installment totals in JS (only for pending docs — much smaller set)
    const byStaff = new Map(damageStats.map((d) => {
      const pendingAmount = round2(d.pendingDocs.reduce((s, doc) => s + round2((doc.amount || 0) - (doc.amountRecovered || 0)), 0));
      const pendingInstallment = round2(d.pendingDocs.reduce((s, doc) => s + computeDamageInstallment(doc), 0));
      return [String(d._id), { pendingAmount, pendingInstallment, totalDeducted: round2(d.totalDeducted), totalWaived: round2(d.totalWaived) }];
    }));

    const empty = { pendingAmount: 0, pendingInstallment: 0, totalDeducted: 0, totalWaived: 0 };
    const withPending = allStaff
      .map((s) => ({ staff: s, ...(byStaff.get(String(s._id)) || empty) }))
      .filter((s) => s.pendingAmount > 0 || s.totalDeducted > 0 || s.totalWaived > 0);

    res.json({ success: true, data: withPending, balances: withPending });
  } catch (error) {
    next(error);
  }
};
