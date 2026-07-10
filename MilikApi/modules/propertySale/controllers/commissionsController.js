import { createError } from "../../../utils/error.js";
import SaleCommission from "../models/SaleCommission.js";
import { currentUserId, resolveActiveBusinessId } from "../services/businessScope.js";
import {
  postPropertySaleCommissionPayout,
  reversePropertySaleCommissionAccrual,
  reversePropertySaleCommissionPayout,
} from "../services/propertySaleAccountingService.js";

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
  reversed:  [],
};

export const listCommissions = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { agentId = "", status = "", dealId = "" } = req.query;
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const filter = { business };
    if (agentId) filter.agent = agentId;
    if (status) filter.status = status;
    if (dealId) filter.deal = dealId;

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

    res.status(200).json({ commissions, total, page, pages: Math.ceil(total / limit), stats });
  } catch (err) {
    next(err);
  }
};

export const updateCommissionStatus = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const { status, payoutDate, payoutMethod, payoutReference, notes } = req.body;

    const oldCommission = await SaleCommission.findOne({ _id: req.params.id, business }).lean();
    if (!oldCommission) return next(createError(404, "Commission not found"));

    const allowed = ALLOWED_TRANSITIONS[oldCommission.status] ?? [];
    if (!allowed.includes(status)) {
      return next(createError(400, `Cannot transition commission from "${oldCommission.status}" to "${status}"`));
    }

    const update = { status, updatedBy: userId };
    if (status === "paid") {
      if (!payoutDate) return next(createError(400, "Payout date is required when marking a commission as paid"));
      if (!payoutMethod) return next(createError(400, "Payout method is required when marking a commission as paid"));
      update.payoutDate = payoutDate;
      update.payoutMethod = payoutMethod;
      if (payoutReference) update.payoutReference = payoutReference;
    }
    if (notes) update.notes = notes;

    const commission = await populateCommission(
      SaleCommission.findOneAndUpdate({ _id: req.params.id, business }, update, { new: true })
    );
    if (!commission) return next(createError(404, "Commission not found"));

    // GL hooks based on transition
    if (status === "paid") {
      try {
        await postPropertySaleCommissionPayout({ businessId: business, commission: oldCommission, userId, payoutMethod, payoutDate });
      } catch (glErr) {
        // Roll back status change and surface the error
        await SaleCommission.findByIdAndUpdate(req.params.id, { status: oldCommission.status, updatedBy: userId });
        return next(createError(500, `GL posting failed: ${glErr.message}. Commission status not changed.`));
      }
    } else if (status === "reversed" && oldCommission.status === "paid") {
      try {
        await reversePropertySaleCommissionPayout({
          businessId: business,
          commission: oldCommission,
          userId,
          reason: `Commission ${oldCommission.commissionNumber} payout reversed`,
        });
      } catch (glErr) {
        await SaleCommission.findByIdAndUpdate(req.params.id, { status: oldCommission.status, updatedBy: userId });
        return next(createError(500, `GL reversal failed: ${glErr.message}. Commission status not changed.`));
      }
    } else if (status === "cancelled" && oldCommission.status === "approved") {
      reversePropertySaleCommissionAccrual({ businessId: business, commission: oldCommission, userId, reason: `Commission ${oldCommission.commissionNumber} cancelled` }).catch((err) =>
        console.error("[PS GL] reversePropertySaleCommissionAccrual failed:", err.message)
      );
    }

    res.status(200).json(commission);
  } catch (err) {
    next(err);
  }
};
