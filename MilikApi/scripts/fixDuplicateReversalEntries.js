// Corrects the live GL damage from a real concurrency bug in postReversal (fixed this session —
// see services/ledgerPostingService.js): two overlapping calls to postReversal for the SAME
// original ledger entry (e.g. two overlapping deleteTenantInvoice requests for the same invoice —
// most likely a double-submitted run of the duplicate-invoice removal script) could both read the
// entry as "not yet reversed" before either had written back, so both posted a reversal credit/
// debit leg. The result: one original leg ends up with 2+ reversal entries instead of 1, breaking
// the journal group's debit=credit balance by the duplicated leg's amount.
//
// For every journal group where an original entry has MORE than one reversal entry pointing at it
// (grouped by FinancialLedgerEntry.reversalOf), this keeps the EARLIEST reversal (the legitimate
// one) and VOIDs every later duplicate (status: "void" — excluded from both the GL balance total
// and the per-group balance check, the same status this codebase already uses elsewhere to retract
// an erroneous entry without deleting it). If the original entry's own reversedByEntry link points
// at a duplicate being voided, it's repointed to the surviving reversal so the two stay linked.
// Never touches any entry that isn't a provably-extra duplicate of an already-kept reversal.
//
// Usage:
//   node scripts/fixDuplicateReversalEntries.js                 (dry run, default, all companies)
//   node scripts/fixDuplicateReversalEntries.js --apply
//   node scripts/fixDuplicateReversalEntries.js --companyCode=GLR [--apply]
import mongoose from "mongoose";
import dotenv from "dotenv";
import Company from "../models/Company.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";

dotenv.config();
const getArg = (name, fallback = "") => {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
};
const apply = process.argv.includes("--apply");

const debitExpr = { $cond: [{ $gt: [{ $ifNull: ["$debit", -1] }, -1] }, "$debit", { $cond: [{ $eq: ["$direction", "debit"] }, "$amount", 0] }] };
const creditExpr = { $cond: [{ $gt: [{ $ifNull: ["$credit", -1] }, -1] }, "$credit", { $cond: [{ $eq: ["$direction", "credit"] }, "$amount", 0] }] };

async function main() {
  const mongoUrl = process.env.MONGO_URL || process.env.MONGODB_URL;
  if (!mongoUrl) throw new Error("MONGO_URL is required.");
  await mongoose.connect(mongoUrl);

  const companyCode = getArg("companyCode");
  const companyFilter = companyCode ? { companyCode } : {};
  const companies = await Company.find(companyFilter).select("companyCode companyName").lean();
  if (companyCode && !companies.length) throw new Error(`Company ${companyCode} not found.`);

  let totalVoided = 0, totalVoidedAmount = 0, totalGroupsFixed = 0, totalGroupsUnresolved = 0;

  for (const company of companies) {
    const unbalancedGroups = await FinancialLedgerEntry.aggregate([
      { $match: { business: company._id, status: { $in: ["approved", "reversed"] }, journalGroupId: { $ne: null } } },
      { $group: { _id: "$journalGroupId", debitSum: { $sum: debitExpr }, creditSum: { $sum: creditExpr } } },
      { $addFields: { diff: { $subtract: ["$debitSum", "$creditSum"] } } },
      { $match: { diff: { $not: { $gt: -0.01, $lt: 0.01 } } } },
    ]);

    if (!unbalancedGroups.length) continue;
    console.log(`\n=== ${company.companyName} (${company.companyCode}) — ${unbalancedGroups.length} unbalanced group(s) ===`);

    for (const group of unbalancedGroups) {
      const entries = await FinancialLedgerEntry.find({ business: company._id, journalGroupId: group._id })
        .select("_id status category debit credit direction reversalOf reversedByEntry createdAt sourceTransactionType sourceTransactionId")
        .sort({ createdAt: 1 })
        .lean();

      const reversalsByOriginal = new Map();
      for (const e of entries) {
        if (e.category !== "REVERSAL" || !e.reversalOf) continue;
        const key = String(e.reversalOf);
        if (!reversalsByOriginal.has(key)) reversalsByOriginal.set(key, []);
        reversalsByOriginal.get(key).push(e);
      }

      let groupHasDuplicates = false;
      for (const [originalId, reversals] of reversalsByOriginal.entries()) {
        if (reversals.length <= 1) continue;
        groupHasDuplicates = true;
        const [keep, ...duplicates] = reversals; // already sorted by createdAt asc
        const original = entries.find((e) => String(e._id) === originalId);

        for (const dup of duplicates) {
          console.log(
            `  ${company.companyCode} group=${group._id} ${apply ? "voiding" : "would void"} duplicate reversal ${dup._id} ` +
            `(${dup.direction} ${dup.debit || dup.credit}) — keeping ${keep._id}`
          );
          totalVoided++;
          totalVoidedAmount += Number(dup.debit || dup.credit || 0);

          if (!apply) continue;

          await FinancialLedgerEntry.collection.updateOne(
            { _id: dup._id, status: "approved" },
            { $set: { status: "void" } }
          );

          // If the original's reversedByEntry pointed at the duplicate being voided, repoint it
          // to the surviving reversal so the link stays meaningful.
          if (original && String(original.reversedByEntry) === String(dup._id)) {
            await FinancialLedgerEntry.collection.updateOne(
              { _id: original._id },
              { $set: { reversedByEntry: keep._id } }
            );
          }
        }
      }

      if (groupHasDuplicates) totalGroupsFixed++;
      else {
        totalGroupsUnresolved++;
        console.log(`  ${company.companyCode} group=${group._id}: UNRESOLVED — imbalance isn't from a duplicate reversal (sourceType=${entries[0]?.sourceTransactionType}, sourceId=${entries[0]?.sourceTransactionId}). Needs separate manual review.`);
      }
    }
  }

  console.log(
    `\nTOTAL: ${totalVoided} duplicate reversal(s) ${apply ? "voided" : "would be voided"} (KES ${totalVoidedAmount.toLocaleString()}), ` +
    `${totalGroupsFixed} group(s) resolved, ${totalGroupsUnresolved} group(s) left unresolved (different root cause — needs manual review)`
  );
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err?.stack || err);
  process.exit(1);
});
