/**
 * Staff Savings Service — compute-on-demand approach.
 *
 * No cron. No daily records. No "Process Today" button.
 *
 * Flow:
 *   Commission payout → deductSavingsForPayout()
 *     Computes days since last deduction period × daily rate.
 *     Caps at commission amount so staff never go negative.
 *     Creates one CarWashStaffSaving { type: "deduction" } record covering
 *     the date range since the previous deduction.
 *
 *   Balance (always accurate, computed from records):
 *     totalDeducted  = sum of non-reversed deduction records
 *     totalDisbursed = sum of non-reversed disbursement records
 *     balance        = totalDeducted − totalDisbursed   (in the savings pot)
 *     pending        = days since last deduction × rate (next payout will capture this)
 *
 *   Annual disbursement → disburseSavings()
 *     Creates { type: "disbursement" } record.
 *     Accounting: Dr 2161 / Cr Cashbook.
 */

import mongoose from "mongoose";
import Company from "../../../models/Company.js";
import CarWashStaff from "../models/CarWashStaff.js";
import CarWashStaffSaving from "../models/CarWashStaffSaving.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import { postCarWashSavingsDisbursement } from "./carwashAccountingService.js";

const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;

// UTC midnight for the current EAT calendar day.
// Adding 3 h to UTC timestamp then reading the UTC date yields the EAT date.
export const eatToday = () => {
  const nowEAT = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return new Date(Date.UTC(nowEAT.getUTCFullYear(), nowEAT.getUTCMonth(), nowEAT.getUTCDate()));
};

// ─── Settings ─────────────────────────────────────────────────────────────────

export const getSavingsDeductionAmount = async (businessId) => {
  const company = await Company.findById(businessId).select("carwashSettings").lean();
  const enabled = company?.carwashSettings?.savingsEnabled !== false;
  if (!enabled) return 0;
  const amt = Number(company?.carwashSettings?.savingsDeductionPerJob ?? 100);
  return Number.isFinite(amt) && amt >= 0 ? round2(amt) : 100;
};

// ─── Payout number generator ──────────────────────────────────────────────────

export const generateSavingsPayoutNumber = async (businessId) => {
  const stamp  = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `CWS-${stamp}-`;
  const latest = await CarWashStaffSaving.findOne(
    { business: businessId, savingsPayoutNumber: { $regex: `^${prefix}` } },
    { savingsPayoutNumber: 1 },
    { sort: { savingsPayoutNumber: -1 } }
  ).lean();
  const nextNum = latest ? parseInt(latest.savingsPayoutNumber.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(nextNum).padStart(4, "0")}`;
};

// ─── Deduct savings at commission payout time ─────────────────────────────────

/**
 * Called during commission payout.
 * Computes the calendar days since the last deduction and withholds dailyRate × days
 * from the commission (capped at commissionAmount to prevent negative net cash).
 * Creates one "deduction" record covering the period.
 * Returns the amount deducted (0 if nothing to deduct).
 */
export const deductSavingsForPayout = async ({
  businessId,
  staffId,
  commissionPayoutId,
  commissionAmount,
  payoutDate = new Date(),
}) => {
  const dailyRate = await getSavingsDeductionAmount(businessId);
  if (dailyRate <= 0) return 0;

  const today = eatToday();

  // Find the end of the most recent non-reversed deduction period
  const lastDeduction = await CarWashStaffSaving.findOne(
    { business: businessId, staff: staffId, type: "deduction", isReversed: { $ne: true } },
    { coveredTo: 1 },
    { sort: { coveredTo: -1 } }
  ).lean();

  let coveredFrom;
  if (lastDeduction?.coveredTo) {
    // Start the day after the last covered day
    coveredFrom = new Date(lastDeduction.coveredTo);
    coveredFrom.setUTCDate(coveredFrom.getUTCDate() + 1);
  } else {
    // First ever deduction — cover just today
    coveredFrom = today;
  }

  // Number of calendar days in the period (inclusive both ends)
  const msPerDay  = 24 * 60 * 60 * 1000;
  const daysCount = Math.max(0, Math.round((today - coveredFrom) / msPerDay) + 1);
  if (daysCount <= 0) return 0;

  const gross  = round2(daysCount * dailyRate);
  const amount = round2(Math.min(gross, round2(commissionAmount)));
  if (amount <= 0) return 0;

  await CarWashStaffSaving.create({
    business:         businessId,
    staff:            staffId,
    type:             "deduction",
    amount,
    dailyRate,
    daysCount,
    coveredFrom,
    coveredTo:        today,
    savingsDate:      today,          // for display compat — equals coveredTo
    commissionPayout: commissionPayoutId,
    date:             payoutDate,
    notes: `${daysCount} day${daysCount !== 1 ? "s" : ""} × Ksh ${dailyRate} — withheld from payout`,
  });

  return amount;
};

// ─── Staff savings balance ────────────────────────────────────────────────────

/**
 * Returns:
 *   totalDeducted  — withheld from payouts so far (in the pot)
 *   totalDisbursed — paid back to staff
 *   balance        — totalDeducted − totalDisbursed (physically in the pot)
 *   pending        — accrued since last deduction, captured at next payout
 *   totalAccrued   — totalDeducted + pending (grand total including pending)
 *   lastCoveredTo  — end of the last deduction period (null if none)
 */
export const getStaffSavingsBalance = async (businessId, staffId) => {
  const dailyRate = await getSavingsDeductionAmount(businessId);

  const [deductionAgg, disbursementAgg] = await Promise.all([
    CarWashStaffSaving.aggregate([
      {
        $match: {
          business: new mongoose.Types.ObjectId(String(businessId)),
          staff:    new mongoose.Types.ObjectId(String(staffId)),
          type:     "deduction",
          isReversed: { $ne: true },
        },
      },
      { $group: { _id: null, totalDeducted: { $sum: "$amount" }, lastCoveredTo: { $max: "$coveredTo" } } },
    ]),
    CarWashStaffSaving.aggregate([
      {
        $match: {
          business: new mongoose.Types.ObjectId(String(businessId)),
          staff:    new mongoose.Types.ObjectId(String(staffId)),
          type:     "disbursement",
          isReversed: { $ne: true },
        },
      },
      { $group: { _id: null, totalDisbursed: { $sum: "$amount" } } },
    ]),
  ]);

  const totalDeducted  = round2(deductionAgg[0]?.totalDeducted  || 0);
  const totalDisbursed = round2(disbursementAgg[0]?.totalDisbursed || 0);
  const lastCoveredTo  = deductionAgg[0]?.lastCoveredTo || null;

  let pending = 0;
  if (dailyRate > 0 && lastCoveredTo) {
    const today    = eatToday();
    const nextDay  = new Date(lastCoveredTo);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const daysPending = Math.max(0, Math.round((today - nextDay) / (24 * 60 * 60 * 1000)) + 1);
    pending = round2(daysPending * dailyRate);
  }

  const balance     = round2(Math.max(0, totalDeducted - totalDisbursed));
  const totalAccrued = round2(totalDeducted + pending);

  return { totalDeducted, totalDisbursed, pending, balance, totalAccrued, lastCoveredTo };
};

// ─── Initialize savings tracking for a business ──────────────────────────────

/**
 * Creates a zero-amount "deduction" anchor record for every active staff member
 * who does not yet have any deduction history.
 *
 * Anchor: coveredTo = startDate - 1 day, amount = 0.
 * Effect: the pending calculation immediately starts from startDate,
 *         and the first real deduction at payout will cover startDate → payout date.
 *
 * Idempotent — staff already with a deduction record are skipped.
 * Returns the number of anchors created.
 */
export const initializeSavingsForBusiness = async (businessId, startDate = null) => {
  const today  = eatToday();
  const anchor = startDate ? new Date(startDate) : today;
  anchor.setUTCHours(0, 0, 0, 0);

  // The anchor's coveredTo is the day BEFORE startDate so that
  // pending = daysSince(startDate) = (today - startDate + 1 day) × rate.
  const anchorCoveredTo = new Date(anchor);
  anchorCoveredTo.setUTCDate(anchorCoveredTo.getUTCDate() - 1);

  const dailyRate = await getSavingsDeductionAmount(businessId);

  // Find active staff
  const allStaff = await CarWashStaff.find(
    { business: businessId, active: { $ne: false } },
    { _id: 1 }
  ).lean();
  if (!allStaff.length) return 0;

  // Find staff that already have a deduction record
  const alreadyStarted = await CarWashStaffSaving.distinct("staff", {
    business: businessId,
    type:     "deduction",
  });
  const startedSet = new Set(alreadyStarted.map(String));

  // Create anchors for the rest
  const needsAnchor = allStaff.filter((s) => !startedSet.has(String(s._id)));
  if (!needsAnchor.length) return 0;

  await CarWashStaffSaving.insertMany(
    needsAnchor.map((s) => ({
      business:    businessId,
      staff:       s._id,
      type:        "deduction",
      amount:      0,
      dailyRate,
      daysCount:   0,
      coveredFrom: anchorCoveredTo,
      coveredTo:   anchorCoveredTo,
      savingsDate: anchorCoveredTo,
      notes:       `Savings tracking started from ${anchor.toISOString().slice(0, 10)}`,
      date:        new Date(),
    })),
    { ordered: false }
  );

  return needsAnchor.length;
};

// ─── Annual / on-request disbursement ────────────────────────────────────────

export const disburseSavings = async ({ req, businessId, staffId, cashbookAccountId, amount, notes = "" }) => {
  const bal = await getStaffSavingsBalance(businessId, staffId);
  const disburseAmount = amount != null ? round2(Number(amount)) : bal.balance;

  if (!Number.isFinite(disburseAmount) || disburseAmount <= 0) {
    throw new Error("No savings available to disburse — the savings pot is empty");
  }
  if (disburseAmount > bal.balance + 0.01) {
    throw new Error(
      `Cannot disburse more than the savings pot balance (Ksh ${bal.balance.toLocaleString()}).` +
      (bal.pending > 0 ? ` Ksh ${bal.pending.toLocaleString()} more will be available after future commission payouts.` : "")
    );
  }

  const cashbook = await ChartOfAccount.findOne({
    _id: cashbookAccountId,
    business: businessId,
    type: "asset",
    isPosting: true,
    subGroup: { $regex: "cashbook", $options: "i" },
  }).lean();
  if (!cashbook) throw new Error("Select a valid posting cashbook account for the savings payout");

  const { resolveAuditActorUserId } = await import("../../../utils/systemActor.js");
  const actorId    = req ? await resolveAuditActorUserId({ req, businessId }).catch(() => null) : null;
  const payoutNumber = await generateSavingsPayoutNumber(businessId);

  const record = await CarWashStaffSaving.create({
    business:            businessId,
    staff:               staffId,
    type:                "disbursement",
    amount:              disburseAmount,
    savingsPayoutNumber: payoutNumber,
    notes:               notes || `Staff savings payout ${payoutNumber}`,
    date:                new Date(),
    createdBy:           actorId,
  });

  await postCarWashSavingsDisbursement({ req, savingsRecord: record, cashbookAccount: cashbook });
  return record;
};
