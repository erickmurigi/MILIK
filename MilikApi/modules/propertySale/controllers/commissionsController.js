import { createError } from "../../../utils/error.js";
import SaleCommission from "../models/SaleCommission.js";
import { currentUserId, resolveActiveBusinessId } from "../services/businessScope.js";
import { postPropertySaleCommissionPayout, reversePropertySaleCommissionAccrual } from "../services/propertySaleAccountingService.js";

const populateCommission = (query) =>
  query
    .populate("deal", "dealNumber agreedPrice status")
    .populate("agent", "fullName agentNumber phone")
    .populate("listing", "title listingNumber")
    .populate("buyer", "fullName buyerNumber");

export const listCommissions = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { agentId = "", status = "", dealId = "" } = req.query;
    const filter = { business };
    if (agentId) filter.agent = agentId;
    if (status) filter.status = status;
    if (dealId) filter.deal = dealId;
    const commissions = await populateCommission(SaleCommission.find(filter).sort({ createdAt: -1 })).lean();
    res.status(200).json(commissions);
  } catch (err) {
    next(err);
  }
};

export const updateCommissionStatus = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const VALID = ["pending", "approved", "paid", "cancelled"];
    const { status, payoutDate, payoutMethod, payoutReference, notes } = req.body;
    if (!VALID.includes(status)) return next(createError(400, "Invalid commission status"));

    // Fetch old commission to detect transition before applying update
    const oldCommission = await SaleCommission.findOne({ _id: req.params.id, business }).lean();
    if (!oldCommission) return next(createError(404, "Commission not found"));

    const update = { status, updatedBy: userId };
    if (payoutDate) update.payoutDate = payoutDate;
    if (payoutMethod) update.payoutMethod = payoutMethod;
    if (payoutReference) update.payoutReference = payoutReference;
    if (notes) update.notes = notes;

    const commission = await populateCommission(
      SaleCommission.findOneAndUpdate({ _id: req.params.id, business }, update, { new: true })
    );
    if (!commission) return next(createError(404, "Commission not found"));

    // GL hooks based on status transition
    if (status === "paid" && oldCommission.status !== "paid") {
      postPropertySaleCommissionPayout({ businessId: business, commission: oldCommission, userId }).catch((err) =>
        console.error("[PS GL] postPropertySaleCommissionPayout failed:", err.message)
      );
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
