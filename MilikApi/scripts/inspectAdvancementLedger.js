// Read-only diagnostic: lists every FinancialLedgerEntry posted for a given
// LandlordAdvancement, to check for duplicate disbursement postings left behind by the
// (now-fixed) "offsetEntry is not defined" bug — a failed Disburse click still posted
// both GL legs before crashing on the undefined-variable line, so disbursedAt never got
// saved and the button stayed clickable, letting retries post duplicate pairs.
//
//   node scripts/inspectAdvancementLedger.js --ref=LADV0001
import mongoose from "mongoose";
import dotenv from "dotenv";
import LandlordAdvancement from "../models/LandlordAdvancement.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import "../models/ChartOfAccount.js";

dotenv.config();

const getArg = (name) => {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : "";
};

async function main() {
  const mongoUrl = process.env.MONGO_URL || process.env.MONGODB_URL;
  if (!mongoUrl) throw new Error("MONGO_URL is required.");
  const ref = getArg("ref");
  if (!ref) throw new Error("Pass --ref=<referenceNo>");

  await mongoose.connect(mongoUrl);

  const row = await LandlordAdvancement.findOne({ referenceNo: ref }).lean();
  if (!row) {
    console.log(`No advancement found with referenceNo ${ref}`);
    await mongoose.disconnect();
    return;
  }

  console.log(`Advancement ${row.referenceNo} (${row._id})`);
  console.log(`  disbursedAt: ${row.disbursedAt || "(not set)"}`);
  console.log(`  disbursementEntryId: ${row.disbursementEntryId || "(none)"}`);
  console.log(`  disbursementOffsetEntryId: ${row.disbursementOffsetEntryId || "(none)"}`);

  const entries = await FinancialLedgerEntry.find({
    business: row.business,
    sourceTransactionType: "advance",
    sourceTransactionId: String(row._id),
  })
    .populate({ path: "accountId", select: "code name" })
    .sort({ createdAt: 1 })
    .lean();

  console.log(`\nFound ${entries.length} ledger entries for this advance:`);
  entries.forEach((e, i) => {
    const isKnownValid = String(e._id) === String(row.disbursementEntryId) || String(e._id) === String(row.disbursementOffsetEntryId);
    console.log(
      `  [${i}] _id=${e._id} ${e.direction.toUpperCase().padEnd(6)} ${String(e.amount).padStart(10)} ` +
      `acct=${e.accountId?.code || "?"} ${e.accountId?.name || "?"} journalGroupId=${e.journalGroupId} ` +
      `createdAt=${e.createdAt?.toISOString?.() || e.createdAt} ${isKnownValid ? "  <-- referenced by row" : ""}`
    );
  });

  // Group by journalGroupId to see how many distinct disbursement attempts posted entries
  const byGroup = new Map();
  entries.forEach((e) => {
    const key = String(e.journalGroupId || "none");
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(e);
  });
  console.log(`\n${byGroup.size} distinct journalGroupId(s) found (each = one Disburse attempt that posted entries):`);
  for (const [key, group] of byGroup.entries()) {
    console.log(`  group ${key}: ${group.length} entries`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
