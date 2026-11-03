// Finishes invoice deletions that were interrupted partway through — found via the GL integrity
// report and traced back to the same root cause as the duplicate-reversal bug (fixed this session
// in services/ledgerPostingService.js postReversal): deleteTenantInvoice loops over an invoice's
// original ledger legs and calls postReversal on each in turn. If that loop is interrupted (process
// killed, a double-submitted script run racing itself, a transient DB error) partway through, you
// can be left with: a reversal entry that WAS created but never linked back to the original leg it
// reverses (the original still shows status "approved" instead of "reversed"), and/or a sibling leg
// of the SAME invoice that was never reversed at all — while the invoice document itself is still
// stuck "pending", never actually marked deleted.
//
// Signature this looks for: a TenantInvoice whose status is still active (pending/paid/
// partially_paid) but at least one of its own ledgerEntries already has an "approved" REVERSAL
// entry pointing at it (reversalOf) — proof a deletion was attempted and got partway done.
//
// Fix, per affected invoice:
//   1. For each of its original entries that has exactly one surviving "approved" reversal
//      pointing at it (after fixDuplicateReversalEntries.js has already voided any EXTRA
//      duplicates — run that script first), repair the missing link: set the original's own
//      status to "reversed" and reversedByEntry to that reversal's id. This is exactly what
//      postReversal's own write-back step does normally — only running here because that step
//      never completed the first time.
//   2. Call the real deleteTenantInvoice controller again. Now that already-reversed legs are
//      correctly marked, its own pendingEntries filter skips them and finishes reversing whatever
//      is genuinely still outstanding, then properly transitions the invoice to "reversed" — the
//      exact same safety machinery (GL balance, receipt-allocation guard) as every other deletion
//      in this codebase, not a hand-rolled GL fix.
//
// Usage:
//   node scripts/repairInterruptedInvoiceDeletions.js                 (dry run, default, all companies)
//   node scripts/repairInterruptedInvoiceDeletions.js --apply
//   node scripts/repairInterruptedInvoiceDeletions.js --companyCode=GLR [--apply]
import mongoose from "mongoose";
import dotenv from "dotenv";
import Company from "../models/Company.js";
import TenantInvoice from "../models/TenantInvoice.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import { deleteTenantInvoice } from "../controllers/propertyController/tenantInvoices.js";

dotenv.config();
const getArg = (name, fallback = "") => {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
};
const apply = process.argv.includes("--apply");

const callDeleteTenantInvoice = (invoiceId) =>
  new Promise((resolve) => {
    const req = { params: { id: String(invoiceId) }, user: { isSystemAdmin: true }, body: {} };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ statusCode: this.statusCode, payload }); },
    };
    const next = (err) => resolve({ statusCode: err?.statusCode || err?.status || 500, error: err?.message || String(err) });
    Promise.resolve(deleteTenantInvoice(req, res, next)).catch((err) =>
      resolve({ statusCode: err?.statusCode || err?.status || 500, error: err?.message || String(err) })
    );
  });

async function main() {
  const mongoUrl = process.env.MONGO_URL || process.env.MONGODB_URL;
  if (!mongoUrl) throw new Error("MONGO_URL is required.");
  await mongoose.connect(mongoUrl);

  const companyCode = getArg("companyCode");
  const companyFilter = companyCode ? { companyCode } : {};
  const companies = await Company.find(companyFilter).select("companyCode companyName").lean();
  if (companyCode && !companies.length) throw new Error(`Company ${companyCode} not found.`);

  let totalRepaired = 0, totalCompleted = 0, totalFailed = 0;

  for (const company of companies) {
    // The real signal that a deletion was attempted is a REVERSAL entry existing with reversalOf
    // pointing at one of the invoice's own legs — NOT just "leg is approved and unreversed", which
    // is also true of every normal, never-touched invoice and would false-positive on the entire
    // active ledger.
    const attemptedReversals = await FinancialLedgerEntry.find({
      business: company._id, category: "REVERSAL", sourceTransactionType: "invoice", reversalOf: { $ne: null },
    }).select("reversalOf status").lean();
    if (!attemptedReversals.length) continue;

    const attemptedLegIds = new Set(attemptedReversals.map((r) => String(r.reversalOf)));

    const candidates = await TenantInvoice.find({
      business: company._id,
      status: { $in: ["pending", "paid", "partially_paid"] },
      ledgerEntries: { $elemMatch: { $in: [...attemptedLegIds].map((id) => new mongoose.Types.ObjectId(id)) } },
    }).select("_id invoiceNumber status ledgerEntries").lean();

    if (!candidates.length) continue;

    const allLedgerEntryIds = candidates.flatMap((inv) => (inv.ledgerEntries || []).map(String));
    const originals = await FinancialLedgerEntry.find({ _id: { $in: allLedgerEntryIds } })
      .select("_id status reversedByEntry").lean();
    const originalMap = new Map(originals.map((o) => [String(o._id), o]));

    const affected = [];
    for (const inv of candidates) {
      const partiallyReversedLegIds = (inv.ledgerEntries || [])
        .map(String)
        .filter((id) => {
          if (!attemptedLegIds.has(id)) return false; // no reversal was ever attempted on this leg
          const o = originalMap.get(id);
          return o && o.status === "approved" && !o.reversedByEntry;
        });
      if (partiallyReversedLegIds.length) affected.push({ inv, partiallyReversedLegIds });
    }

    if (!affected.length) continue;
    console.log(`\n=== ${company.companyName} (${company.companyCode}) — ${affected.length} interrupted invoice deletion(s) ===`);

    for (const { inv, partiallyReversedLegIds } of affected) {
      for (const legId of partiallyReversedLegIds) {
        const reversals = await FinancialLedgerEntry.find({
          reversalOf: legId, category: "REVERSAL", status: "approved",
        }).select("_id").lean();

        if (reversals.length !== 1) {
          console.log(`  ${company.companyCode} ${inv.invoiceNumber}: leg ${legId} has ${reversals.length} surviving reversal(s) — expected exactly 1 (run fixDuplicateReversalEntries.js first if >1). SKIPPED.`);
          continue;
        }

        console.log(`  ${company.companyCode} ${inv.invoiceNumber}: ${apply ? "linking" : "would link"} leg ${legId} -> reversal ${reversals[0]._id}`);
        totalRepaired++;
        if (!apply) continue;

        await FinancialLedgerEntry.collection.updateOne(
          { _id: new mongoose.Types.ObjectId(legId), status: "approved" },
          { $set: { status: "reversed", reversedByEntry: reversals[0]._id } }
        );
      }

      if (!apply) {
        console.log(`    would then re-run deleteTenantInvoice(${inv.invoiceNumber}) to finish the job`);
        continue;
      }

      const result = await callDeleteTenantInvoice(inv._id);
      if (result.statusCode >= 200 && result.statusCode < 300) {
        console.log(`    completed deletion of ${inv.invoiceNumber} (${result.payload?.auditStatus})`);
        totalCompleted++;
      } else {
        console.log(`    FAILED completing ${inv.invoiceNumber}: ${result.error}`);
        totalFailed++;
      }
    }
  }

  console.log(
    `\nTOTAL: ${totalRepaired} orphaned link(s) ${apply ? "repaired" : "would be repaired"}, ` +
    `${totalCompleted} invoice deletion(s) completed` + (totalFailed ? `, ${totalFailed} failed (needs manual review)` : "")
  );
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err?.stack || err);
  process.exit(1);
});
