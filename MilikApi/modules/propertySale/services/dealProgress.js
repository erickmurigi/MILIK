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
    // A commission's top-level `payoutSource` only ever reflects its MOST RECENT payout tranche
    // (commissionsController.js's updateCommissionStatus overwrites it on every partial payout) — a
    // commission settled partly from trust and partly from the company cashbook would be invisible here
    // (or, the other way round, double-counted) if we matched/summed at the commission level. Unwind to
    // the actual `payouts[]` tranches and sum only the ones whose OWN `source` is "advocate_trust" —
    // that's the only amount that genuinely left this deal's trust pool, regardless of commission status.
    SaleCommission.aggregate([
      { $match: { business: bId, deal: dId } },
      { $unwind: "$payouts" },
      { $match: { "payouts.source": "advocate_trust" } },
      { $group: { _id: null, total: { $sum: "$payouts.amount" } } }, // gross — this is what left the trust pool, net-to-broker + withheld both came out of it
    ]),
    SaleAdvocateRemittance.aggregate([
      { $match: { business: bId, deal: dId, status: { $ne: "cancelled" } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    // A payout draws this deal's trust either via the single `deal` field (the original, single-deal
    // shape — amount+cgtAmount in full) or via `allocations` (a combined multi-deal payout — only THIS
    // deal's own slice, see SaleOwnerPayout.js's comment). The $match's $or finds a payout either way;
    // the $project picks the correct amount per shape so a legacy single-deal payout is counted
    // byte-identically to before, and a combined one only ever counts its own slice per deal (so the
    // same trust shilling can never be recognized as spent twice across two different deals' balances).
    SaleOwnerPayout.aggregate([
      { $match: { business: bId, source: "advocate_trust", status: { $ne: "cancelled" }, $or: [{ deal: dId }, { "allocations.deal": dId }] } },
      { $project: {
          amount: { $cond: [
            { $eq: ["$deal", dId] },
            { $add: ["$amount", { $ifNull: ["$cgtAmount", 0] }] },
            { $sum: {
                $map: {
                  input: { $filter: { input: { $ifNull: ["$allocations", []] }, as: "a", cond: { $eq: ["$$a.deal", dId] } } },
                  as: "a", in: "$$a.amount",
                },
              },
            },
          ] },
      } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
  ]);
  const collectedTotal = round2(collected?.total || 0);
  const disbursed = round2((commissionPaid?.total || 0) + (remitted?.total || 0) + (ownerPaid?.total || 0));
  return { collected: collectedTotal, disbursed, available: round2(collectedTotal - disbursed) };
};
