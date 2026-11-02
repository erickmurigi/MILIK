// scripts/correct2130HistoricalImpact.js was run more than once against the same company, and had
// no guard against that: its "abnormal balance" check aggregates by the ORIGINAL payment's own
// sourceTransactionId, which never includes the correction entries it posts (they use a synthetic
// "2130-correction:<id>:<date>" sourceTransactionId instead) — so re-running it finds the exact same
// abnormal payment every time and posts another full correction on top of the first.
//
// Confirmed via scripts/_diag2130corrbatches.js: every company that received a 2130 correction this
// session (AR, GLR, SR, IPL, MSL) has each payment's correction posted in TWO separate journal groups,
// minutes apart, same amounts. This script finds every duplicate batch (keeping only the EARLIEST
// journalGroupId per original payment) and properly reverses every entry in each later batch via
// postReversal — never edits/deletes the original (first, legitimate) correction or the duplicate
// entries themselves, just posts the offsetting reversal, same convention as every other fix this
// session.
//
// Usage:
//   node scripts/fix2130DuplicateCorrections.js --companyCode=GLR            (dry run, default)
//   node scripts/fix2130DuplicateCorrections.js --companyCode=GLR --apply    (posts the reversal)
import mongoose from "mongoose";
import dotenv from "dotenv";
import Company from "../models/Company.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import { postReversal } from "../services/ledgerPostingService.js";
import { ensureSystemAuditUser } from "../utils/systemActor.js";
import { aggregateChartOfAccountBalances } from "../services/chartAccountAggregationService.js";

dotenv.config();
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

const getArg = (name, fallback = "") => {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
};
const apply = process.argv.includes("--apply");

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

  const correctionEntries = await FinancialLedgerEntry.find({
    business: company._id,
    "metadata.postingKind": "unallocated_receipts_correction",
    status: "approved",
  }).select("journalGroupId metadata.originalSourceTransactionId createdAt accountId direction amount credit debit").sort({ createdAt: 1 }).lean();

  const byOriginal = new Map();
  for (const entry of correctionEntries) {
    const key = String(entry.metadata?.originalSourceTransactionId || "");
    if (!key) continue;
    if (!byOriginal.has(key)) byOriginal.set(key, new Map());
    const groups = byOriginal.get(key);
    const groupKey = String(entry.journalGroupId);
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(entry);
  }

  let actorId = null;
  if (apply) {
    const systemAuditUser = await ensureSystemAuditUser(company._id);
    actorId = systemAuditUser?._id;
  }

  let totalReversed = 0;
  let batchesReversed = 0;
  const touchedAccountIds = new Set();

  for (const [originalId, groups] of byOriginal) {
    if (groups.size < 2) continue; // only one application — nothing to undo

    // Keep the earliest journal group (by its entries' earliest createdAt), reverse every other one.
    const groupEntries = [...groups.entries()].map(([groupKey, entries]) => ({
      groupKey,
      entries,
      earliest: entries.reduce((min, e) => (e.createdAt < min ? e.createdAt : min), entries[0].createdAt),
    }));
    groupEntries.sort((a, b) => a.earliest - b.earliest);
    const [keep, ...duplicates] = groupEntries;

    for (const dup of duplicates) {
      const batchTotal = round2(
        dup.entries.reduce((s, e) => s + Number(e.credit || (e.direction === "credit" ? e.amount : 0) || 0), 0)
      );
      console.log(
        `  Payment ${originalId}: duplicate batch ${dup.groupKey} (kept ${keep.groupKey}) — reversing ${dup.entries.length} entries totalling KES ${batchTotal.toLocaleString()}`
      );
      totalReversed += batchTotal;
      batchesReversed++;

      if (!apply) continue;

      for (const entry of dup.entries) {
        await postReversal({
          entryId: entry._id,
          reason: `Auto-reversal of duplicate 2130 correction batch (correct2130HistoricalImpact.js was run twice for this payment)`,
          userId: actorId,
        });
        touchedAccountIds.add(String(entry.accountId));
      }
    }
  }

  if (apply && touchedAccountIds.size) {
    await aggregateChartOfAccountBalances(company._id, [...touchedAccountIds]);
  }

  console.log(`  TOTAL ${apply ? "reversed" : "would reverse"}: KES ${round2(totalReversed).toLocaleString()} across ${batchesReversed} duplicate batch(es)`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err?.stack || err);
  process.exit(1);
});
