import mongoose from "mongoose";
import SaleOwnerCommission from "../models/SaleOwnerCommission.js";
import SaleAgencyCommissionPayout from "../models/SaleAgencyCommissionPayout.js";
import { round2 } from "../../../utils/math.js";

const toId = (v) => new mongoose.Types.ObjectId(String(v));

// Every owner (agency) commission with at least one DEFERRED tier (tierReleases[].deferred — the deal's
// proceeds are sitting in an advocate's trust account, not yet the company's own cash) that isn't fully
// paid out yet, scoped to the given set of deal ids. Deliberately TRUST-scoped (by deal, i.e. by
// whichever advocate actually holds that cash), not owner-centric the way recoverable-expense visibility
// is — this is real custody of money, not a shared visibility concern. Callers resolve `dealIds` via
// middleware/advocateScope.js's ownAdvocateDealIds (a scoped advocate's own deals) or, for a staff
// caller viewing a specific advocate, the same function with a fake req carrying that advocate's id.
export const outstandingAgencyCommissions = async (business, dealIds) => {
  if (!dealIds?.length) return [];
  const commissions = await SaleOwnerCommission.find({
    business, deal: { $in: dealIds }, status: { $ne: "cancelled" }, "tierReleases.deferred": true,
  }).select("commissionNumber deal owner tierReleases").lean();
  if (!commissions.length) return [];

  const commissionIds = commissions.map((c) => toId(c._id));
  const paidRows = await SaleAgencyCommissionPayout.aggregate([
    { $match: { business: toId(business), status: { $ne: "cancelled" } } },
    { $unwind: "$allocations" },
    { $match: { "allocations.ownerCommission": { $in: commissionIds } } },
    { $group: { _id: "$allocations.ownerCommission", total: { $sum: "$allocations.amount" } } },
  ]);
  const paidByCommission = new Map(paidRows.map((r) => [String(r._id), round2(r.total || 0)]));

  return commissions
    .map((c) => {
      const deferredAmount = round2((c.tierReleases || []).filter((t) => t.deferred).reduce((s, t) => s + Number(t.amount || 0), 0));
      const paid = paidByCommission.get(String(c._id)) || 0;
      return {
        ownerCommissionId: c._id,
        commissionNumber: c.commissionNumber,
        deal: c.deal,
        owner: c.owner,
        deferredAmount,
        outstanding: round2(Math.max(0, deferredAmount - paid)),
      };
    })
    .filter((c) => c.outstanding > 0);
};
