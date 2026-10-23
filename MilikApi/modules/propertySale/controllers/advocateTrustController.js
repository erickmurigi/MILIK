import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import SaleAdvocate from "../models/SaleAdvocate.js";
import SalePayment from "../models/SalePayment.js";
import { round2 } from "../../../utils/math.js";
import { resolveActiveBusinessId } from "../services/businessScope.js";
import { dealAdvocateTrustBalance } from "../services/dealProgress.js";

// Outstanding advocate_trust balance, across every deal this advocate has ever collected trust for.
// `outstanding` is the TRUE remaining balance — collected minus EVERY way trust money can leave a deal
// (a broker commission payout, an owner payout, or an agency commission payout, any of which can draw
// straight from trust). Reuses dealAdvocateTrustBalance's own disbursement accounting per deal (the same
// function every individual disbursement action already validates against) rather than re-deriving it,
// so this can never drift out of sync with what each of those actions actually checks.
export const advocateTrustBalance = async (business, advocateId) => {
  const bId = new mongoose.Types.ObjectId(String(business));
  const aId = new mongoose.Types.ObjectId(String(advocateId));

  const dealIds = await SalePayment.distinct("deal", { business: bId, advocate: aId, collectionMethod: "advocate_trust", status: "paid" });
  const balances = await Promise.all(dealIds.map((dealId) => dealAdvocateTrustBalance(business, dealId)));
  const collected = balances.reduce((s, b) => s + b.collected, 0);
  const disbursed = balances.reduce((s, b) => s + b.disbursed, 0);
  return { collected: round2(collected), outstanding: round2(collected - disbursed) };
};

export const getAdvocateTrustBalance = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    if (req.saleAdvocateId && req.saleAdvocateId !== String(req.params.advocateId)) {
      return next(createError(404, "Advocate not found"));
    }
    const advocate = await SaleAdvocate.findOne({ _id: req.params.advocateId, business }).select("_id").lean();
    if (!advocate) return next(createError(404, "Advocate not found"));
    const balance = await advocateTrustBalance(business, advocate._id);
    res.status(200).json(balance);
  } catch (err) {
    next(err);
  }
};
