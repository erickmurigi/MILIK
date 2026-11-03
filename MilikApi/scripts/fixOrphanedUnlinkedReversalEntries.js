// Corrects live GL damage from a real production bug in deleteTenantInvoice (fixed this session —
// the reversal loop now runs inside one Mongo transaction; see controllers/propertyController/
// tenantInvoices.js). Before the fix, each leg of an invoice-deletion reversal was posted one at a
// time with no transaction. When postEntry's save() committed a REVERSAL document on the server but
// still rejected the promise (a lost write acknowledgment, a replica election mid-request, etc),
// postReversal correctly un-claimed the original entry back to "approved" — but had no way to undo
// the insert that had already landed, leaving a real, orphaned REVERSAL entry behind with nothing it
// ever actually reversed. Retrying the delete repeated the exact same failure, piling up one new
// orphan per attempt (seen live on GLR invoice INV01386: 7 retries, 7 orphaned KES 9,000 credits,
// the original debit leg never actually reversed).
//
// A REVERSAL entry is legitimately linked only if the entry it names in `reversalOf` points its own
// `reversedByEntry` field back at this exact REVERSAL entry's id. Any REVERSAL entry that fails that
// check — whether because its target was never claimed-and-linked at all (this bug), or because an
// unrelated, already-fixed duplicate-race left the target linked to a sibling reversal instead (see
// fixDuplicateReversalEntries.js) — is a pure orphan: nothing it was ever meant to balance against.
// This VOIDs every such orphan (status: "void" — excluded from both the GL balance total and the
// per-group balance check, the same status this codebase already uses to retract an erroneous entry
// without deleting it). It never touches the entry named in reversalOf, and never touches a REVERSAL
// entry that IS correctly linked.
//
// This does NOT re-reverse the original entries the orphans were supposed to reverse — those are
// left exactly as they are (still "approved", unreversed). Re-run the normal delete/void action on
// each affected source transaction afterward; that is now safe, since the reversal loop runs inside
// one transaction and can no longer leave a half-done result behind.
//
// Usage:
//   node scripts/fixOrphanedUnlinkedReversalEntries.js                 (dry run, default, all companies)
//   node scripts/fixOrphanedUnlinkedReversalEntries.js --apply
//   node scripts/fixOrphanedUnlinkedReversalEntries.js --companyCode=GLR [--apply]
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

  let totalVoided = 0;
  let totalVoidedAmount = 0;
  const affectedSources = new Set();

  for (const company of companies) {
    const reversals = await FinancialLedgerEntry.find({
      business: company._id,
      category: "REVERSAL",
      reversalOf: { $ne: null },
      status: { $ne: "void" },
    })
      .select("_id reversalOf debit credit direction sourceTransactionType sourceTransactionId createdAt notes")
      .lean();

    if (!reversals.length) continue;

    const originalIds = [...new Set(reversals.map((r) => String(r.reversalOf)))];
    const originals = await FinancialLedgerEntry.find({ _id: { $in: originalIds } })
      .select("_id reversedByEntry status")
      .lean();
    const originalById = new Map(originals.map((o) => [String(o._id), o]));

    const orphans = reversals.filter((r) => {
      const original = originalById.get(String(r.reversalOf));
      return !original || String(original.reversedByEntry || "") !== String(r._id);
    });

    if (!orphans.length) continue;

    console.log(`\n=== ${company.companyName} (${company.companyCode}) — ${orphans.length} orphaned reversal(s) ===`);

    for (const orphan of orphans) {
      const amount = Number(orphan.debit || orphan.credit || 0);
      console.log(
        `  ${company.companyCode} ${apply ? "voiding" : "would void"} orphaned reversal ${orphan._id} ` +
          `(${orphan.direction} ${amount}, reversalOf=${orphan.reversalOf}, source=${orphan.sourceTransactionType}/${orphan.sourceTransactionId}, ` +
          `createdAt=${orphan.createdAt?.toISOString()}, notes="${orphan.notes || ""}")`
      );
      totalVoided++;
      totalVoidedAmount += amount;
      if (orphan.sourceTransactionId) {
        affectedSources.add(`${company.companyCode}:${orphan.sourceTransactionType}:${orphan.sourceTransactionId}`);
      }

      if (!apply) continue;

      await FinancialLedgerEntry.collection.updateOne(
        { _id: orphan._id, status: { $ne: "void" } },
        { $set: { status: "void" } }
      );
    }
  }

  console.log(
    `\nTOTAL: ${totalVoided} orphaned reversal(s) ${apply ? "voided" : "would be voided"} ` +
      `(KES ${totalVoidedAmount.toLocaleString()}), affecting ${affectedSources.size} source transaction(s): ` +
      `${[...affectedSources].join(", ") || "none"}`
  );
  if (affectedSources.size > 0) {
    console.log(
      `\nThe original entries these orphans were supposed to reverse are still unreversed and ` +
        `untouched by this script. Re-run the normal delete/void action on each affected source ` +
        `transaction above — safe to do now that the reversal loop runs inside one transaction.`
    );
  }
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err?.stack || err);
  process.exit(1);
});
