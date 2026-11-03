// Removes the final 2 confirmed duplicate invoices out of the original "6 mismatched-amount groups"
// flagged for manual review. Investigated individually: these 2 are genuine duplicates of an existing
// invoice for the SAME tenant/unit/period, where the manual re-booking copy was typed with a
// different (wrong) amount instead of the lease's actual rent — not a legitimate separate charge.
// The other 4 of the original 6 were confirmed to be real, different-month invoices wrongly grouped
// together by a timezone bug in the detection scripts (see fixDuplicateReversalEntries.js /
// restoreWronglyDeletedInvoices.js history) and need no action.
//
//   GLR: keep INV01676 (16,000, partially paid, matches the lease's actual rent) — remove INV02042
//        (16,500, pending, no receipt allocated — a duplicate November booking with a mistyped amount).
//   IPL: keep INV00463 (16,000, pending, matches the lease's actual rent, cron-generated) — remove
//        INV00547 (8,000, pending, no receipt allocated — a duplicate November booking, likely a
//        half-rent typo).
//
// Removes via the real deleteTenantInvoice controller (not a raw delete) — same GL-reversing, audited
// path as every other removal in this cleanup.
//
// Usage:
//   node scripts/removeLastTwoConfirmedDuplicates.js          (dry run, default)
//   node scripts/removeLastTwoConfirmedDuplicates.js --apply
import mongoose from "mongoose";
import dotenv from "dotenv";
import Company from "../models/Company.js";
import TenantInvoice from "../models/TenantInvoice.js";
import { deleteTenantInvoice } from "../controllers/propertyController/tenantInvoices.js";

dotenv.config();
const apply = process.argv.includes("--apply");

const TARGETS = [
  { companyCode: "GLR", invoiceNumber: "INV02042" },
  { companyCode: "IPL", invoiceNumber: "INV00547" },
];

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

  for (const target of TARGETS) {
    const company = await Company.findOne({ companyCode: target.companyCode }).lean();
    const invoice = await TenantInvoice.findOne({ business: company._id, invoiceNumber: target.invoiceNumber }).select("_id status amount").lean();
    if (!invoice) { console.log(`  ${target.companyCode} ${target.invoiceNumber}: NOT FOUND.`); continue; }
    if (["cancelled", "reversed"].includes(invoice.status)) { console.log(`  ${target.companyCode} ${target.invoiceNumber}: already ${invoice.status}.`); continue; }

    if (!apply) {
      console.log(`  ${target.companyCode} ${target.invoiceNumber}: would remove (amount=${invoice.amount}, status=${invoice.status})`);
      continue;
    }

    const result = await callDeleteTenantInvoice(invoice._id);
    if (result.statusCode >= 200 && result.statusCode < 300) {
      console.log(`  ${target.companyCode} ${target.invoiceNumber}: removed (${result.payload?.auditStatus})`);
    } else {
      console.log(`  ${target.companyCode} ${target.invoiceNumber}: BLOCKED — ${result.error}`);
    }
  }

  console.log(`\n${apply ? "Done." : "Dry run complete — rerun with --apply to remove."}`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err?.stack || err);
  process.exit(1);
});
