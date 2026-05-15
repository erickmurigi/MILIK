import { createError } from "../../../utils/error.js";
import SaleCommission from "../models/SaleCommission.js";
import { currentUserId, resolveActiveBusinessId } from "../services/businessScope.js";

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

    const update = { status, updatedBy: userId };
    if (payoutDate) update.payoutDate = payoutDate;
    if (payoutMethod) update.payoutMethod = payoutMethod;
    if (payoutReference) update.payoutReference = payoutReference;
    if (notes) update.notes = notes;

    const commission = await populateCommission(
      SaleCommission.findOneAndUpdate({ _id: req.params.id, business }, update, { new: true })
    );
    if (!commission) return next(createError(404, "Commission not found"));
    res.status(200).json(commission);
  } catch (err) {
    next(err);
  }
};
