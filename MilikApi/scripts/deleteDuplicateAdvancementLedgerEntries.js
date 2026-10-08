// One-off cleanup: the (now-fixed) "offsetEntry is not defined" bug in
// controllers/propertyController/landlordAdvancements.js crashed AFTER both GL legs of a
// disbursement were posted but BEFORE row.disbursedAt was saved — so a failed Disburse
// click left two real, orphaned ledger entries behind and the button stayed clickable,
// letting the user retry. This deletes the orphaned entry pairs (found via
// scripts/inspectAdvancementLedger.js), keeping only the pair the advance record itself
// references, then re-syncs the affected account balances.
//
//   node scripts/deleteDuplicateAdvancementLedgerEntries.js                  (dry run)
//   node scripts/deleteDuplicateAdvancementLedgerEntries.js --apply          (deletes + resyncs)
import mongoose from "mongoose";
import dotenv from "dotenv";
import LandlordAdvancement from "../models/LandlordAdvancement.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import "../models/ChartOfAccount.js";
import { aggregateChartOfAccountBalances } from "../services/chartAccountAggregationService.js";

dotenv.config();

const ADVANCEMENT_ID = "6ac80777818dd0ae7bc93029"; // LADV0001, ABRI REALTORS

async function main() {
  const mongoUrl = process.env.MONGO_URL || process.env.MONGODB_URL;
  if (!mongoUrl) throw new Error("MONGO_URL is required.");
  const apply = process.argv.includes("--apply");

  await mongoose.connect(mongoUrl);

  const row = await LandlordAdvancement.findById(ADVANCEMENT_ID);
  if (!row) throw new Error("Advancement not found");

  const entries = await FinancialLedgerEntry.find({
    business: row.business,
    sourceTransactionType: "advance",
    sourceTransactionId: String(row._id),
  })
    .populate({ path: "accountId", select: "code name" })
    .sort({ createdAt: 1 })
    .lean();

  const validIds = new Set([String(row.disbursementEntryId), String(row.disbursementOffsetEntryId)]);
  const orphaned = entries.filter((e) => !validIds.has(String(e._id)));

  if (orphaned.length === 0) {
    console.log("No orphaned entries found — nothing to do.");
    await mongoose.disconnect();
    return;
  }

  console.log(`${entries.length} total entries, ${orphaned.length} orphaned (not referenced by the advancement record):`);
  orphaned.forEach((e) => {
    console.log(`  ${e._id} ${e.direction.toUpperCase()} ${e.amount} ${e.accountId?.code} ${e.accountId?.name} jgid=${e.journalGroupId} ${e.createdAt?.toISOString?.()}`);
  });

  const affectedAccountIds = [...new Set(orphaned.map((e) => String(e.accountId?._id || e.accountId)))];

  if (!apply) {
    console.log("\nDry run — pass --apply to delete these entries and resync balances for:");
    affectedAccountIds.forEach((id) => console.log(`  ${id}`));
    await mongoose.disconnect();
    return;
  }

  const result = await FinancialLedgerEntry.deleteMany({ _id: { $in: orphaned.map((e) => e._id) } });
  console.log(`\nDeleted ${result.deletedCount} entries.`);

  await aggregateChartOfAccountBalances(String(row.business), affectedAccountIds);
  console.log(`Resynced balances for ${affectedAccountIds.length} account(s).`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
