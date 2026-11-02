// Precisely checks, per phantom allocation row (not per receipt), whether the specific phantom
// invoice was ever actually released in the GL — i.e. whether a "tenant_advance_release" debit leg
// on 2130 carries metadata.allocations containing a row whose invoice === this phantom invoice id.
// A receipt can have unrelated, legitimate releases for its OTHER (real-invoice) rows — counting
// "any release entry exists on this receipt" (as the earlier broad scope-check did) overstates which
// rows actually need a GL reversal vs. a document-only fix. This disambiguates GLR precisely.
import mongoose from "mongoose";
import dotenv from "dotenv";
import Company from "../models/Company.js";
import RentPayment from "../models/RentPayment.js";
import TenantInvoice from "../models/TenantInvoice.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";

dotenv.config();

async function main() {
  await mongoose.connect(process.env.MONGO_URL || process.env.MONGODB_URL);
  const company = await Company.findOne({ companyCode: "GLR" }).lean();

  const receipts = await RentPayment.find({
    business: company._id,
    isCancelled: { $ne: true },
    isReversed: { $ne: true },
    "allocations.invoice": { $ne: null },
  }).select("receiptNumber allocations").lean();

  const invoiceIds = new Set();
  receipts.forEach((r) => r.allocations.forEach((a) => { if (a.invoice) invoiceIds.add(String(a.invoice)); }));
  const existingInvoiceIds = new Set(
    (await TenantInvoice.find({ _id: { $in: [...invoiceIds] } }).select("_id").lean()).map((d) => String(d._id))
  );

  let documentOnlyCount = 0, documentOnlyTotal = 0;
  let needsGlReversalCount = 0, needsGlReversalTotal = 0;

  for (const r of receipts) {
    const phantomRows = r.allocations.filter((a) => a.invoice && !existingInvoiceIds.has(String(a.invoice)));
    if (!phantomRows.length) continue;

    const releaseDebitLegs = await FinancialLedgerEntry.find({
      business: company._id, sourceTransactionType: "rent_payment", sourceTransactionId: String(r._id),
      "metadata.postingRole": "tenant_advance_release", status: { $in: ["approved", "reversed"] },
    }).select("journalGroupId metadata.allocations debit amount status reversedByEntry").lean();

    for (const row of phantomRows) {
      const matchingLeg = releaseDebitLegs.find((leg) =>
        Array.isArray(leg.metadata?.allocations) &&
        leg.metadata.allocations.some((ar) => String(ar.invoice) === String(row.invoice))
      );
      if (matchingLeg) {
        needsGlReversalCount++;
        needsGlReversalTotal += Number(row.appliedAmount || 0);
        console.log(
          `  NEEDS GL REVERSAL: ${r.receiptNumber} invoice=${row.invoice} amount=${row.appliedAmount} ` +
          `journalGroup=${matchingLeg.journalGroupId} legStatus=${matchingLeg.status} alreadyReversed=${!!matchingLeg.reversedByEntry}`
        );
      } else {
        documentOnlyCount++;
        documentOnlyTotal += Number(row.appliedAmount || 0);
        console.log(`  DOCUMENT-ONLY: ${r.receiptNumber} invoice=${row.invoice} amount=${row.appliedAmount}`);
      }
    }
  }

  console.log(`\nDocument-only fixes: ${documentOnlyCount} row(s), KES ${documentOnlyTotal.toLocaleString()}`);
  console.log(`Needs GL reversal: ${needsGlReversalCount} row(s), KES ${needsGlReversalTotal.toLocaleString()}`);
  await mongoose.disconnect();
  process.exit(0);
}
main().catch((err) => { console.error(err); process.exit(1); });
