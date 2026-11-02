// Read-only enumeration of the real historical impact of the two 2110 bugs fixed this session,
// across every company — companion to the earlier scripts/diagnoseLandlordPayable.js. Does NOT
// write anything. For each company with a Landlord Remittance Payable (2110) account, reports:
//   1. The account's current abnormal (debit-heavy) balance, if any.
//   2. How much of that is attributable to "landlord_settlement" entries (the direct-to-landlord
//      receipt bug — rentPayment.js's confirmNonCashDirectToLandlordReceipt) that have no
//      corresponding deposit-landlord credit to offset them.
//   3. How much is attributable to "landlord_advancement_recovery" / "landlord_advance_against_payable"
//      entries (the advance double-count bug — processedStatements.js) that were posted for a period
//      whose processed statement was ALSO credited without the gross-up fix.
//
//   node scripts/enumerateHistoricalImpact.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import Company from "../models/Company.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";

dotenv.config();
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

async function main() {
  const mongoUrl = process.env.MONGO_URL || process.env.MONGODB_URL;
  if (!mongoUrl) throw new Error("MONGO_URL is required.");
  await mongoose.connect(mongoUrl);

  const companies = await Company.find({}).select("_id companyName companyCode").lean();
  const debitExpr = { $cond: [{ $gt: ["$debit", 0] }, "$debit", { $cond: [{ $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "debit"] }, { $ifNull: ["$amount", 0] }, 0] }] };
  const creditExpr = { $cond: [{ $gt: ["$credit", 0] }, "$credit", { $cond: [{ $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "credit"] }, { $ifNull: ["$amount", 0] }, 0] }] };

  const results = [];
  for (const company of companies) {
    const account = await ChartOfAccount.findOne({ business: company._id, code: "2110" }).lean();
    if (!account) continue;

    const totalsAgg = await FinancialLedgerEntry.aggregate([
      { $match: { business: company._id, accountId: account._id, status: { $in: ["approved", "reversed"] } } },
      { $group: { _id: null, debit: { $sum: debitExpr }, credit: { $sum: creditExpr } } },
    ]);
    const totalDebit = round2(totalsAgg[0]?.debit || 0);
    const totalCredit = round2(totalsAgg[0]?.credit || 0);
    const net = round2(totalCredit - totalDebit); // negative = abnormal (over-debited)
    if (net >= -0.01) continue; // not abnormal — skip, nothing to report

    const byRole = await FinancialLedgerEntry.aggregate([
      { $match: { business: company._id, accountId: account._id, status: { $in: ["approved", "reversed"] } } },
      {
        $group: {
          _id: "$metadata.postingRole",
          debit: { $sum: debitExpr },
          credit: { $sum: creditExpr },
          count: { $sum: 1 },
        },
      },
    ]);

    const settlement = byRole.find((r) => r._id === "landlord_settlement");
    const depositRemit = byRole.find((r) => r._id === "landlord_deposit_remittance");
    // Advance-related entries aren't tagged via postingRole — use postingKind instead.
    const advAgg = await FinancialLedgerEntry.aggregate([
      {
        $match: {
          business: company._id, accountId: account._id, status: { $in: ["approved", "reversed"] },
          "metadata.postingKind": { $in: ["landlord_advancement_recovery", "landlord_advance_against_payable"] },
        },
      },
      { $group: { _id: "$metadata.postingKind", debit: { $sum: debitExpr }, count: { $sum: 1 } } },
    ]);

    results.push({
      company: company.companyName,
      code: company.companyCode,
      abnormalBalance: net,
      directToLandlordSettlementDebit: round2(settlement?.debit || 0),
      settlementCount: settlement?.count || 0,
      depositLandlordOffsetCredit: round2(depositRemit?.credit || 0),
      advanceDoubleCount: advAgg.map((a) => ({ kind: a._id, debit: round2(a.debit), count: a.count })),
    });
  }

  console.log(`\nCompanies with an abnormal (over-debited) 2110 balance: ${results.length}\n`);
  for (const r of results) {
    console.log(`--- ${r.company} (${r.code || "—"}) ---`);
    console.log(`  Abnormal balance (should be ~0 or positive, is negative = over-cleared): KES ${r.abnormalBalance.toLocaleString()}`);
    console.log(`  Direct-to-landlord settlement debits: KES ${r.directToLandlordSettlementDebit.toLocaleString()} across ${r.settlementCount} receipts`);
    console.log(`  Deposit-landlord offset credits (legitimately matched a portion of the above): KES ${r.depositLandlordOffsetCredit.toLocaleString()}`);
    if (r.advanceDoubleCount.length) {
      r.advanceDoubleCount.forEach((a) => console.log(`  Advance double-count (${a.kind}): KES ${a.debit.toLocaleString()} across ${a.count} entries`));
    }
    console.log("");
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err?.stack || err);
  process.exit(1);
});
