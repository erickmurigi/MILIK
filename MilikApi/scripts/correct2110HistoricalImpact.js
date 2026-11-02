// Posts a correcting journal for the real historical impact of the two 2110 (Landlord Remittance
// Payable) bugs fixed this session — never edits/deletes the original wrong entries, preserving the
// full audit trail; posts a new, clearly-labelled correction dated today.
//
// Correction logic, derived and verified during the investigation:
//   1. "Direct-to-landlord settlement" bug (rentPayment.js): a direct rent/utility receipt debited
//      2110 by the full amount even though the credit side went to Property Control, not 2110. The
//      excess debit is exactly: landlord_settlement debits − (deposit_landlord + tenant-advance-release
//      credits), scoped PER PROPERTY.
//   2. "Advance double-count" bug (processedStatements.js): an advance recovery/payout's own direct
//      2110 debit was ALSO subtracted a second time from the next statement's credit, understating 2110
//      by the same amount a second time — scoped PER PROPERTY via the advancement's own property field.
// Both root causes converge on the same correction shape: 2110 was under-credited, and Property
// Control (the account the ORIGINAL statement-processing posting paired with 2110) was correspondingly
// under-debited by the same amount in lockstep — so the correction is Cr 2110 / Dr that property's own
// Property Control account, dated today, clearly tagged as a correction.
//
// Usage:
//   node scripts/correct2110HistoricalImpact.js --companyCode=GLR            (dry run, default)
//   node scripts/correct2110HistoricalImpact.js --companyCode=GLR --apply    (posts the correction)
import mongoose from "mongoose";
import dotenv from "dotenv";
import Company from "../models/Company.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import { postEntry } from "../services/ledgerPostingService.js";
import { ensurePropertyControlAccount } from "../services/propertyAccountingService.js";
import { aggregateChartOfAccountBalances } from "../services/chartAccountAggregationService.js";

dotenv.config();
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

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
  if (!companyCode) throw new Error("--companyCode is required.");
  const company = await Company.findOne({ companyCode }).lean();
  if (!company) throw new Error(`Company ${companyCode} not found.`);
  console.log(`\n=== ${company.companyName} (${company.companyCode}) — ${apply ? "APPLYING" : "DRY RUN"} ===`);

  const account = await ChartOfAccount.findOne({ business: company._id, code: "2110" }).lean();
  if (!account) throw new Error("2110 account not found.");

  const debitExpr = { $cond: [{ $gt: ["$debit", 0] }, "$debit", { $cond: [{ $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "debit"] }, { $ifNull: ["$amount", 0] }, 0] }] };
  const creditExpr = { $cond: [{ $gt: ["$credit", 0] }, "$credit", { $cond: [{ $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "credit"] }, { $ifNull: ["$amount", 0] }, 0] }] };

  // Net balance PER PROPERTY — the abnormal (negative, credit < debit) portion per property is
  // exactly what each property's correcting entry should restore.
  const byProperty = await FinancialLedgerEntry.aggregate([
    { $match: { business: company._id, accountId: account._id, status: { $in: ["approved", "reversed"] }, property: { $ne: null } } },
    { $group: { _id: "$property", debit: { $sum: debitExpr }, credit: { $sum: creditExpr } } },
  ]);

  let totalCorrected = 0;
  for (const row of byProperty) {
    const net = round2(row.credit - row.debit);
    if (net >= -0.01) continue; // not abnormal for this property — nothing to correct

    const correctionAmount = round2(Math.abs(net));
    const property = await (await import("../models/Property.js")).default.findById(row._id).select("propertyName propertyCode").lean();
    console.log(`  Property ${property?.propertyCode || row._id} (${property?.propertyName || "unknown"}): correcting KES ${correctionAmount.toLocaleString()}`);
    totalCorrected += correctionAmount;

    if (!apply) continue;

    const propertyControlAccount = await ensurePropertyControlAccount({ businessId: company._id, propertyId: row._id });
    const journalGroupId = new mongoose.Types.ObjectId();
    const today = new Date();
    const note = `GL correction: Landlord Remittance Payable (2110) was under-credited by a confirmed bug ` +
      `(direct-to-landlord receipt settlement / advance recovery double-count) fixed this session. ` +
      `Restores the account to its true balance for this property. See controllers/propertyController/rentPayment.js ` +
      `(confirmNonCashDirectToLandlordReceipt) and processedStatements.js (postCommissionAccrualForProcessedStatement).`;

    const creditLeg = await postEntry({
      business: company._id,
      property: row._id,
      sourceTransactionType: "manual_adjustment",
      sourceTransactionId: `2110-correction:${row._id}:${today.toISOString().slice(0, 10)}`,
      transactionDate: today,
      statementPeriodStart: today,
      statementPeriodEnd: today,
      category: "ADJUSTMENT",
      amount: correctionAmount,
      direction: "credit",
      accountId: account._id,
      journalGroupId,
      payer: "manager",
      receiver: "system",
      notes: note,
      metadata: { postingKind: "landlord_remittance_payable_correction", includeInLandlordStatement: false, correctionOf: "direct_to_landlord_and_advance_double_count_bugs" },
      status: "approved",
    });
    await postEntry({
      business: company._id,
      property: row._id,
      sourceTransactionType: "manual_adjustment",
      sourceTransactionId: `2110-correction:${row._id}:${today.toISOString().slice(0, 10)}`,
      transactionDate: today,
      statementPeriodStart: today,
      statementPeriodEnd: today,
      category: "ADJUSTMENT",
      amount: correctionAmount,
      direction: "debit",
      accountId: propertyControlAccount._id,
      journalGroupId,
      payer: "manager",
      receiver: "landlord",
      notes: note,
      metadata: { postingKind: "landlord_remittance_payable_correction", includeInLandlordStatement: false, correctionOf: "direct_to_landlord_and_advance_double_count_bugs", offsetOfEntryId: String(creditLeg._id) },
      status: "approved",
    });
    await aggregateChartOfAccountBalances(company._id, [String(account._id), String(propertyControlAccount._id)]);
  }

  console.log(`  TOTAL ${apply ? "corrected" : "would correct"}: KES ${round2(totalCorrected).toLocaleString()}`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err?.stack || err);
  process.exit(1);
});
