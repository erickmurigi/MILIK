import mongoose from "mongoose";
import SalePayment from "../models/SalePayment.js";
import { round2 } from "../../../utils/math.js";

// Sum of a deal's confirmed ("paid") payments, optionally excluding one payment — shared by
// paymentsController.js and dealsController.js, which both used to keep their own copy of this aggregate.
export const sumPaidForDeal = async (business, dealId, excludePaymentId = null) => {
  const match = { business: new mongoose.Types.ObjectId(String(business)), deal: new mongoose.Types.ObjectId(String(dealId)), status: "paid" };
  if (excludePaymentId) match._id = { $ne: excludePaymentId };
  const [agg] = await SalePayment.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  return agg?.total || 0;
};

// % of a deal's agreed price paid so far — the metric staged commission-release tiers key off.
export const percentPaid = (totalPaid, agreedPrice) =>
  agreedPrice > 0 ? round2((Number(totalPaid) / Number(agreedPrice)) * 100) : 0;
