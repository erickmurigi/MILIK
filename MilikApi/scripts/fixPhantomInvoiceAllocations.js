// Corrects the historical data damage from two bugs fixed this session:
//   1. autoApplyPrepayments saved the receipt (allocation marked "applied") before attempting the
//      GL release, which was non-fatal on failure — a failed/skipped release left the document
//      claiming money was applied while the GL never moved.
//   2. deleteTenantInvoice's hard-delete path never checked for RentPayment allocations referencing
//      the invoice being deleted, so hard-deleting an invoice a receipt had already allocated
//      against left that receipt pointing at a phantom (now-nonexistent) invoice.
// Both leave the exact same fingerprint: a RentPayment.allocations row whose `invoice` id doesn't
// exist in TenantInvoice. For each such row, this script verifies (via a metadata.allocations check
// on any "tenant_advance_release" GL leg for the receipt) that NO GL release ever actually fired for
// that specific phantom invoice — i.e. the correction is document-only, the GL's 2130 liability was
// never touched for this money. A row where a release DID fire needs a different, GL-reversing fix
// and is intentionally left untouched here (logged as SKIPPED) for separate handling.
//
// The fix: move the phantom row's appliedAmount back into a plain held/unapplied allocation row
// (isPrepayment: true, billItemKey guessed from the original row's category — same convention
// createPayment itself already uses for genuine unapplied excess), so the money shows up correctly
// as unapplied and can be manually reallocated or auto-consumed by a future matching invoice. Never
// edits/deletes anything else — only this receipt's own allocations/allocationSummary.
//
// Naturally idempotent: once a phantom row's `invoice` field is cleared, the query that finds
// candidates (`allocations.invoice` pointing at a nonexistent TenantInvoice) can never match it again.
//
// Usage:
//   node scripts/fixPhantomInvoiceAllocations.js --companyCode=GLR            (dry run, default)
//   node scripts/fixPhantomInvoiceAllocations.js --companyCode=GLR --apply   (persists the fix)
import mongoose from "mongoose";
import dotenv from "dotenv";
import Company from "../models/Company.js";
import RentPayment from "../models/RentPayment.js";
import TenantInvoice from "../models/TenantInvoice.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";

dotenv.config();
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

const getArg = (name, fallback = "") => {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
};
const apply = process.argv.includes("--apply");

const CATEGORY_TO_SUMMARY = {
  RENT_CHARGE: "rent",
  DEPOSIT_CHARGE: "deposit",
  UTILITY_CHARGE: "utility",
  LATE_PENALTY: "latePenalty",
  DEBIT_NOTE: "debitNote",
};

const guessBillItemKey = (row) => {
  const category = String(row.category || "").toUpperCase();
  if (category === "DEPOSIT_CHARGE") return "deposit";
  if (category === "UTILITY_CHARGE") return `utility:${row.utilityType || ""}`;
  return "rent"; // same fallback createPayment itself uses for unclassified excess
};

const rebuildAllocationSummary = (allocations) => {
  const summary = { rent: 0, deposit: 0, utility: 0, latePenalty: 0, debitNote: 0, debitNoteLabels: [], other: 0, unapplied: 0 };
  for (const a of allocations) {
    const key = !a.invoice
      ? "unapplied"
      : CATEGORY_TO_SUMMARY[String(a.category || "").toUpperCase()] || "other";
    summary[key] = round2((summary[key] || 0) + Number(a.appliedAmount || 0));
    if (key === "debitNote") {
      const label = String(a?.description || "").trim();
      if (label && !summary.debitNoteLabels.includes(label)) summary.debitNoteLabels.push(label);
    }
  }
  return summary;
};

async function main() {
  const mongoUrl = process.env.MONGO_URL || process.env.MONGODB_URL;
  if (!mongoUrl) throw new Error("MONGO_URL is required.");
  await mongoose.connect(mongoUrl);

  const companyCode = getArg("companyCode");
  if (!companyCode) throw new Error("--companyCode is required.");
  const company = await Company.findOne({ companyCode }).lean();
  if (!company) throw new Error(`Company ${companyCode} not found.`);
  console.log(`\n=== ${company.companyName} (${company.companyCode}) — ${apply ? "APPLYING" : "DRY RUN"} ===`);

  const receipts = await RentPayment.find({
    business: company._id,
    isCancelled: { $ne: true },
    isReversed: { $ne: true },
    "allocations.invoice": { $ne: null },
  });

  const invoiceIds = new Set();
  receipts.forEach((r) => r.allocations.forEach((a) => { if (a.invoice) invoiceIds.add(String(a.invoice)); }));
  const existingInvoiceIds = new Set(
    (await TenantInvoice.find({ _id: { $in: [...invoiceIds] } }).select("_id").lean()).map((d) => String(d._id))
  );

  let fixedCount = 0, fixedTotal = 0, skippedCount = 0, skippedTotal = 0;

  for (const receipt of receipts) {
    const phantomRows = receipt.allocations.filter((a) => a.invoice && !existingInvoiceIds.has(String(a.invoice)));
    if (!phantomRows.length) continue;

    const releaseDebitLegs = await FinancialLedgerEntry.find({
      business: company._id, sourceTransactionType: "rent_payment", sourceTransactionId: String(receipt._id),
      "metadata.postingRole": "tenant_advance_release", status: { $in: ["approved", "reversed"] },
    }).select("metadata.allocations").lean();

    let changed = false;
    for (const row of phantomRows) {
      const hasGlRelease = releaseDebitLegs.some((leg) =>
        Array.isArray(leg.metadata?.allocations) &&
        leg.metadata.allocations.some((ar) => String(ar.invoice) === String(row.invoice))
      );
      if (hasGlRelease) {
        console.log(`  SKIPPED (needs GL reversal, not document-only): ${receipt.receiptNumber} invoice=${row.invoice} amount=${row.appliedAmount}`);
        skippedCount++;
        skippedTotal += Number(row.appliedAmount || 0);
        continue;
      }

      const amount = round2(Number(row.appliedAmount || 0));
      console.log(`  ${receipt.receiptNumber}: restoring KES ${amount.toLocaleString()} (was applied to deleted invoice ${row.invoiceNumber || row.invoice}) to unapplied`);
      fixedCount++;
      fixedTotal += amount;

      if (!apply) continue;

      const idx = receipt.allocations.findIndex((a) => a._id && String(a._id) === String(row._id));
      if (idx !== -1) receipt.allocations.splice(idx, 1);
      receipt.allocations.push({
        invoice: null,
        invoiceNumber: "",
        category: row.category || "RENT_CHARGE",
        priorityGroup: row.priorityGroup || "rent",
        utilityType: row.utilityType || "",
        billItemKey: guessBillItemKey(row),
        prepaymentLabel: "Restored — originally applied to a deleted invoice",
        isPrepayment: true,
        appliedAmount: amount,
        beforeOutstanding: 0,
        afterOutstanding: 0,
        description: `Restored to unapplied — originally applied to invoice ${row.invoiceNumber || row.invoice}, which no longer exists`,
        metadata: {
          restoredFromDeletedInvoice: true,
          originalInvoiceId: String(row.invoice),
          originalInvoiceNumber: row.invoiceNumber || "",
          correctedAt: new Date(),
        },
      });
      changed = true;
    }

    if (changed && apply) {
      receipt.allocationSummary = rebuildAllocationSummary(receipt.allocations);
      receipt.markModified("allocations");
      receipt.markModified("allocationSummary");
      await receipt.save();
    }
  }

  console.log(
    `\n  TOTAL ${apply ? "restored" : "would restore"}: KES ${round2(fixedTotal).toLocaleString()} across ${fixedCount} row(s)` +
    (skippedCount ? `; SKIPPED (needs GL reversal): KES ${round2(skippedTotal).toLocaleString()} across ${skippedCount} row(s)` : "")
  );
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err?.stack || err);
  process.exit(1);
});
