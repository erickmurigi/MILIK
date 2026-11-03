// Restores 4 specific invoices that were wrongly deleted during today's duplicate-invoice cleanup,
// due to a timezone bucketing bug in the cleanup scripts themselves (removeDuplicateAutoInvoices.js /
// reallocateAndRemoveDuplicateInvoices.js grouped invoices by calendar month using MongoDB's
// $dateToString with no timezone — which defaults to UTC. This system stores "day 1 local midnight"
// (Africa/Nairobi, UTC+3) as 21:00 UTC the PREVIOUS day, so an invoice legitimately dated for one
// month could get bucketed into the previous month's UTC-day, wrongly merging two genuinely
// different months into one "duplicate" group).
//
// Two distinct failure patterns, confirmed by direct inspection — see the forensic check this was
// found with:
//
//   1. GLR INV01729 (unit C4) and INV01805 (unit KC1) — both GENUINE duplicate pairs/triplicates for
//      November 2026 (confirmed: their "duplicate" siblings — INV02103 and INV01844/INV02134 — really
//      were the same tenant/unit/period/amount). But instead of keeping exactly one and removing the
//      rest, ALL copies ended up deleted, leaving these two tenants with ZERO November rent invoice.
//      Restoring the EARLIEST (cron-generated) copy of each — the same "keep" convention used
//      throughout this whole cleanup — fixes the gap without recreating duplicates.
//
//   2. IPL INV00195 (unit 2, tenant's actual September rent) and INV00262 (unit 18, tenant's actual
//      September rent) were NOT duplicates of anything — they were wrongly grouped with a different
//      month's invoice entirely (INV00195 with August's INV00100; INV00262 with an unrelated
//      "Opening rent balance" take-on entry) purely because of the UTC bucketing bug, then deleted as
//      if redundant. Each tenant now has a real gap: no September rent invoice at all. Restoring the
//      one invoice that was wrongly removed fixes it — there is no duplicate to choose between here.
//
// Restoration mechanics, per invoice: deleteTenantInvoice's deletion is a soft reversal (invoice
// status -> "reversed", its 2 original GL legs reversed via postReversal). To undo it correctly:
//   - Void the REVERSAL entries that were posted against it (status: "void" — removes them from
//     every balance calculation, the same retraction pattern already used elsewhere in this codebase,
//     e.g. deletePayment's GL-chain purge).
//   - Restore the 2 original legs to status "approved", reversedByEntry: null.
//   - Restore the invoice document to status "pending", postingStatus "posted" (verified via a direct
//     check: none of these 4 ever had a receipt allocated or any payment recorded — outstanding ==
//     amount in every case — so "pending" is unambiguously the correct restored status).
//   - Preserve the original deletion as audit history (renamed to metadata.priorDeletion) rather than
//     silently erasing it, and record why it was restored.
//   - Recompute tenant financial state and account balances.
//
// This script is intentionally hardcoded to these 4 invoice numbers — it is a one-off correction for
// a specific, already-proven mistake, not a general-purpose "undelete" tool.
//
// Usage:
//   node scripts/restoreWronglyDeletedInvoices.js          (dry run, default)
//   node scripts/restoreWronglyDeletedInvoices.js --apply
import mongoose from "mongoose";
import dotenv from "dotenv";
import Company from "../models/Company.js";
import TenantInvoice from "../models/TenantInvoice.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import { recomputeTenantFinancialState } from "../controllers/propertyController/tenantInvoices.js";
import { aggregateChartOfAccountBalances } from "../services/chartAccountAggregationService.js";
import { applyIncrementalBalanceDelta } from "../controllers/propertyController/tenantInvoices.js";

dotenv.config();
const apply = process.argv.includes("--apply");

const TARGETS = [
  { companyCode: "GLR", invoiceNumber: "INV01729", reason: "Only surviving copy of a genuine November 2026 duplicate pair (with INV02103) was removed entirely — restoring the earliest (cron-generated) copy to close the resulting billing gap." },
  { companyCode: "GLR", invoiceNumber: "INV01805", reason: "Only surviving copy of a genuine November 2026 duplicate triplicate (with INV01844, INV02134) was removed entirely — restoring the earliest (cron-generated) copy to close the resulting billing gap." },
  { companyCode: "IPL", invoiceNumber: "INV00195", reason: "Wrongly grouped with August's INV00100 by a UTC-vs-local timezone bug in the cleanup script's month bucketing — this was the tenant's only September 2026 rent invoice, not a duplicate of anything. Restoring it." },
  { companyCode: "IPL", invoiceNumber: "INV00262", reason: "Wrongly grouped with an unrelated 'Opening rent balance' take-on entry by the same UTC bucketing bug — this was the tenant's only September 2026 rent invoice, not a duplicate of anything. Restoring it." },
];

async function main() {
  const mongoUrl = process.env.MONGO_URL || process.env.MONGODB_URL;
  if (!mongoUrl) throw new Error("MONGO_URL is required.");
  await mongoose.connect(mongoUrl);

  for (const target of TARGETS) {
    const company = await Company.findOne({ companyCode: target.companyCode }).lean();
    if (!company) throw new Error(`Company ${target.companyCode} not found.`);

    const invoice = await TenantInvoice.findOne({ business: company._id, invoiceNumber: target.invoiceNumber });
    if (!invoice) {
      console.log(`  ${target.companyCode} ${target.invoiceNumber}: NOT FOUND — skipping.`);
      continue;
    }
    if (invoice.status !== "reversed") {
      console.log(`  ${target.companyCode} ${target.invoiceNumber}: status is "${invoice.status}", not "reversed" — already restored or in an unexpected state. Skipping.`);
      continue;
    }

    const legs = await FinancialLedgerEntry.find({ _id: { $in: invoice.ledgerEntries } })
      .select("_id status reversedByEntry accountId debit credit").lean();

    if (legs.length !== 2 || legs.some((l) => l.status !== "reversed" || !l.reversedByEntry)) {
      console.log(`  ${target.companyCode} ${target.invoiceNumber}: GL legs aren't in the expected clean "2 reversed legs, each with exactly one reversal" shape — SKIPPING, needs manual review. legs=${JSON.stringify(legs)}`);
      continue;
    }

    console.log(`  ${target.companyCode} ${target.invoiceNumber}: ${apply ? "restoring" : "would restore"} (amount=${invoice.amount}, 2 GL legs + their 2 reversal entries)`);
    if (!apply) continue;

    const touchedAccountIds = new Set();
    for (const leg of legs) {
      if (leg.accountId) touchedAccountIds.add(String(leg.accountId));

      await FinancialLedgerEntry.collection.updateOne(
        { _id: leg.reversedByEntry, status: "approved" },
        { $set: { status: "void" } }
      );
      await FinancialLedgerEntry.collection.updateOne(
        { _id: leg._id, status: "reversed" },
        { $set: { status: "approved", reversedByEntry: null } }
      );
    }

    invoice.status = "pending";
    invoice.postingStatus = "posted";
    invoice.postingError = null;
    invoice.metadata = {
      ...(invoice.metadata && typeof invoice.metadata === "object" ? invoice.metadata : {}),
      priorDeletion: {
        deletedAt: invoice.metadata?.deletedAt || null,
        deletedBy: invoice.metadata?.deletedBy || null,
      },
      deletedAt: undefined,
      deletedBy: undefined,
      deletionMode: undefined,
      auditPreserved: undefined,
      restoredAt: new Date(),
      restorationReason: target.reason,
    };
    // Mongoose keeps `undefined` keys out of the saved document — this is how the old
    // deletedAt/deletedBy/deletionMode/auditPreserved fields are cleanly removed while keeping
    // everything else (including whatever the invoice already had before today).
    await invoice.save();

    await applyIncrementalBalanceDelta({ tenantId: invoice.tenant, businessId: invoice.business, delta: Math.abs(Number(invoice.amount || 0)) });
    await recomputeTenantFinancialState({ businessId: invoice.business, tenantId: invoice.tenant });
    if (touchedAccountIds.size > 0) {
      await aggregateChartOfAccountBalances(invoice.business, Array.from(touchedAccountIds));
    }

    console.log(`    done.`);
  }

  console.log(`\n${apply ? "Restoration complete." : "Dry run complete — rerun with --apply to perform the restoration."}`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err?.stack || err);
  process.exit(1);
});
