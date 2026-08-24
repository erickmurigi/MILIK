import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import SaleCommission from "../models/SaleCommission.js";
import { currentUserId, resolveActiveBusinessId } from "../services/businessScope.js";
import {
  postPropertySaleCommissionAccrual,
  postPropertySaleCommissionPayout,
  reversePropertySaleCommissionAccrual,
  reversePropertySaleCommissionPayout,
} from "../services/propertySaleAccountingService.js";

const resolveCashbook = async (businessId, cashbookId) => {
  if (!cashbookId || !mongoose.isValidObjectId(String(cashbookId))) return null;
  return ChartOfAccount.findOne({
    _id: cashbookId,
    business: businessId,
    isPosting: { $ne: false },
    isHeader:  { $ne: true },
  }).lean();
};

const populateCommission = (query) =>
  query
    .populate("deal", "dealNumber agreedPrice status")
    .populate("agent", "fullName agentNumber phone")
    .populate("listing", "title listingNumber")
    .populate("buyer", "fullName buyerNumber");

// State machine: which transitions are permitted
const ALLOWED_TRANSITIONS = {
  pending:   ["approved", "cancelled"],
  approved:  ["paid", "cancelled"],
  paid:      ["reversed"],
  cancelled: [],
  reversed:  ["cancelled"],
};

export const listCommissions = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { agentId = "", status = "", dealId = "", search = "", dateFrom = "", dateTo = "" } = req.query;
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const filter = { business };
    if (req.saleAgentId) filter.agent = req.saleAgentId;
    else if (agentId)    filter.agent = agentId;
    if (status)  filter.status = status;
    if (dealId)  filter.deal = dealId;
    if (search.trim()) filter.commissionNumber = { $regex: search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo)   filter.createdAt.$lte = new Date(dateTo + "T23:59:59.999Z");
    }

    const [commissions, total, statsRaw] = await Promise.all([
      populateCommission(SaleCommission.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)).lean(),
      SaleCommission.countDocuments(filter),
      SaleCommission.aggregate([
        { $match: { business: filter.business, ...(agentId && { agent: filter.agent }), ...(dealId && { deal: filter.deal }) } },
        { $group: { _id: "$status", count: { $sum: 1 }, totalAmount: { $sum: "$commissionAmount" } } },
      ]),
    ]);

    const statsMap = Object.fromEntries(statsRaw.map((s) => [s._id, { count: s.count, amount: s.totalAmount }]));
    const stats = {
      pending:  statsMap.pending  || { count: 0, amount: 0 },
      approved: statsMap.approved || { count: 0, amount: 0 },
      paid:     statsMap.paid     || { count: 0, amount: 0 },
      cancelled: statsMap.cancelled || { count: 0, amount: 0 },
    };

    res.status(200).json({ data: commissions, total, page, pages: Math.ceil(total / limit), stats });
  } catch (err) {
    next(err);
  }
};

export const getCommission = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const commission = await populateCommission(SaleCommission.findOne({ _id: req.params.id, business })).lean();
    if (!commission) return next(createError(404, "Commission not found"));
    res.status(200).json(commission);
  } catch (err) {
    next(err);
  }
};

export const updateCommissionStatus = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const { status, payoutDate, payoutMethod, payoutReference, cashbook, notes } = req.body;

    const oldCommission = await SaleCommission.findOne({ _id: req.params.id, business }).lean();
    if (!oldCommission) return next(createError(404, "Commission not found"));

    const allowed = ALLOWED_TRANSITIONS[oldCommission.status] ?? [];
    if (!allowed.includes(status)) {
      return next(createError(400, `Cannot transition commission from "${oldCommission.status}" to "${status}"`));
    }

    const update = { status, updatedBy: userId };
    if (status === "paid") {
      if (!payoutDate)   return next(createError(400, "Payout date is required when marking a commission as paid"));
      if (!payoutMethod) return next(createError(400, "Payout method is required when marking a commission as paid"));
      update.payoutDate   = payoutDate;
      update.payoutMethod = payoutMethod;
      if (payoutReference) update.payoutReference = payoutReference;
    }
    if (notes) update.notes = notes;

    // Resolve cashbook if provided (used for payout GL credit leg)
    let cashbookAcc = null;
    if (status === "paid" && cashbook) {
      cashbookAcc = await resolveCashbook(business, cashbook);
      if (!cashbookAcc) return next(createError(400, "Selected cashbook account not found"));
    }

    const commission = await populateCommission(
      SaleCommission.findOneAndUpdate({ _id: req.params.id, business }, update, { new: true })
    ).lean();
    if (!commission) return next(createError(404, "Commission not found"));

    // GL hooks — all paths await and roll back on failure
    if (status === "approved" && oldCommission.status === "pending") {
      // Finding 5: post accrual immediately on manual approval (not just at deal close)
      try {
        await postPropertySaleCommissionAccrual({ businessId: business, commission: oldCommission, userId });
      } catch (glErr) {
        await SaleCommission.findByIdAndUpdate(req.params.id, { status: oldCommission.status, updatedBy: userId });
        return next(createError(422, `GL accrual failed: ${glErr.message}. Commission status not changed.`));
      }
    } else if (status === "paid") {
      try {
        await postPropertySaleCommissionPayout({ businessId: business, commission: oldCommission, userId, payoutDate, cashbookAccountId: cashbookAcc?._id || null });
      } catch (glErr) {
        await SaleCommission.findByIdAndUpdate(req.params.id, { status: oldCommission.status, updatedBy: userId });
        return next(createError(422, `GL posting failed: ${glErr.message}. Commission status not changed.`));
      }
    } else if (status === "reversed" && oldCommission.status === "paid") {
      // Reverse payout entries only; accrual stays — commission returns to approved-but-unpaid state
      try {
        await reversePropertySaleCommissionPayout({
          businessId: business,
          commission: oldCommission,
          userId,
          reason: `Commission ${oldCommission.commissionNumber} payout reversed`,
        });
      } catch (glErr) {
        await SaleCommission.findByIdAndUpdate(req.params.id, { status: oldCommission.status, updatedBy: userId });
        return next(createError(422, `GL reversal failed: ${glErr.message}. Commission status not changed.`));
      }
    } else if (status === "cancelled" && (oldCommission.status === "approved" || oldCommission.status === "reversed")) {
      // Finding 4 & 7: await the reversal and roll back on failure
      // reversed→cancelled also reverses the accrual so nothing stays on the books
      try {
        await reversePropertySaleCommissionAccrual({
          businessId: business,
          commission: oldCommission,
          userId,
          reason: `Commission ${oldCommission.commissionNumber} cancelled`,
        });
      } catch (glErr) {
        await SaleCommission.findByIdAndUpdate(req.params.id, { status: oldCommission.status, updatedBy: userId });
        return next(createError(422, `GL reversal failed: ${glErr.message}. Commission status not changed.`));
      }
    }

    res.status(200).json(commission);
  } catch (err) {
    next(err);
  }
};
