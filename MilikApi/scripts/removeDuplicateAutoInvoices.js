// Removes duplicate recurring invoices created by the double-booking bug: the server-side periodKey
// computation (used whenever a caller — cron, or a manual booking without the UI's own period
// context — doesn't already send one) anchored on the lease's raw startDate instead of walking the
// schedule forward to the actually-invoiced month. That's only correct for a lease's first billing
// month; every month after that, two different code paths could compute two different periodKey
// strings for the SAME tenant/unit/calendar month, silently defeating the duplicate-invoice guard
// that's supposed to compare them. Fixed in services/billingPeriodService.js
// (resolveOccurrencePeriodStart) + controllers/propertyController/tenantInvoices.js +
// services/autoRentInvoicingService.js.
//
// Grouping by idempotencyKey (the first version of this script) MISSED real duplicates for exactly
// this reason — two invoices for the same tenant/unit/month can carry different idempotencyKey
// strings. This version groups by the actual business meaning instead: {tenant, unit, category,
// utilityType, calendar month of invoiceDate}, restricted to RENT_CHARGE/UTILITY_CHARGE only
// (DEPOSIT_CHARGE is deliberately excluded — deposits are legitimately invoiced in multiple
// installments with DIFFERENT amounts in the same month, which looks like a "duplicate" by this
// grouping but isn't). Within a group, only acts when every invoice's amount matches exactly — a
// mismatched amount means something else is going on (a correction, a rent change mid-period) and
// is left for manual review rather than guessed at.
//
// For every true-duplicate group, this keeps the EARLIEST (by createdAt — the legitimate original
// booking) and removes every later duplicate by calling the real deleteTenantInvoice controller
// directly (not a raw deleteOne) — so the exact same safety machinery used everywhere else applies:
// GL entries are properly reversed (not silently discarded), and deletion is automatically BLOCKED
// if a receipt has since allocated against the duplicate. A blocked duplicate is logged and left for
// manual review rather than forced through.
//
// Usage:
//   node scripts/removeDuplicateAutoInvoices.js                 (dry run, default, all companies)
//   node scripts/removeDuplicateAutoInvoices.js --apply         (removes the duplicates)
//   node scripts/removeDuplicateAutoInvoices.js --companyCode=GLR [--apply]
//   node scripts/removeDuplicateAutoInvoices.js --month=2026-11 [--apply]   (scope to one calendar month)
import mongoose from "mongoose";
import dotenv from "dotenv";
import Company from "../models/Company.js";
import TenantInvoice from "../models/TenantInvoice.js";
import { deleteTenantInvoice } from "../controllers/propertyController/tenantInvoices.js";

dotenv.config();
const getArg = (name, fallback = "") => {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
};
const apply = process.argv.includes("--apply");
const monthFilter = getArg("month"); // e.g. "2026-11"

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

  let totalRemoved = 0, totalBlocked = 0, totalKept = 0, totalNeedsReview = 0;

  for (const company of companies) {
    const groups = await TenantInvoice.aggregate([
      {
        $match: {
          business: company._id,
          status: { $nin: ["cancelled", "reversed"] },
          category: { $in: ["RENT_CHARGE", "UTILITY_CHARGE"] },
        },
      },
      {
        $project: {
          tenant: 1, unit: 1, category: 1, invoiceNumber: 1, amount: 1, createdAt: 1,
          utilityType: { $ifNull: ["$metadata.utilityType", ""] },
          // timezone is required — this system stores "day 1 local midnight" as 21:00 UTC the
          // PREVIOUS day (Africa/Nairobi, UTC+3), so grouping in plain UTC bucketed a real October
          // invoice and a real November invoice into the same "2026-10" group whenever one of them
          // happened to land on that day-1 boundary — a false "duplicate" that was really just two
          // different months' legitimate charges. Confirmed live: INV00959 (Oct, invoiceDate exactly
          // UTC midnight) vs INV02347 (Nov, invoiceDate 2026-10-31T21:00Z = Nov 1 00:00 EAT) were
          // flagged as a mismatched-amount "duplicate" pair by this bug, not because of any real
          // ambiguity in the data.
          yearMonth: { $dateToString: { format: "%Y-%m", date: "$invoiceDate", timezone: "Africa/Nairobi" } },
        },
      },
      ...(monthFilter ? [{ $match: { yearMonth: monthFilter } }] : []),
      {
        $group: {
          _id: { tenant: "$tenant", unit: "$unit", category: "$category", utilityType: "$utilityType", yearMonth: "$yearMonth" },
          count: { $sum: 1 },
          amounts: { $addToSet: "$amount" },
          docs: { $push: { id: "$_id", invoiceNumber: "$invoiceNumber", createdAt: "$createdAt", amount: "$amount" } },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ]);

    if (!groups.length) continue;

    const safeGroups = groups.filter((g) => g.amounts.length === 1);
    const reviewGroups = groups.filter((g) => g.amounts.length > 1);
    totalNeedsReview += reviewGroups.length;

    console.log(`\n=== ${company.companyName} (${company.companyCode}) — ${safeGroups.length} duplicate group(s), ${reviewGroups.length} needs manual review ===`);

    for (const g of reviewGroups) {
      console.log(`  NEEDS MANUAL REVIEW (amounts differ) tenant=${g._id.tenant} unit=${g._id.unit} ${g._id.category} ${g._id.utilityType || ""} ${g._id.yearMonth}:`);
      for (const d of g.docs) console.log(`    ${d.invoiceNumber} amount=${d.amount} createdAt=${new Date(d.createdAt).toISOString()}`);
    }

    for (const group of safeGroups) {
      const sorted = [...group.docs].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      const [keep, ...duplicates] = sorted;
      console.log(`  tenant=${group._id.tenant} unit=${group._id.unit} ${group._id.category} ${group._id.utilityType || ""} ${group._id.yearMonth}: keeping ${keep.invoiceNumber} (created ${new Date(keep.createdAt).toISOString()}, KES ${keep.amount})`);
      totalKept++;

      for (const dup of duplicates) {
        if (!apply) {
          console.log(`    would remove ${dup.invoiceNumber} (created ${new Date(dup.createdAt).toISOString()}, KES ${dup.amount})`);
          totalRemoved++;
          continue;
        }
        const result = await callDeleteTenantInvoice(dup.id);
        if (result.statusCode >= 200 && result.statusCode < 300) {
          console.log(`    removed ${dup.invoiceNumber} (${result.payload?.auditStatus})`);
          totalRemoved++;
        } else {
          console.log(`    BLOCKED removing ${dup.invoiceNumber}: ${result.error} — left in place for manual review.`);
          totalBlocked++;
        }
      }
    }
  }

  console.log(
    `\nTOTAL: ${totalKept} group(s) resolved, ${totalRemoved} duplicate(s) ${apply ? "removed" : "would be removed"}` +
    (totalBlocked ? `, ${totalBlocked} blocked (needs manual review)` : "") +
    (totalNeedsReview ? `, ${totalNeedsReview} group(s) skipped — amounts didn't match, needs manual review` : "")
  );
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err?.stack || err);
  process.exit(1);
});
