import mongoose from "mongoose";
import CarWashStaffDamage from "../models/CarWashStaffDamage.js";

const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;

/**
 * Returns pending damage totals for a staff member.
 * pendingAmount — sum of damages not yet deducted or waived (will come off next payout)
 * totalDeducted — sum already recovered through payouts
 * totalWaived   — sum written off by management
 */
export const getStaffDamagesSummary = async (businessId, staffId) => {
  const rows = await CarWashStaffDamage.aggregate([
    {
      $match: {
        business: new mongoose.Types.ObjectId(String(businessId)),
        staff:    new mongoose.Types.ObjectId(String(staffId)),
      },
    },
    {
      $group: {
        _id: "$status",
        total: { $sum: "$amount" },
      },
    },
  ]);

  const byStatus = Object.fromEntries(rows.map((r) => [r._id, round2(r.total)]));
  return {
    pendingAmount: byStatus.pending  || 0,
    totalDeducted: byStatus.deducted || 0,
    totalWaived:   byStatus.waived   || 0,
  };
};

/**
 * Marks pending damages as deducted in a commission payout.
 * Caps the total at (commissionAmount - alreadyDeducted) so staff never go negative.
 * Returns the total amount withheld.
 */
export const holdDamagesForPayout = async ({
  businessId,
  staffId,
  commissionPayoutId,
  commissionAmount,
  alreadyDeducted = 0,
}) => {
  const pending = await CarWashStaffDamage.find({
    business: businessId,
    staff:    staffId,
    status:   "pending",
  }).sort({ damageDate: 1 }).lean();

  if (!pending.length) return 0;

  const cap = round2(commissionAmount - alreadyDeducted);
  if (cap <= 0) return 0;

  let held = 0;
  const toMark = [];
  for (const rec of pending) {
    const next = round2(held + rec.amount);
    if (next > cap + 0.01) break;
    held = next;
    toMark.push(rec._id);
  }
  if (!toMark.length) return 0;

  await CarWashStaffDamage.updateMany(
    { _id: { $in: toMark } },
    { $set: { status: "deducted", commissionPayout: commissionPayoutId } }
  );
  return round2(held);
};

/**
 * Releases damage holds when a payout is reversed.
 * Sets affected damages back to "pending" so they can be deducted from the next payout.
 */
export const releaseDamagesForPayout = async (businessId, commissionPayoutId) => {
  await CarWashStaffDamage.updateMany(
    { business: businessId, commissionPayout: commissionPayoutId, status: "deducted" },
    { $set: { status: "pending", commissionPayout: null } }
  );
};
