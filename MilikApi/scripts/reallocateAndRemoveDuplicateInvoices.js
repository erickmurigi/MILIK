// Handles the 3 duplicate-invoice cases (out of the double-booking incident — see
// removeDuplicateAutoInvoices.js) where a tenant's receipt was allocated against the DUPLICATE copy
// instead of the legitimate original: deleteTenantInvoice's existing receipt-allocation guard would
// correctly refuse to delete these (so nothing is ever at risk of silent data loss), but just leaving
// them blocked means the tenant's balance stays wrong — the real invoice still shows unpaid/
// partially-paid while the receipt sits against a copy that's about to be reversed out of existence.
//
// For each duplicate-with-an-allocation found, this:
//   1. Moves every RentPayment.allocations row pointing at the duplicate invoice onto the KEPT
//      (earliest, legitimate) invoice instead — same amount, re-stamped with the kept invoice's own
//      identity fields (invoiceNumber/category/priorityGroup/utilityType/depositHeldBy/
//      invoiceLedgerMode/invoiceDate/dueDate) so it reads correctly everywhere the allocation is
//      displayed.
//   2. Recomputes the tenant's financial state (recomputeTenantFinancialState) so both invoices'
//      outstanding/status reflect the move immediately.
//   3. Deletes the now-unallocated duplicate via the real deleteTenantInvoice controller (same
//      GL-reversing, audited path every other removal in this incident has used).
// Never edits a RentPayment's amount/cash-received fields — only which invoice(s) its existing
// allocation rows point at.
//
// Usage:
//   node scripts/reallocateAndRemoveDuplicateInvoices.js                 (dry run, default, all companies)
//   node scripts/reallocateAndRemoveDuplicateInvoices.js --apply
//   node scripts/reallocateAndRemoveDuplicateInvoices.js --companyCode=GLR [--apply]
import mongoose from "mongoose";
import dotenv from "dotenv";
import Company from "../models/Company.js";
import TenantInvoice from "../models/TenantInvoice.js";
import RentPayment from "../models/RentPayment.js";
import {
  deleteTenantInvoice,
  recomputeTenantFinancialState,
  getInvoicePriorityGroup,
  getInvoiceUtilityType,
} from "../controllers/propertyController/tenantInvoices.js";

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

const rebuildAllocationSummary = (allocations) => {
  const summary = { rent: 0, deposit: 0, utility: 0, latePenalty: 0, debitNote: 0, debitNoteLabels: [], other: 0, unapplied: 0 };
  for (const a of allocations) {
    const key = !a.invoice ? "unapplied" : CATEGORY_TO_SUMMARY[String(a.category || "").toUpperCase()] || "other";
    summary[key] = round2((summary[key] || 0) + Number(a.appliedAmount || 0));
    if (key === "debitNote") {
      const label = String(a?.description || "").trim();
      if (label && !summary.debitNoteLabels.includes(label)) summary.debitNoteLabels.push(label);
    }
  }
  return summary;
};

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

  let totalReallocated = 0, totalReallocatedAmount = 0, totalRemoved = 0, totalBlocked = 0;

  for (const company of companies) {
    const groups = await TenantInvoice.aggregate([
      { $match: { business: company._id, status: { $nin: ["cancelled", "reversed"] }, category: { $in: ["RENT_CHARGE", "UTILITY_CHARGE"] } } },
      { $project: { tenant: 1, unit: 1, category: 1, invoiceNumber: 1, amount: 1, createdAt: 1,
          utilityType: { $ifNull: ["$metadata.utilityType", ""] },
          // See removeDuplicateAutoInvoices.js for why timezone is required here — plain UTC
          // bucketing wrongly merges a real October invoice with a real November one whenever one
          // lands on the "day 1 local midnight" boundary (stored as 21:00 UTC the previous day).
          yearMonth: { $dateToString: { format: "%Y-%m", date: "$invoiceDate", timezone: "Africa/Nairobi" } } } },
      { $group: { _id: { tenant: "$tenant", unit: "$unit", category: "$category", utilityType: "$utilityType", yearMonth: "$yearMonth" },
          count: { $sum: 1 }, amounts: { $addToSet: "$amount" },
          docs: { $push: { id: "$_id", invoiceNumber: "$invoiceNumber", createdAt: "$createdAt", amount: "$amount" } } } },
      { $match: { count: { $gt: 1 } } },
    ]);

    const safeGroups = groups.filter((g) => g.amounts.length === 1);

    for (const group of safeGroups) {
      const sorted = [...group.docs].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      const [keep, ...duplicates] = sorted;

      for (const dup of duplicates) {
        const receiptsWithAllocation = await RentPayment.find({
          business: company._id,
          "allocations.invoice": dup.id,
          "allocations.appliedAmount": { $gt: 0 },
          isCancelled: { $ne: true },
          isReversed: { $ne: true },
        });
        if (!receiptsWithAllocation.length) continue; // not one of the 3 — handled by removeDuplicateAutoInvoices.js instead

        const keepInvoice = await TenantInvoice.findById(keep.id)
          .select("invoiceNumber category priorityGroup metadata depositHeldBy ledgerMode invoiceDate dueDate")
          .lean();
        if (!keepInvoice) {
          console.log(`  SKIPPED ${company.companyCode} ${dup.invoiceNumber}: kept invoice ${keep.id} not found.`);
          continue;
        }

        for (const receipt of receiptsWithAllocation) {
          const rows = receipt.allocations.filter((a) => a.invoice && String(a.invoice) === String(dup.id));
          for (const row of rows) {
            const amount = round2(Number(row.appliedAmount || 0));
            console.log(
              `  ${company.companyCode} ${receipt.receiptNumber}: ${apply ? "moving" : "would move"} KES ${amount.toLocaleString()} ` +
              `from duplicate ${dup.invoiceNumber} -> kept ${keepInvoice.invoiceNumber}`
            );
            totalReallocated++;
            totalReallocatedAmount += amount;

            if (!apply) continue;

            row.invoice = keepInvoice._id;
            row.invoiceNumber = keepInvoice.invoiceNumber || "";
            row.category = keepInvoice.category || row.category;
            row.priorityGroup = getInvoicePriorityGroup(keepInvoice) || row.priorityGroup;
            row.utilityType = getInvoiceUtilityType(keepInvoice) || row.utilityType;
            row.depositHeldBy = keepInvoice.depositHeldBy || row.depositHeldBy;
            row.invoiceLedgerMode = keepInvoice.ledgerMode || row.invoiceLedgerMode;
            row.invoiceDate = keepInvoice.invoiceDate || row.invoiceDate;
            row.dueDate = keepInvoice.dueDate || row.dueDate;
            row.description = `${row.description || ""} (reallocated from duplicate invoice ${dup.invoiceNumber} — double-booking correction)`.trim();
          }

          if (apply) {
            receipt.allocationSummary = rebuildAllocationSummary(receipt.allocations);
            receipt.markModified("allocations");
            receipt.markModified("allocationSummary");
            await receipt.save();
          }
        }

        if (apply) {
          await recomputeTenantFinancialState({ businessId: company._id, tenantId: group._id.tenant });
          const result = await callDeleteTenantInvoice(dup.id);
          if (result.statusCode >= 200 && result.statusCode < 300) {
            console.log(`    removed ${dup.invoiceNumber} (${result.payload?.auditStatus})`);
            totalRemoved++;
          } else {
            console.log(`    BLOCKED removing ${dup.invoiceNumber}: ${result.error} — left in place for manual review.`);
            totalBlocked++;
          }
        } else {
          console.log(`    would then remove duplicate ${dup.invoiceNumber}`);
        }
      }
    }
  }

  console.log(
    `\nTOTAL: ${totalReallocated} allocation row(s) ${apply ? "reallocated" : "would be reallocated"} ` +
    `(KES ${round2(totalReallocatedAmount).toLocaleString()}), ${totalRemoved} duplicate(s) removed` +
    (totalBlocked ? `, ${totalBlocked} blocked` : "")
  );
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err?.stack || err);
  process.exit(1);
});
