// Backfills the missing memo debit leg on every pre-fix "paid direct to landlord" rent/utility
// receipt journal group — see confirmNonCashDirectToLandlordReceipt in
// controllers/propertyController/rentPayment.js for the code fix and the full accounting
// reasoning. Before that fix, a genuine non-cash direct-to-landlord receipt posted only a credit
// (correctly clearing the tenant's receivable) with NO debit leg at all — a real double-entry
// violation. Found live on GLR: 37 such groups, KES 314,000, all posted the same morning.
//
// This finds every journalGroupId whose entries are all sourceTransactionType "rent_payment",
// debitSum=0, creditSum>0, with at least one entry carrying metadata.paidDirectToLandlord=true —
// the exact, narrow signature of this bug (scoped deliberately so this never touches an unrelated
// imbalance from a different cause). For each one, it posts a single debit of the full shortfall
// to the new 2199 "Direct-to-Landlord Receipts (Memo)" account, dated to match the original
// receipt's own transaction/period dates (this is filling a gap in an existing transaction, not
// creating a new one), and appends the new entry to that RentPayment's own ledgerEntries array.
//
// Never touches the existing credit leg(s) — only adds the missing debit.
//
// Usage:
//   node scripts/fixDirectToLandlordMemoBacklog.js                 (dry run, default, all companies)
//   node scripts/fixDirectToLandlordMemoBacklog.js --apply
//   node scripts/fixDirectToLandlordMemoBacklog.js --companyCode=GLR [--apply]
import mongoose from "mongoose";
import dotenv from "dotenv";
import Company from "../models/Company.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import RentPayment from "../models/RentPayment.js";
import { postEntry } from "../services/ledgerPostingService.js";
import { resolveDirectToLandlordReceiptsMemoAccount } from "../services/propertyAccountingService.js";
import { ensureSystemAuditUser } from "../utils/systemActor.js";

dotenv.config();
const getArg = (name, fallback = "") => {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
};
const apply = process.argv.includes("--apply");

const debitExpr = { $cond: [{ $gt: [{ $ifNull: ["$debit", -1] }, -1] }, "$debit", { $cond: [{ $eq: ["$direction", "debit"] }, "$amount", 0] }] };
const creditExpr = { $cond: [{ $gt: [{ $ifNull: ["$credit", -1] }, -1] }, "$credit", { $cond: [{ $eq: ["$direction", "credit"] }, "$amount", 0] }] };

async function main() {
  const mongoUrl = process.env.MONGO_URL || process.env.MONGODB_URL;
  if (!mongoUrl) throw new Error("MONGO_URL is required.");
  await mongoose.connect(mongoUrl);

  const companyCode = getArg("companyCode");
  const companyFilter = companyCode ? { companyCode } : {};
  const companies = await Company.find(companyFilter).select("companyCode companyName").lean();
  if (companyCode && !companies.length) throw new Error(`Company ${companyCode} not found.`);

  let totalFixed = 0;
  let totalAmount = 0;

  for (const company of companies) {
    const groups = await FinancialLedgerEntry.aggregate([
      { $match: { business: company._id, status: "approved", sourceTransactionType: "rent_payment", journalGroupId: { $ne: null } } },
      {
        $group: {
          _id: "$journalGroupId",
          debitSum: { $sum: debitExpr },
          creditSum: { $sum: creditExpr },
          anyDirectToLandlord: { $max: { $cond: [{ $eq: ["$metadata.paidDirectToLandlord", true] }, 1, 0] } },
          sourceId: { $first: "$sourceTransactionId" },
          sample: { $first: "$$ROOT" },
        },
      },
      { $match: { debitSum: 0, creditSum: { $gt: 0 }, anyDirectToLandlord: 1 } },
    ]);

    if (!groups.length) continue;

    console.log(`\n=== ${company.companyName} (${company.companyCode}) — ${groups.length} one-sided direct-to-landlord group(s) ===`);

    let memoAccount = null;
    let actorId = null;

    for (const group of groups) {
      const shortfall = Math.round(group.creditSum * 100) / 100;
      console.log(
        `  ${company.companyCode} journalGroupId=${group._id} ${apply ? "backfilling" : "would backfill"} debit of ${shortfall} ` +
          `(rent_payment ${group.sourceId})`
      );
      totalFixed++;
      totalAmount += shortfall;

      if (!apply) continue;

      memoAccount = memoAccount || (await resolveDirectToLandlordReceiptsMemoAccount(company._id));
      if (!actorId) actorId = (await ensureSystemAuditUser(company._id))._id;

      const sample = group.sample;
      const newEntry = await postEntry({
        business: company._id,
        property: sample.property || null,
        landlord: sample.landlord || null,
        tenant: sample.tenant || null,
        unit: sample.unit || null,
        sourceTransactionType: "rent_payment",
        sourceTransactionId: group.sourceId,
        transactionDate: sample.transactionDate,
        statementPeriodStart: sample.statementPeriodStart,
        statementPeriodEnd: sample.statementPeriodEnd,
        category: "ADJUSTMENT",
        amount: shortfall,
        direction: "debit",
        debit: shortfall,
        credit: 0,
        accountId: memoAccount._id,
        journalGroupId: group._id,
        payer: "tenant",
        receiver: "landlord",
        notes: "Backfill — missing memo debit for a direct-to-landlord receipt posted before the fix (see confirmNonCashDirectToLandlordReceipt).",
        metadata: {
          includeInLandlordStatement: false,
          includeInCategoryTotals: false,
          postingRole: "direct_to_landlord_memo_backfill",
          backfill: true,
        },
        createdBy: actorId,
        approvedBy: actorId,
        approvedAt: new Date(),
        status: "approved",
      });

      await RentPayment.updateOne({ _id: group.sourceId }, { $addToSet: { ledgerEntries: newEntry._id } });
    }
  }

  console.log(
    `\nTOTAL: ${totalFixed} group(s) ${apply ? "backfilled" : "would be backfilled"} (KES ${totalAmount.toLocaleString()})`
  );
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err?.stack || err);
  process.exit(1);
});
