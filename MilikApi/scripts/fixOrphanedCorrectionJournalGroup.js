// Backfills journalGroupId on "corrected entry" postings created by postCorrection (see
// services/ledgerPostingService.js) BEFORE this session's fix, which left the corrected entry's
// journalGroupId unset whenever the caller didn't explicitly pass one (the chart-of-accounts
// "reclassify" endpoint never has). That corrected entry's actual accounting is complete and
// correct — the account it posts to, the amount, the direction were all already right — it was
// just invisible to the GL integrity report's per-group balance check (which only examines entries
// that HAVE a journalGroupId), making its sibling group look unbalanced by exactly this entry's
// amount even though the real money is fine.
//
// Finds entries with journalGroupId: null whose metadata.correctionOf / metadata.reversalEntryId
// point back to a reversal already sitting in a real journal group, and backfills the SAME group —
// exactly what postCorrection now does automatically going forward. Never changes an amount,
// account, or any financial field — only which journal group the entry is filed under.
//
// Usage:
//   node scripts/fixOrphanedCorrectionJournalGroup.js                 (dry run, default, all companies)
//   node scripts/fixOrphanedCorrectionJournalGroup.js --apply
//   node scripts/fixOrphanedCorrectionJournalGroup.js --companyCode=GLR [--apply]
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

async function main() {
  const mongoUrl = process.env.MONGO_URL || process.env.MONGODB_URL;
  if (!mongoUrl) throw new Error("MONGO_URL is required.");
  await mongoose.connect(mongoUrl);

  const companyCode = getArg("companyCode");
  const companyFilter = companyCode ? { companyCode } : {};
  const companies = await Company.find(companyFilter).select("companyCode companyName").lean();
  if (companyCode && !companies.length) throw new Error(`Company ${companyCode} not found.`);

  let totalFixed = 0;

  for (const company of companies) {
    const orphans = await FinancialLedgerEntry.find({
      business: company._id,
      journalGroupId: null,
      "metadata.reversalEntryId": { $exists: true, $ne: "" },
    }).select("_id metadata.reversalEntryId metadata.correctionOf notes debit credit").lean();

    if (!orphans.length) continue;

    const reversalIds = [...new Set(orphans.map((o) => String(o.metadata?.reversalEntryId)).filter(Boolean))];
    const reversals = await FinancialLedgerEntry.find({ _id: { $in: reversalIds } })
      .select("_id journalGroupId").lean();
    const reversalGroupMap = new Map(reversals.map((r) => [String(r._id), r.journalGroupId]));

    for (const orphan of orphans) {
      const groupId = reversalGroupMap.get(String(orphan.metadata?.reversalEntryId));
      if (!groupId) {
        console.log(`  ${company.companyCode} entry=${orphan._id}: its reversal (${orphan.metadata?.reversalEntryId}) has no group either — SKIPPED, needs manual review.`);
        continue;
      }

      console.log(
        `  ${company.companyCode} entry=${orphan._id} (${orphan.debit ? `debit ${orphan.debit}` : `credit ${orphan.credit}`}, "${orphan.notes}") ` +
        `${apply ? "linking" : "would link"} into journalGroupId=${groupId}`
      );
      totalFixed++;
      if (!apply) continue;

      await FinancialLedgerEntry.collection.updateOne(
        { _id: orphan._id, journalGroupId: null },
        { $set: { journalGroupId: groupId } }
      );
    }
  }

  console.log(`\nTOTAL: ${totalFixed} orphaned correction entry/entries ${apply ? "linked" : "would be linked"} into their proper journal group.`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err?.stack || err);
  process.exit(1);
});
