// Posts a correcting journal for the real historical impact of the Unallocated Receipts (2130) bug
// fixed this session in controllers/adminController/statementAllocations.js — never edits/deletes the
// original wrong entries, preserving the full audit trail; posts a new, clearly-labelled correction
// dated today.
//
// Correction logic, derived and verified during the investigation:
//   reallocatePayment trusted the stored allocationSummary.unapplied field instead of the real GL
//   balance when releasing a receipt's unapplied amount into tenant charges — debiting 2130
//   (postingRole: "tenant_advance_release") by more than the account ever held for that receipt.
//   For each affected payment (grouped by sourceTransactionId), the true abnormal amount is simply
//   credit-total minus debit-total on 2130 for that payment (confirmed: same-journal-group offsetting
//   legs, e.g. a "cashbook"-tagged debit paired with the original "tenant_advance_liability" credit,
//   are a normal, expected part of the correct original posting flow and already net out correctly —
//   do not treat them as a separate anomaly).
//   The erroneous "tenant_advance_release" debit's own journal group always pairs 1:1 with a sibling
//   credit leg on a DIFFERENT account (the allocation-group's receivable/income account it was
//   wrongly released into, e.g. tagged "tenant_advance_release_deposit_landlord") for the exact same
//   amount — so the precise, fully-mirrored reversal is: Credit 2130 back / Debit that same sibling
//   account, for exactly the abnormal portion (capped if a payment's releases were only partially
//   illegitimate).
//
// Usage:
//   node scripts/correct2130HistoricalImpact.js --companyCode=GLR            (dry run, default)
//   node scripts/correct2130HistoricalImpact.js --companyCode=GLR --apply    (posts the correction)
import mongoose from "mongoose";
import dotenv from "dotenv";
import Company from "../models/Company.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import { postEntry } from "../services/ledgerPostingService.js";
import { aggregateChartOfAccountBalances } from "../services/chartAccountAggregationService.js";

dotenv.config();
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

const getArg = (name, fallback = "") => {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
};
const apply = process.argv.includes("--apply");

const debitExpr = { $cond: [{ $gt: ["$debit", 0] }, "$debit", { $cond: [{ $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "debit"] }, { $ifNull: ["$amount", 0] }, 0] }] };
const creditExpr = { $cond: [{ $gt: ["$credit", 0] }, "$credit", { $cond: [{ $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "credit"] }, { $ifNull: ["$amount", 0] }, 0] }] };

async function main() {
  const mongoUrl = process.env.MONGO_URL || process.env.MONGODB_URL;
  if (!mongoUrl) throw new Error("MONGO_URL is required.");
  await mongoose.connect(mongoUrl);

  const companyCode = getArg("companyCode");
  if (!companyCode) throw new Error("--companyCode is required.");
  const company = await Company.findOne({ companyCode }).lean();
  if (!company) throw new Error(`Company ${companyCode} not found.`);
  console.log(`\n=== ${company.companyName} (${company.companyCode}) — ${apply ? "APPLYING" : "DRY RUN"} ===`);

  const account = await ChartOfAccount.findOne({ business: company._id, code: "2130" }).lean();
  if (!account) throw new Error("2130 account not found.");

  // Net balance PER PAYMENT (sourceTransactionId) — the abnormal (negative) portion per payment is
  // exactly what that payment's correcting entry should restore.
  const bySource = await FinancialLedgerEntry.aggregate([
    { $match: { business: company._id, accountId: account._id, status: { $in: ["approved", "reversed"] } } },
    { $group: { _id: "$sourceTransactionId", debit: { $sum: debitExpr }, credit: { $sum: creditExpr } } },
  ]);

  // Guard against re-running this script against a payment it already corrected — the abnormal-balance
  // check above is keyed on the ORIGINAL payment's sourceTransactionId, which never includes the
  // correction entries themselves (they use a synthetic "2130-correction:<id>:<date>" id instead), so
  // without this guard a second run would find the same abnormal payment and post a second, duplicate
  // correction on top of the first (this happened historically — see scripts/fix2130DuplicateCorrections.js).
  const alreadyCorrectedIds = new Set(
    (
      await FinancialLedgerEntry.find({
        business: company._id,
        "metadata.postingKind": "unallocated_receipts_correction",
        "metadata.originalSourceTransactionId": { $exists: true },
        status: { $in: ["approved", "reversed"] },
      }).select("metadata.originalSourceTransactionId").lean()
    ).map((e) => String(e.metadata.originalSourceTransactionId))
  );

  let totalCorrected = 0;
  let paymentsCorrected = 0;
  for (const row of bySource) {
    const net = round2(row.credit - row.debit);
    if (net >= -0.01 || !row._id) continue; // not abnormal, or no payment id to trace — skip
    if (alreadyCorrectedIds.has(String(row._id))) {
      console.log(`  Payment ${row._id}: already corrected in a prior run — skipping.`);
      continue;
    }

    const abnormalAmount = round2(Math.abs(net));

    // Find this payment's "tenant_advance_release" debit legs on 2130, and each one's sibling
    // (non-2130) credit leg in the SAME journal group — the precise mirror to reverse.
    const releaseLegs = await FinancialLedgerEntry.find({
      business: company._id, accountId: account._id, sourceTransactionId: row._id,
      "metadata.postingRole": "tenant_advance_release", status: { $in: ["approved", "reversed"] },
    }).select("journalGroupId debit credit direction").lean();

    const groupIds = releaseLegs.map((l) => l.journalGroupId).filter(Boolean);
    const siblingLegs = groupIds.length
      ? await FinancialLedgerEntry.find({
          business: company._id, journalGroupId: { $in: groupIds }, accountId: { $ne: account._id },
          status: { $in: ["approved", "reversed"] },
        }).select("accountId credit debit direction journalGroupId").lean()
      : [];

    // Aggregate sibling credit amounts by account, scaled down proportionally if the payment's
    // abnormal amount is less than the full release total (i.e. part of the release WAS legitimate).
    const releaseTotal = round2(releaseLegs.reduce((s, l) => s + Number(l.debit || 0), 0));
    const scale = releaseTotal > 0 ? Math.min(1, abnormalAmount / releaseTotal) : 0;
    const byAccount = new Map();
    for (const leg of siblingLegs) {
      const amt = round2(Number(leg.credit || 0) * scale);
      if (amt <= 0) continue;
      const key = String(leg.accountId);
      byAccount.set(key, round2((byAccount.get(key) || 0) + amt));
    }

    const mirroredTotal = round2([...byAccount.values()].reduce((s, v) => s + v, 0));
    if (mirroredTotal <= 0) {
      console.log(`  Payment ${row._id}: abnormal KES ${abnormalAmount.toLocaleString()} — no traceable sibling leg found, SKIPPING (needs manual review).`);
      continue;
    }

    console.log(`  Payment ${row._id}: correcting KES ${mirroredTotal.toLocaleString()} (Cr 2130 / Dr ${byAccount.size} account(s))`);
    totalCorrected += mirroredTotal;
    paymentsCorrected++;

    if (!apply) continue;

    const payment = await (await import("../models/RentPayment.js")).default.findById(row._id).select("property landlord tenant").lean();
    const journalGroupId = new mongoose.Types.ObjectId();
    const today = new Date();
    const note = `GL correction: Unallocated Receipts (2130) was over-debited by a confirmed bug ` +
      `(stale allocationSummary.unapplied field trusted during admin reallocation, instead of the real ` +
      `GL balance) fixed this session. Restores the account to its true balance for this payment. ` +
      `See controllers/adminController/statementAllocations.js (reallocatePayment).`;

    const creditLeg = await postEntry({
      business: company._id,
      property: payment?.property || null,
      landlord: payment?.landlord || null,
      tenant: payment?.tenant || null,
      sourceTransactionType: "manual_adjustment",
      sourceTransactionId: `2130-correction:${row._id}:${today.toISOString().slice(0, 10)}`,
      transactionDate: today,
      statementPeriodStart: today,
      statementPeriodEnd: today,
      category: "ADJUSTMENT",
      amount: mirroredTotal,
      direction: "credit",
      accountId: account._id,
      journalGroupId,
      payer: "manager",
      receiver: "system",
      notes: note,
      metadata: { postingKind: "unallocated_receipts_correction", includeInLandlordStatement: false, correctionOf: "stale_unapplied_reallocation_bug", originalSourceTransactionId: String(row._id) },
      status: "approved",
    });
    for (const [accountId, amount] of byAccount) {
      await postEntry({
        business: company._id,
        property: payment?.property || null,
        landlord: payment?.landlord || null,
        tenant: payment?.tenant || null,
        sourceTransactionType: "manual_adjustment",
        sourceTransactionId: `2130-correction:${row._id}:${today.toISOString().slice(0, 10)}`,
        transactionDate: today,
        statementPeriodStart: today,
        statementPeriodEnd: today,
        category: "ADJUSTMENT",
        amount,
        direction: "debit",
        accountId,
        journalGroupId,
        payer: "manager",
        receiver: "tenant",
        notes: note,
        metadata: { postingKind: "unallocated_receipts_correction", includeInLandlordStatement: false, correctionOf: "stale_unapplied_reallocation_bug", originalSourceTransactionId: String(row._id), offsetOfEntryId: String(creditLeg._id) },
        status: "approved",
      });
    }
    await aggregateChartOfAccountBalances(company._id, [String(account._id), ...byAccount.keys()]);
  }

  console.log(`  TOTAL ${apply ? "corrected" : "would correct"}: KES ${round2(totalCorrected).toLocaleString()} across ${paymentsCorrected} payment(s)`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err?.stack || err);
  process.exit(1);
});
