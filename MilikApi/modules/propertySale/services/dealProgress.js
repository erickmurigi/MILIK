import mongoose from "mongoose";
import SalePayment from "../models/SalePayment.js";
import SaleCommission from "../models/SaleCommission.js";
import SaleAdvocateRemittance from "../models/SaleAdvocateRemittance.js";
import SaleOwnerPayout from "../models/SaleOwnerPayout.js";
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

// Money an advocate holds in trust FOR THIS SPECIFIC DEAL that hasn't yet been disbursed to anyone —
// broker, agent, or owner. Prevents one deal's completion from drawing against another deal's funds
// (both an LSK trust-compliance concern for the advocate and a leak in our own records). Every
// disbursement action (broker payout via advocate_trust, advocate remittance, owner payout via
// advocate_trust) MUST call this and reject if the requested amount exceeds `available`, before
// posting anything.
export const dealAdvocateTrustBalance = async (business, dealId) => {
  const bId = new mongoose.Types.ObjectId(String(business));
  const dId = new mongoose.Types.ObjectId(String(dealId));
  const [[collected], [commissionPaid], [remitted], [ownerPaid]] = await Promise.all([
    SalePayment.aggregate([
      { $match: { business: bId, deal: dId, collectionMethod: "advocate_trust", status: "paid" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    SaleCommission.aggregate([
      { $match: { business: bId, deal: dId, payoutSource: "advocate_trust", status: "paid" } },
      { $group: { _id: null, total: { $sum: "$commissionAmount" } } }, // gross — this is what left the trust pool, net-to-broker + withheld both came out of it
    ]),
    SaleAdvocateRemittance.aggregate([
      { $match: { business: bId, deal: dId } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    SaleOwnerPayout.aggregate([
      { $match: { business: bId, deal: dId, source: "advocate_trust" } },
      // amount + cgtAmount — CGT withheld at completion still leaves the trust (paid to KRA on the
      // owner's behalf), even though the owner only receives `amount` in cash.
      { $group: { _id: null, total: { $sum: { $add: ["$amount", { $ifNull: ["$cgtAmount", 0] }] } } } },
    ]),
  ]);
  const collectedTotal = round2(collected?.total || 0);
  const disbursed = round2((commissionPaid?.total || 0) + (remitted?.total || 0) + (ownerPaid?.total || 0));
  return { collected: collectedTotal, disbursed, available: round2(collectedTotal - disbursed) };
};
