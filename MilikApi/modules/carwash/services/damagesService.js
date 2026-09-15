import mongoose from "mongoose";
import CarWashStaffDamage from "../models/CarWashStaffDamage.js";
import { round2 } from "../../../utils/math.js";

/**
 * Compute the installment for a single damage record (uncapped by commission).
 * Used both here and mirrored client-side in the payout modal preview.
 */
export const computeDamageInstallment = (damage) => {
  const remaining = round2(damage.amount - (damage.amountRecovered || 0));
  if (remaining <= 0) return 0;
  let installment;
  switch (damage.deductionMode) {
    case "percent":
      installment = round2(damage.amount * (Number(damage.deductionValue) || 100) / 100);
      break;
    case "fixed":
      installment = round2(Number(damage.deductionValue) || remaining);
      break;
    default: // "full"
      installment = remaining;
  }
  return round2(Math.min(installment, remaining));
};

/**
 * Returns damage totals for a staff member.
 * pendingAmount      — total remaining balance across all pending damages
 * pendingInstallment — what will be withheld at the NEXT payout (uncapped by commission)
 * totalDeducted      — sum fully recovered through payouts
 * totalWaived        — sum written off
 */
export const getStaffDamagesSummary = async (businessId, staffId) => {
  const damages = await CarWashStaffDamage.find({
    business: businessId,
    staff:    staffId,
  }).lean();

  let pendingAmount = 0;
  let pendingInstallment = 0;
  let totalDeducted = 0;
  let totalWaived = 0;

  for (const d of damages) {
    if (d.status === "waived") {
      totalWaived = round2(totalWaived + d.amount);
    } else if (d.status === "deducted") {
      totalDeducted = round2(totalDeducted + d.amount);
    } else {
      const remaining = round2(d.amount - (d.amountRecovered || 0));
      pendingAmount = round2(pendingAmount + remaining);
      pendingInstallment = round2(pendingInstallment + computeDamageInstallment(d));
    }
  }

  return { pendingAmount, pendingInstallment, totalDeducted, totalWaived };
};

/**
 * Withholds damage installments from a commission payout.
 *
 * For each pending damage (oldest first):
 *   - Computes the installment (percent / fixed / full of remaining balance)
 *   - Caps against available commission space
 *   - Increments amountRecovered; marks "deducted" when fully recovered
 *   - Appends a recoveryLog entry for reversal support
 *
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

  let totalHeld = 0;
  const now = new Date();
  const updateOps = [];

  for (const rec of pending) {
    const available = round2(cap - totalHeld);
    if (available <= 0.005) break;

    const remaining = round2(rec.amount - (rec.amountRecovered || 0));
    if (remaining <= 0) continue;

    let installment = round2(Math.min(computeDamageInstallment(rec), available));
    if (installment <= 0) continue;

    totalHeld = round2(totalHeld + installment);
    const newRecovered = round2((rec.amountRecovered || 0) + installment);
    const fullyRecovered = newRecovered >= rec.amount - 0.005;

    updateOps.push({
      updateOne: {
        filter: { _id: rec._id },
        update: {
          $set: {
            amountRecovered: newRecovered,
            ...(fullyRecovered ? { status: "deducted", commissionPayout: commissionPayoutId } : {}),
          },
          $push: {
            recoveryLog: { commissionPayout: commissionPayoutId, amount: installment, date: now },
          },
        },
      },
    });
  }

  if (updateOps.length) await CarWashStaffDamage.bulkWrite(updateOps, { ordered: false });

  return round2(totalHeld);
};

/**
 * Reverses damage deductions when a payout is reversed.
 * Removes recoveryLog entries for that payout and restores amountRecovered.
 */
export const releaseDamagesForPayout = async (businessId, commissionPayoutId) => {
  const payoutOid = new mongoose.Types.ObjectId(String(commissionPayoutId));

  const affected = await CarWashStaffDamage.find({
    business: businessId,
    "recoveryLog.commissionPayout": payoutOid,
  }).lean();

  if (!affected.length) return;

  const updateOps = affected.map((rec) => {
    const entries = (rec.recoveryLog || []).filter(
      (e) => String(e.commissionPayout) === String(commissionPayoutId)
    );
    const toReverse = round2(entries.reduce((s, e) => s + (e.amount || 0), 0));
    const newRecovered = round2(Math.max(0, (rec.amountRecovered || 0) - toReverse));
    return {
      updateOne: {
        filter: { _id: rec._id },
        update: {
          $set: { amountRecovered: newRecovered, status: "pending", commissionPayout: null },
          $pull: { recoveryLog: { commissionPayout: payoutOid } },
        },
      },
    };
  });

  await CarWashStaffDamage.bulkWrite(updateOps, { ordered: false });
};
