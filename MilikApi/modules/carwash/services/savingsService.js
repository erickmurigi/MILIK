/**
 * Staff Savings Service
 *
 * Ksh X per staff member per calendar day — a standing-order deduction.
 * Independent of whether the staff worked, earned commission, or was present.
 *
 * Flow:
 *   Daily cron (midnight) → processDailySavings(businessId, date)
 *     → one CarWashStaffSaving { type:"daily" } per active staff per day
 *     → unique index prevents double-posting for the same date
 *
 *   Commission payout → holdSavingsForPayout()
 *     → marks unprocessed daily records as "held" in this payout
 *     → reduces cash paid; accounting: Dr 2160 / Cr Cash (net) + Cr 2161 (savings)
 *
 *   Annual disbursement → disburseSavings()
 *     → creates { type:"disbursement" } record
 *     → accounting: Dr 2161 / Cr Cashbook
 */

import mongoose from "mongoose";
import Company from "../../../models/Company.js";
import CarWashStaff from "../models/CarWashStaff.js";
import CarWashStaffSaving from "../models/CarWashStaffSaving.js";
import CarWashCommissionPayout from "../models/CarWashCommissionPayout.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import { postCarWashSavingsDisbursement } from "./carwashAccountingService.js";

const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;

// ─── Settings ─────────────────────────────────────────────────────────────────

export const getSavingsDeductionAmount = async (businessId) => {
  const company = await Company.findById(businessId).select("carwashSettings").lean();
  // savingsEnabled treated as true when field is absent (backward compat for existing businesses)
  const enabled = company?.carwashSettings?.savingsEnabled !== false;
  if (!enabled) return 0;
  const amt = Number(company?.carwashSettings?.savingsDeductionPerJob ?? 100);
  return Number.isFinite(amt) && amt >= 0 ? round2(amt) : 100;
};

// Zero-time a date to midnight UTC so every day has a canonical key
const dayKey = (d = new Date()) => {
  const dt = d instanceof Date ? d : new Date(d);
  const out = new Date(dt);
  out.setUTCHours(0, 0, 0, 0);
  return out;
};

// ─── Payout number generator ──────────────────────────────────────────────────

export const generateSavingsPayoutNumber = async (businessId) => {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `CWS-${stamp}-`;
  const latest = await CarWashStaffSaving.findOne(
    { business: businessId, savingsPayoutNumber: { $regex: `^${prefix}` } },
    { savingsPayoutNumber: 1 },
    { sort: { savingsPayoutNumber: -1 } }
  ).lean();
  const nextNum = latest ? parseInt(latest.savingsPayoutNumber.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(nextNum).padStart(4, "0")}`;
};

// ─── Daily savings processing ─────────────────────────────────────────────────

/**
 * Posts one daily savings record per active staff member for `date`.
 * Skips staff that already have a record for that date (idempotent).
 * Returns { posted, skipped, errors }.
 */
export const processDailySavings = async (businessId, date = new Date()) => {
  const amount = await getSavingsDeductionAmount(businessId);
  if (amount <= 0) return { posted: 0, skipped: 0, errors: [] };

  const savingsDate = dayKey(date);

  const activeStaff = await CarWashStaff.find({ business: businessId, active: { $ne: false } })
    .select("_id branch")
    .lean();

  if (!activeStaff.length) return { posted: 0, skipped: 0, errors: [] };

  let posted = 0, skipped = 0;
  const errors = [];

  for (const member of activeStaff) {
    try {
      await CarWashStaffSaving.create({
        business:    businessId,
        branch:      member.branch || null,
        staff:       member._id,
        type:        "daily",
        amount,
        savingsDate,
        date:        savingsDate,
        notes:       `Daily savings — ${savingsDate.toISOString().slice(0, 10)}`,
      });
      posted++;
    } catch (err) {
      // E11000 = unique constraint — already posted for this date
      if (err.code === 11000) { skipped++; continue; }
      errors.push({ staff: String(member._id), error: err?.message || String(err) });
    }
  }

  return { posted, skipped, errors };
};

/**
 * Processes daily savings for ALL carwash businesses for a given date.
 * Called by the midnight cron job.
 */
export const runDailySavingsCron = async (date = new Date()) => {
  const businesses = await Company.find({ "modules.carwash": true }).select("_id").lean();
  const results = [];

  for (const biz of businesses) {
    try {
      const result = await processDailySavings(String(biz._id), date);
      results.push({ businessId: String(biz._id), ...result });
    } catch (err) {
      results.push({ businessId: String(biz._id), error: err?.message || String(err) });
    }
  }

  console.log(`[CW Savings Cron] ${date.toISOString().slice(0, 10)}: ${results.map((r) => `${r.businessId.slice(-6)}: +${r.posted ?? 0}`).join(", ")}`);
  return results;
};

// ─── Staff savings balance ────────────────────────────────────────────────────

/**
 * Returns savings summary for a staff member:
 *   totalDaily      — sum of all daily standing-order records
 *   totalHeld       — daily records already withheld from a commission payout
 *   pendingToHold   — daily records not yet withheld (deducted from next payout)
 *   totalDisbursed  — amount paid back to staff (annual payouts)
 *   balance         — totalHeld − totalDisbursed (in the pot, ready for annual payout)
 */
export const getStaffSavingsBalance = async (businessId, staffId) => {
  const [dailyRows, disbursementRows] = await Promise.all([
    CarWashStaffSaving.aggregate([
      { $match: { business: new mongoose.Types.ObjectId(String(businessId)), staff: new mongoose.Types.ObjectId(String(staffId)), type: "daily" } },
      { $group: {
          _id: null,
          totalDaily: { $sum: "$amount" },
          totalHeld:  { $sum: { $cond: [{ $ne: ["$commissionPayout", null] }, "$amount", 0] } },
      }},
    ]),
    CarWashStaffSaving.aggregate([
      { $match: { business: new mongoose.Types.ObjectId(String(businessId)), staff: new mongoose.Types.ObjectId(String(staffId)), type: "disbursement", isReversed: { $ne: true } } },
      { $group: { _id: null, totalDisbursed: { $sum: "$amount" } } },
    ]),
  ]);

  const totalDaily     = round2(dailyRows[0]?.totalDaily     || 0);
  const totalHeld      = round2(dailyRows[0]?.totalHeld      || 0);
  const totalDisbursed = round2(disbursementRows[0]?.totalDisbursed || 0);
  const pendingToHold  = round2(totalDaily - totalHeld);
  // Balance = everything accumulated − what's been paid back to staff
  // (includes both held-from-payouts and not-yet-held portions)
  const balance        = round2(totalDaily - totalDisbursed);

  return { totalDaily, totalHeld, pendingToHold, totalDisbursed, balance };
};

// ─── Hold savings from a commission payout ───────────────────────────────────

/**
 * Marks unheld daily savings as held in a commission payout.
 * Caps the held amount at commissionAmount so staff can't go negative.
 * Returns amount withheld.
 */
export const holdSavingsForPayout = async ({ businessId, staffId, commissionPayoutId, commissionAmount }) => {
  const pending = await CarWashStaffSaving.find({
    business:         businessId,
    staff:            staffId,
    type:             "daily",
    commissionPayout: null,
  }).sort({ savingsDate: 1 }).lean();

  if (!pending.length) return 0;

  let held = 0;
  const toMark = [];
  for (const rec of pending) {
    const next = round2(held + rec.amount);
    if (next > round2(commissionAmount) + 0.01) break;
    held = next;
    toMark.push(rec._id);
  }
  if (!toMark.length) return 0;

  await CarWashStaffSaving.updateMany(
    { _id: { $in: toMark } },
    { $set: { commissionPayout: commissionPayoutId } }
  );
  return round2(held);
};

// ─── Annual / on-request disbursement ────────────────────────────────────────

export const disburseSavings = async ({ req, businessId, staffId, cashbookAccountId, amount, notes = "" }) => {
  const balance = await getStaffSavingsBalance(businessId, staffId);
  const disburseAmount = amount != null ? round2(Number(amount)) : balance.balance;

  if (!Number.isFinite(disburseAmount) || disburseAmount <= 0) {
    throw new Error("No savings balance available to disburse");
  }
  // balance = totalDaily - totalDisbursed (total accumulated minus already paid out)
  if (disburseAmount > balance.balance + 0.01) {
    throw new Error(`Cannot disburse more than the accumulated savings balance (Ksh ${balance.balance.toLocaleString()})`);
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
  const actorId = req ? await resolveAuditActorUserId({ req, businessId }).catch(() => null) : null;
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
