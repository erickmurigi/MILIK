import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import CarWashCommissionRule from "../models/CarWashCommissionRule.js";
import CarWashStaffCommission from "../models/CarWashStaffCommission.js";
import CarWashCommissionPayout from "../models/CarWashCommissionPayout.js";
import CarWashService from "../models/CarWashService.js";
import CarWashStaff from "../models/CarWashStaff.js";
import { currentUserId, escapeRegex, parseBoolean, parseDateRange, resolveActiveBusinessId, resolveActiveBranchId } from "../services/businessScope.js";
import { generatePayoutNumber } from "../services/commissionService.js";
import { postCarWashCommissionPayout, postCarWashCommissionPayoutWithSavings, resolvePayoutCashbook, reverseCarWashCommissionAccrual, reverseCarWashPayoutLedgerEntries } from "../services/carwashAccountingService.js";
import { deductSavingsForPayout, getStaffSavingsBalance, disburseSavings, eatToday, getSavingsDeductionAmount, initializeSavingsForBusiness } from "../services/savingsService.js";
import CarWashStaffSaving from "../models/CarWashStaffSaving.js";
import { holdDamagesForPayout, releaseDamagesForPayout, getStaffDamagesSummary } from "../services/damagesService.js";
import CarWashStaffDamage from "../models/CarWashStaffDamage.js";

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
    if (commissionType === "percentage" && rate > 100) return next(createError(400, "Percentage rate cannot exceed 100%"));

    const [service, staff] = await Promise.all([
      ensureService(business, req.body.service),
      ensureStaff(business, req.body.staff),
    ]);

    const payload = {
      business,
      name,
      service,
      staff,
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
    } else if (req.query.dateFrom || req.query.dateTo) {
      filter.earnedAt = {};
      if (req.query.dateFrom) { const d = new Date(req.query.dateFrom); d.setUTCHours(0,0,0,0); filter.earnedAt.$gte = d; }
      if (req.query.dateTo)   { const d = new Date(req.query.dateTo);   d.setUTCHours(23,59,59,999); filter.earnedAt.$lte = d; }
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

    // Atomically flip status to "in_payout" to prevent concurrent double-payout
    const commissionIds = commissions.map(c => c._id);
    const flipped = await CarWashStaffCommission.updateMany(
      { _id: { $in: commissionIds }, business, staff, status: "payable" },
      { $set: { status: "in_payout" } }
    );
    if (flipped.modifiedCount !== commissionIds.length) {
      // A concurrent payout already claimed some commissions
      return next(createError(409, "Another payout is being processed for this staff member — please try again in a moment."));
    }

    const commissionAmount = round2(commissions.reduce((sum, item) => sum + Number(item.commissionAmount || 0), 0));
    if (commissionAmount <= 0) return next(createError(400, "Selected commissions have no payable amount"));

    const method = String(req.body.method || "cash").trim().toLowerCase();
    if (!payoutMethods.has(method)) return next(createError(400, "Invalid payout method"));
    const cashbookAccount = await resolvePayoutCashbook(business, req.body.cashbookAccount);
    const now = req.body.payoutDate ? new Date(req.body.payoutDate) : new Date();
    const ctxBranch = resolveActiveBranchId(req);
    const staffDoc = ctxBranch ? null : await CarWashStaff.findOne({ _id: req.body.staff, business }).select("branch").lean();
    const branchId = ctxBranch || staffDoc?.branch || null;

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

    // Deduct savings for days elapsed since last deduction
    const savingsHeld = await deductSavingsForPayout({
      businessId:         business,
      staffId:            staff,
      commissionPayoutId: payout._id,
      commissionAmount,
      payoutDate:         payoutBase.payoutDate,
      branch:             branchId || null,
    });

    // Hold pending damage deductions (capped so staff cannot go below zero)
    const damagesHeld = await holdDamagesForPayout({
      businessId: business,
      staffId: staff,
      commissionPayoutId: payout._id,
      commissionAmount,
      alreadyDeducted: savingsHeld,
    });

    const netCash = round2(commissionAmount - savingsHeld - damagesHeld);

    // Persist breakdown on the payout record
    if (savingsHeld > 0 || damagesHeld > 0) {
      payout.savingsHeld  = savingsHeld;
      payout.damagesHeld  = damagesHeld;
      payout.netCash      = netCash;
      await payout.save();
      await postCarWashCommissionPayoutWithSavings({ req, payout, cashbookAccount, commissionAmount, netCash, savingsHeld, damagesHeld });
    } else {
      payout.netCash = commissionAmount;
      await payout.save();
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

    const messageParts = [];
    if (savingsHeld > 0) messageParts.push(`Ksh ${savingsHeld.toLocaleString()} held to savings`);
    if (damagesHeld > 0) messageParts.push(`Ksh ${damagesHeld.toLocaleString()} recovered for damages`);

    res.status(201).json({
      success: true,
      data: { ...payout.toObject(), savingsHeld, damagesHeld, netCash },
      payout,
      savingsHeld,
      damagesHeld,
      netCash,
      message: messageParts.length
        ? `Commission payout recorded — ${messageParts.join(", ")}`
        : "Commission payout recorded",
    });
  } catch (error) {
    // Revert the status flip so commissions remain payable after a failure
    if (typeof commissionIds !== "undefined" && commissionIds?.length) {
      await CarWashStaffCommission.updateMany(
        { _id: { $in: commissionIds }, status: "in_payout" },
        { $set: { status: "payable" } }
      ).catch(() => {}); // best-effort revert
    }
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
    } else if (req.query.dateFrom || req.query.dateTo) {
      filter.payoutDate = {};
      if (req.query.dateFrom) { const d = new Date(req.query.dateFrom); d.setUTCHours(0,0,0,0);       filter.payoutDate.$gte = d; }
      if (req.query.dateTo)   { const d = new Date(req.query.dateTo);   d.setUTCHours(23,59,59,999);  filter.payoutDate.$lte = d; }
    }

    const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 200);
    const page  = Math.max(Number(req.query.page || 1), 1);
    const skip  = (page - 1) * limit;

    const [payouts, total] = await Promise.all([
      CarWashCommissionPayout.find(filter)
        .populate("staff", "name phone role")
        .populate("cashbookAccount", "code name")
        .populate("branch", "name")
        .sort({ payoutDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      CarWashCommissionPayout.countDocuments(filter),
    ]);
    const pagination = { page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) };
    res.status(200).json({ success: true, data: { payouts, pagination }, payouts, pagination });
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

    const [commissionSummary, savings, damages, recentSavings, recentPayouts] = await Promise.all([
      CarWashStaffCommission.aggregate([
        { $match: { business: businessOid, staff: staffOid } },
        { $group: {
            _id: "$status",
            amount: { $sum: "$commissionAmount" },
            count:  { $sum: 1 },
        }},
      ]),
      getStaffSavingsBalance(business, staffId),
      getStaffDamagesSummary(business, staffId),
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
        damages,
        recentSavings,
        recentPayouts,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── Single earned/payable commission reversal ────────────────────────────────
export const reverseEarnedCommission = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(id))) return next(createError(400, "Invalid commission ID"));

    const commission = await CarWashStaffCommission.findOne({ _id: id, business });
    if (!commission) return next(createError(404, "Commission not found"));

    if (!["earned", "payable"].includes(commission.status)) {
      return next(createError(400,
        commission.status === "paid"
          ? "Cannot reverse a paid commission — reverse the payout first"
          : "Commission is already cancelled"
      ));
    }

    // Reverse accrual ledger entries; the service function also calls commission.save()
    await reverseCarWashCommissionAccrual({ req, commission });

    // Set status to cancelled (separate update after accrual service has already saved)
    await CarWashStaffCommission.updateOne(
      { _id: commission._id },
      { $set: { status: "cancelled", notes: String(req.body.notes || "").trim() || commission.notes, updatedBy: currentUserId(req) } }
    );

    res.json({
      success: true,
      message: "Commission reversed and cancelled",
      data: { ...commission.toObject(), status: "cancelled" },
    });
  } catch (error) {
    next(error);
  }
};

// ─── Commission payout reversal ───────────────────────────────────────────────
export const reverseCommissionPayout = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(id))) return next(createError(400, "Invalid payout ID"));

    const payout = await CarWashCommissionPayout.findOne({ _id: id, business });
    if (!payout) return next(createError(404, "Commission payout not found"));
    if (payout.isReversed) return next(createError(400, "This payout has already been reversed"));

    const userId = currentUserId(req);
    const reason = String(req.body.notes || req.body.reversalNotes || "").trim();
    const reasonStr = `Commission payout ${payout.payoutNumber} reversed${reason ? `: ${reason}` : ""}`;

    // 1. Reverse ledger entries (Dr/Cr unwound)
    if (payout.ledgerEntries?.length) {
      await reverseCarWashPayoutLedgerEntries({ req, businessId: business, entryIds: payout.ledgerEntries, reason: reasonStr });
    }

    // 2. Reset included commissions back to payable
    if (payout.commissions?.length) {
      await CarWashStaffCommission.updateMany(
        { _id: { $in: payout.commissions }, business, status: "paid" },
        { $set: { status: "payable", paidAt: null, payout: null, payoutLedgerEntries: [], updatedBy: userId } }
      );
    }

    // 3. Reverse the savings deduction so the period re-opens for the next payout
    if (payout.savingsHeld > 0) {
      await CarWashStaffSaving.updateMany(
        { business, commissionPayout: payout._id, type: "deduction" },
        { $set: { isReversed: true, reversedAt: new Date(), reversedBy: userId } }
      );
    }

    // 4. Release damage holds — damages return to "pending" for next payout
    if (payout.damagesHeld > 0) {
      await releaseDamagesForPayout(business, payout._id);
    }

    // 5. Mark payout as reversed
    payout.isReversed    = true;
    payout.reversedAt    = new Date();
    payout.reversedBy    = userId;
    payout.reversalNotes = reason;
    await payout.save();

    res.json({
      success: true,
      message: `Commission payout ${payout.payoutNumber} reversed successfully`,
      data: payout,
    });
  } catch (error) {
    next(error);
  }
};

// ─── Savings disbursement reversal ────────────────────────────────────────────
export const reverseSavingsPayout = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(id))) return next(createError(400, "Invalid savings payout ID"));

    const record = await CarWashStaffSaving.findOne({ _id: id, business, type: "disbursement" });
    if (!record) return next(createError(404, "Savings payout not found"));
    if (record.isReversed) return next(createError(400, "This savings payout has already been reversed"));

    const userId = currentUserId(req);
    const reason = String(req.body.notes || "").trim();
    const reasonStr = `Savings payout ${record.savingsPayoutNumber || record._id} reversed${reason ? `: ${reason}` : ""}`;

    if (record.ledgerEntries?.length) {
      await reverseCarWashPayoutLedgerEntries({ req, businessId: business, entryIds: record.ledgerEntries, reason: reasonStr });
    }

    record.isReversed = true;
    record.reversedAt = new Date();
    record.reversedBy = userId;
    await record.save();

    res.json({ success: true, message: `Savings payout reversed successfully`, data: record });
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


// ─── Savings transaction history ──────────────────────────────────────────────
export const listSavings = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter   = { business: new mongoose.Types.ObjectId(String(business)) };
    if (req.query.staff && mongoose.Types.ObjectId.isValid(String(req.query.staff))) {
      filter.staff = new mongoose.Types.ObjectId(String(req.query.staff));
    }
    if (req.query.type) filter.type = String(req.query.type).trim();
    if (req.query.dateFrom || req.query.dateTo) {
      // deduction records use savingsDate (= coveredTo); disbursements use date
      const dateField = req.query.type === "disbursement" ? "date" : "savingsDate";
      filter[dateField] = {};
      if (req.query.dateFrom) { const d = new Date(req.query.dateFrom); d.setUTCHours(0,0,0,0);      filter[dateField].$gte = d; }
      if (req.query.dateTo)   { const d = new Date(req.query.dateTo);   d.setUTCHours(23,59,59,999); filter[dateField].$lte = d; }
    }

    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const page  = Math.max(Number(req.query.page || 1), 1);

    const [records, total] = await Promise.all([
      CarWashStaffSaving.find(filter)
        .populate("staff", "name phone role")
        .sort({ savingsDate: -1, date: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      CarWashStaffSaving.countDocuments(filter),
    ]);

    const pages = Math.max(Math.ceil(total / limit), 1);
    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true, data: { records, pagination: { page, limit, total, pages } }, records, total, pagination: { page, limit, total, pages } });
  } catch (error) {
    next(error);
  }
};

// ─── Delete only legacy "daily" records (from old cron system) ────────────────
export const cleanupLegacySavings = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const result   = await CarWashStaffSaving.deleteMany({ business: new mongoose.Types.ObjectId(String(business)), type: "daily" });
    res.json({ success: true, deleted: result.deletedCount, message: `Removed ${result.deletedCount} legacy savings record${result.deletedCount !== 1 ? "s" : ""}` });
  } catch (error) {
    next(error);
  }
};

// ─── Wipe all savings records for the business (admin reset) ──────────────────
export const resetSavings = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const result   = await CarWashStaffSaving.deleteMany({ business: new mongoose.Types.ObjectId(String(business)) });
    res.json({ success: true, deleted: result.deletedCount });
  } catch (error) {
    next(error);
  }
};

// ─── Initialize savings tracking for all active staff ─────────────────────────
export const initializeSavings = async (req, res, next) => {
  try {
    const business   = resolveActiveBusinessId(req);
    const startDate  = req.body?.startDate || null;
    const initialized = await initializeSavingsForBusiness(business, startDate);
    res.json({
      success: true,
      initialized,
      message: initialized > 0
        ? `Savings tracking started for ${initialized} staff member${initialized !== 1 ? "s" : ""}`
        : "All active staff already have savings tracking active",
    });
  } catch (error) {
    next(error);
  }
};

// ─── Savings balance summary (all staff, one aggregation) ─────────────────────
export const listSavingsBalances = async (req, res, next) => {
  try {
    const business    = resolveActiveBusinessId(req);
    const businessOid = toObjectId(business);
    const today       = eatToday();
    const [dailyRate, rows, activeStaff] = await Promise.all([
      getSavingsDeductionAmount(business),
      CarWashStaffSaving.aggregate([
        { $match: { business: businessOid, isReversed: { $ne: true } } },
        { $group: {
          _id:          "$staff",
          deducted:     { $sum: { $cond: [{ $eq: ["$type", "deduction"] }, "$amount", 0] } },
          disbursed:    { $sum: { $cond: [{ $eq: ["$type", "disbursement"] }, "$amount", 0] } },
          lastCoveredTo:{ $max: { $cond: [{ $eq: ["$type", "deduction"] }, "$coveredTo", null] } },
        }},
      ]),
      CarWashStaff.find({ business: businessOid, active: { $ne: false } }).select("name").lean(),
    ]);

    const rowMap = new Map(rows.map((r) => [String(r._id), r]));

    const msPerDay = 24 * 60 * 60 * 1000;
    const balances = activeStaff
      .map((s) => {
        const row          = rowMap.get(String(s._id)) || {};
        const deducted     = round2(row.deducted  || 0);
        const disbursed    = round2(row.disbursed || 0);
        const lastCoveredTo = row.lastCoveredTo || null;

        let pending = 0;
        if (dailyRate > 0 && lastCoveredTo) {
          const nextDay = new Date(lastCoveredTo);
          nextDay.setUTCDate(nextDay.getUTCDate() + 1);
          const daysPending = Math.max(0, Math.round((today - nextDay) / msPerDay) + 1);
          pending = round2(daysPending * dailyRate);
        }

        return {
          staffId:      s._id,
          staffName:    s.name,
          deducted,
          disbursed,
          pending,
          balance:      round2(Math.max(0, deducted - disbursed)),
          totalAccrued: round2(deducted + pending),
          lastCoveredTo,
        };
      })
      .sort((a, b) => b.balance - a.balance || String(a.staffName).localeCompare(String(b.staffName)));

    res.json({ success: true, data: { balances }, balances });
  } catch (error) {
    next(error);
  }
};
