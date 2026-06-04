import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import CarWashCommissionRule from "../models/CarWashCommissionRule.js";
import CarWashStaffCommission from "../models/CarWashStaffCommission.js";
import CarWashCommissionPayout from "../models/CarWashCommissionPayout.js";
import CarWashService from "../models/CarWashService.js";
import CarWashStaff from "../models/CarWashStaff.js";
import { currentUserId, escapeRegex, parseBoolean, parseDateRange, resolveActiveBusinessId, resolveActiveBranchId } from "../services/businessScope.js";
import { generatePayoutNumber } from "../services/commissionService.js";
import { postCarWashCommissionPayout, postCarWashCommissionPayoutWithSavings, resolvePayoutCashbook } from "../services/carwashAccountingService.js";
import { holdSavingsForPayout, getStaffSavingsBalance, disburseSavings, processDailySavings } from "../services/savingsService.js";
import CarWashStaffSaving from "../models/CarWashStaffSaving.js";

const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
const ruleTypes = new Set(["fixed", "percentage"]);
const payoutMethods = new Set(["cash", "mpesa", "bank", "card", "other"]);
const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));

const ensureService = async (business, serviceId) => {
  if (!serviceId) return null;
  if (!mongoose.Types.ObjectId.isValid(String(serviceId))) throw createError(400, "Invalid commission service");
  const service = await CarWashService.findOne({ _id: serviceId, business }).select("_id").lean();
  if (!service) throw createError(400, "Commission service does not belong to this company");
  return service._id;
};

const ensureStaff = async (business, staffId, required = false) => {
  if (!staffId) {
    if (required) throw createError(400, "Select staff");
    return null;
  }
  if (!mongoose.Types.ObjectId.isValid(String(staffId))) throw createError(400, "Invalid staff member");
  const staff = await CarWashStaff.findOne({ _id: staffId, business }).select("_id").lean();
  if (!staff) throw createError(400, "Staff member does not belong to this company");
  return staff._id;
};

export const listCommissionRules = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };
    const active = parseBoolean(req.query.active, undefined);
    if (active !== undefined) filter.active = active;
    if (req.query.search) {
      const search = escapeRegex(String(req.query.search).trim());
      filter.$or = [{ name: new RegExp(search, "i") }, { notes: new RegExp(search, "i") }];
    }

    const rules = await CarWashCommissionRule.find(filter)
      .populate("service", "name category vehicleType")
      .populate("staff", "name phone role")
      .sort({ active: -1, priority: -1, createdAt: -1 })
      .lean();
    res.status(200).json({ success: true, data: { rules }, rules });
  } catch (error) {
    next(error);
  }
};

export const upsertCommissionRule = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const name = String(req.body.name || "").trim();
    if (!name) return next(createError(400, "Rule name is required"));

    const commissionType = String(req.body.commissionType || "fixed").trim().toLowerCase();
    if (!ruleTypes.has(commissionType)) return next(createError(400, "Commission type must be fixed or percentage"));
    const rate = Number(req.body.rate || 0);
    if (!Number.isFinite(rate) || rate < 0) return next(createError(400, "Commission rate must be zero or more"));

    const payload = {
      business,
      name,
      service: await ensureService(business, req.body.service),
      staff: await ensureStaff(business, req.body.staff),
      commissionType,
      rate,
      active: req.body.active !== false,
      priority: Number(req.body.priority || 0),
      notes: String(req.body.notes || "").trim(),
      updatedBy: currentUserId(req),
    };

    let rule;
    if (req.params.id) {
      rule = await CarWashCommissionRule.findOneAndUpdate({ _id: req.params.id, business }, payload, { new: true, runValidators: true });
      if (!rule) return next(createError(404, "Commission rule not found"));
    } else {
      rule = await CarWashCommissionRule.create({ ...payload, createdBy: currentUserId(req) });
    }
    res.status(req.params.id ? 200 : 201).json({ success: true, data: rule, rule, message: "Commission rule saved" });
  } catch (error) {
    next(error);
  }
};

export const listCommissions = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const branchId = resolveActiveBranchId(req);
    const filter = { business: toObjectId(business) };
    if (branchId) filter.branch = toObjectId(branchId);
    if (req.query.status) filter.status = String(req.query.status).trim().toLowerCase();
    if (req.query.staff && mongoose.Types.ObjectId.isValid(String(req.query.staff))) filter.staff = toObjectId(req.query.staff);
    if (req.query.date) {
      const { start, end } = parseDateRange(req.query.date);
      filter.earnedAt = { $gte: start, $lt: end };
    }
    const summaryFilter = { ...filter };
    delete summaryFilter.status;

    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const page = Math.max(Number(req.query.page || 1), 1);
    const skip = (page - 1) * limit;

    const [commissions, total, summaryRows] = await Promise.all([
      CarWashStaffCommission.find(filter)
        .populate("staff", "name phone role")
        .populate("job", "jobNumber plateNumber customerName status paymentStatus price")
        .populate("service", "name category vehicleType")
        .populate("rule", "name commissionType rate")
        .sort({ earnedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      CarWashStaffCommission.countDocuments(filter),
      CarWashStaffCommission.aggregate([
        { $match: summaryFilter },
        { $group: { _id: "$status", amount: { $sum: "$commissionAmount" }, count: { $sum: 1 } } },
      ]),
    ]);

    const summary = summaryRows.reduce((acc, row) => {
      acc[row._id] = { amount: Number(row.amount || 0), count: Number(row.count || 0) };
      acc.total.amount += Number(row.amount || 0);
      acc.total.count += Number(row.count || 0);
      return acc;
    }, { total: { amount: 0, count: 0 } });

    const pagination = { page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) };
    res.status(200).json({ success: true, data: { commissions, pagination, summary }, commissions, pagination, summary });
  } catch (error) {
    next(error);
  }
};

export const createCommissionPayout = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const staff = await ensureStaff(business, req.body.staff, true);
    const ids = Array.isArray(req.body.commissionIds)
      ? req.body.commissionIds.filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
      : [];
    if (!ids.length) return next(createError(400, "Select at least one payable commission"));

    const commissions = await CarWashStaffCommission.find({ _id: { $in: ids }, business, staff, status: "payable" });
    if (!commissions.length) return next(createError(400, "No payable commissions were found for this staff member"));
    if (commissions.length !== ids.length) return next(createError(400, "Some selected commissions are not payable for this staff member"));

    const commissionAmount = round2(commissions.reduce((sum, item) => sum + Number(item.commissionAmount || 0), 0));
    if (commissionAmount <= 0) return next(createError(400, "Selected commissions have no payable amount"));

    const method = String(req.body.method || "cash").trim().toLowerCase();
    if (!payoutMethods.has(method)) return next(createError(400, "Invalid payout method"));
    const cashbookAccount = await resolvePayoutCashbook(business, req.body.cashbookAccount);
    const now = req.body.payoutDate ? new Date(req.body.payoutDate) : new Date();
    const branchId = resolveActiveBranchId(req);

    const manualPayoutNumber = String(req.body.payoutNumber || "").trim();
    const payoutBase = {
      business,
      branch: branchId || null,
      staff,
      amount: commissionAmount,
      method,
      cashbookAccount: cashbookAccount._id,
      reference: String(req.body.reference || "").trim(),
      payoutDate: Number.isNaN(now.getTime()) ? new Date() : now,
      commissions: commissions.map((item) => item._id),
      notes: String(req.body.notes || "").trim(),
      createdBy: currentUserId(req),
      updatedBy: currentUserId(req),
    };
    let payout;
    for (let attempt = 0; attempt < 3; attempt++) {
      const payoutNumber = manualPayoutNumber || (await generatePayoutNumber(business));
      try {
        payout = await CarWashCommissionPayout.create({ ...payoutBase, payoutNumber });
        break;
      } catch (err) {
        if (err.code === 11000 && err.keyPattern?.payoutNumber && !manualPayoutNumber && attempt < 2) continue;
        throw err;
      }
    }

    // Hold pending savings deductions from this commission payout
    const savingsHeld = await holdSavingsForPayout({
      businessId: business,
      staffId: staff,
      commissionPayoutId: payout._id,
      commissionAmount,
    });
    const netCash = round2(commissionAmount - savingsHeld);

    if (savingsHeld > 0) {
      await postCarWashCommissionPayoutWithSavings({ req, payout, cashbookAccount, commissionAmount, netCash, savingsHeld });
    } else {
      await postCarWashCommissionPayout({ req, payout, cashbookAccount });
    }

    await CarWashStaffCommission.updateMany(
      { _id: { $in: commissions.map((item) => item._id) }, business },
      {
        $set: {
          status: "paid",
          paidAt: payout.payoutDate,
          payout: payout._id,
          payoutLedgerEntries: payout.ledgerEntries,
          updatedBy: currentUserId(req),
        },
      }
    );

    res.status(201).json({
      success: true,
      data: { ...payout.toObject(), savingsHeld, netCash },
      payout,
      savingsHeld,
      netCash,
      message: savingsHeld > 0
        ? `Commission payout recorded — Ksh ${savingsHeld.toLocaleString()} held to savings`
        : "Commission payout recorded",
    });
  } catch (error) {
    next(error);
  }
};

export const listCommissionPayouts = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const branchId = resolveActiveBranchId(req);
    const filter = { business };
    if (branchId) filter.branch = branchId;
    if (req.query.staff && mongoose.Types.ObjectId.isValid(String(req.query.staff))) filter.staff = req.query.staff;
    if (req.query.date) {
      const { start, end } = parseDateRange(req.query.date);
      filter.payoutDate = { $gte: start, $lt: end };
    }
    const payouts = await CarWashCommissionPayout.find(filter)
      .populate("staff", "name phone role")
      .populate("cashbookAccount", "code name")
      .populate("branch", "name")
      .sort({ payoutDate: -1, createdAt: -1 })
      .limit(Math.min(Math.max(Number(req.query.limit || 50), 1), 200))
      .lean();
    res.status(200).json({ success: true, data: { payouts }, payouts });
  } catch (error) {
    next(error);
  }
};

// ─── Staff wallet ─────────────────────────────────────────────────────────────
export const getStaffWallet = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const staffId = req.params.staffId;
    if (!mongoose.Types.ObjectId.isValid(String(staffId))) return next(createError(400, "Invalid staff ID"));
    const staff = await CarWashStaff.findOne({ _id: staffId, business }).lean();
    if (!staff) return next(createError(404, "Staff member not found"));

    const businessOid = new mongoose.Types.ObjectId(String(business));
    const staffOid    = new mongoose.Types.ObjectId(String(staffId));

    const [commissionSummary, savings, recentSavings, recentPayouts] = await Promise.all([
      CarWashStaffCommission.aggregate([
        { $match: { business: businessOid, staff: staffOid } },
        { $group: {
            _id: "$status",
            amount: { $sum: "$commissionAmount" },
            count:  { $sum: 1 },
        }},
      ]),
      getStaffSavingsBalance(business, staffId),
      CarWashStaffSaving.find({ business: businessOid, staff: staffOid })
        .sort({ date: -1 })
        .limit(30)
        .lean(),
      CarWashCommissionPayout.find({ business: businessOid, staff: staffOid })
        .sort({ payoutDate: -1 })
        .limit(20)
        .lean(),
    ]);

    const commissions = commissionSummary.reduce((acc, row) => {
      acc[row._id] = { amount: round2(row.amount), count: row.count };
      acc.total.amount = round2(acc.total.amount + row.amount);
      acc.total.count  += row.count;
      return acc;
    }, { total: { amount: 0, count: 0 } });

    res.json({
      success: true,
      data: {
        staff,
        commissions,
        savings,
        recentSavings,
        recentPayouts,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── Savings payout (annual or on-demand) ────────────────────────────────────
export const createSavingsPayout = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const staffId  = req.body.staff;
    if (!mongoose.Types.ObjectId.isValid(String(staffId || ""))) return next(createError(400, "Select a staff member"));
    const staff = await CarWashStaff.findOne({ _id: staffId, business }).lean();
    if (!staff) return next(createError(404, "Staff member not found"));

    const amount = req.body.amount != null ? Number(req.body.amount) : undefined;
    const record = await disburseSavings({
      req,
      businessId:       business,
      staffId,
      cashbookAccountId: req.body.cashbookAccount,
      amount,
      notes:             String(req.body.notes || "").trim(),
    });

    res.status(201).json({
      success: true,
      data:    record,
      record,
      message: `Savings payout of Ksh ${record.amount.toLocaleString()} recorded for ${staff.name}`,
    });
  } catch (error) {
    next(createError(400, error?.message || "Savings payout failed"));
  }
};

// ─── Manual daily savings trigger (backfill or test) ─────────────────────────
export const processDailySavingsManual = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    // Accept a date param for backfilling; defaults to today
    const targetDate = req.body.date ? new Date(req.body.date) : new Date();
    if (Number.isNaN(targetDate.getTime())) return next(createError(400, "Invalid date"));

    const { posted, skipped, errors } = await processDailySavings(business, targetDate);
    res.json({
      success: true,
      date: targetDate.toISOString().slice(0, 10),
      posted,
      skipped,
      errors,
      message: `Daily savings processed: ${posted} posted, ${skipped} already done.`,
    });
  } catch (error) {
    next(error);
  }
};

// ─── Savings transaction history ──────────────────────────────────────────────
export const listSavings = async (req, res, next) => {
  try {
    const business  = resolveActiveBusinessId(req);
    const branchId  = resolveActiveBranchId(req);
    const filter    = { business: new mongoose.Types.ObjectId(String(business)) };
    if (branchId) filter.branch = new mongoose.Types.ObjectId(String(branchId));
    if (req.query.staff && mongoose.Types.ObjectId.isValid(String(req.query.staff))) {
      filter.staff = new mongoose.Types.ObjectId(String(req.query.staff));
    }
    if (req.query.type) filter.type = String(req.query.type).trim();

    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const page  = Math.max(Number(req.query.page || 1), 1);

    const [records, total] = await Promise.all([
      CarWashStaffSaving.find(filter)
        .populate("staff", "name phone role")
        .sort({ date: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      CarWashStaffSaving.countDocuments(filter),
    ]);

    res.json({ success: true, data: { records, total, page, pages: Math.ceil(total / limit) }, records, total });
  } catch (error) {
    next(error);
  }
};
