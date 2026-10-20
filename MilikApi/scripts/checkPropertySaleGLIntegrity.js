// Read-only GL integrity check for the Property Sales module specifically — reuses the same
// debit/credit aggregation logic as controllers/propertyController/ledgerDiagnostics.js's
// checkLedgerBalance, scoped to sourceTransactionType values starting "property_sale", plus a
// per-account balance snapshot for the accounts touched by today's commission/trust/payout fixes
// (2180 Agent Commission Payable, 1312 Clawback Receivable, 1314 Advocate Trust Receivable, 2185
// Owner Clearing). Run after any change to propertySale GL posting logic, against real business data,
// not just the unit-test fixtures.
//
//   node scripts/checkPropertySaleGLIntegrity.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import Company from "../models/Company.js";

dotenv.config();

const STATUSES = ["approved", "reversed"];
const dc = (field) => ({
  $cond: [{ $gt: [`$${field}`, 0] }, `$${field}`, {
    $cond: [{ $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, field === "debit" ? "debit" : "credit"] }, { $ifNull: ["$amount", 0] }, 0],
  }],
});

async function main() {
  const mongoUrl = process.env.MONGO_URL || process.env.MONGODB_URL;
  if (!mongoUrl) throw new Error("MONGO_URL is required.");
  await mongoose.connect(mongoUrl);

  const businesses = await Company.find({ "modules.propertySale": true }).select("companyName").lean();
  console.log(`Checking GL integrity for ${businesses.length} propertySale-enabled business(es).\n`);

  for (const biz of businesses) {
    const psMatch = { business: biz._id, status: { $in: STATUSES }, sourceTransactionType: { $regex: /^property_sale/ } };

    const [totals] = await FinancialLedgerEntry.aggregate([
      { $match: psMatch },
      { $group: { _id: null, totalDebit: { $sum: dc("debit") }, totalCredit: { $sum: dc("credit") }, count: { $sum: 1 } } },
    ]);
    if (!totals) {
      console.log(`── ${biz.companyName}: no property_sale GL entries at all.\n`);
      continue;
    }
    const totalDebit = Number(totals.totalDebit || 0);
    const totalCredit = Number(totals.totalCredit || 0);
    const diff = Math.round((totalDebit - totalCredit) * 100) / 100;
    const balanced = Math.abs(diff) < 0.005;

    console.log(`── ${biz.companyName} — ${totals.count} property_sale entries`);
    console.log(`   total debit=${totalDebit.toLocaleString()} total credit=${totalCredit.toLocaleString()} diff=${diff} ${balanced ? "BALANCED" : ">>> IMBALANCED <<<"}`);

    // Per-journal-group balance (every single posting call should itself be perfectly balanced)
    const groups = await FinancialLedgerEntry.aggregate([
      { $match: { ...psMatch, journalGroupId: { $ne: null } } },
      { $group: { _id: "$journalGroupId", sourceTransactionType: { $first: "$sourceTransactionType" }, sourceTransactionId: { $first: "$sourceTransactionId" }, debitSum: { $sum: dc("debit") }, creditSum: { $sum: dc("credit") } } },
      { $addFields: { d: { $subtract: ["$debitSum", "$creditSum"] } } },
      { $match: { d: { $not: { $gt: -0.005, $lt: 0.005 } } } },
    ]);
    if (groups.length) {
      console.log(`   >>> ${groups.length} UNBALANCED journal group(s):`);
      for (const g of groups) console.log(`       ${g.sourceTransactionType} / ${g.sourceTransactionId} — debit=${g.debitSum} credit=${g.creditSum} diff=${g.d}`);
    } else {
      console.log(`   every individual journal group is internally balanced (${await FinancialLedgerEntry.distinct("journalGroupId", psMatch).then((a) => a.length)} groups checked)`);
    }

    // Per-account balances for the accounts this session's fixes specifically touch
    const watchCodes = ["2180", "1312", "1314", "2185", "5320", "2141"];
    const accounts = await ChartOfAccount.find({ business: biz._id, code: { $in: watchCodes } }).select("code name").lean();
    const byId = new Map(accounts.map((a) => [String(a._id), a]));
    // Scoped to property_sale entries only — some of these account CODES are shared with unrelated,
    // pre-existing company accounts (e.g. one business's "2180" is a general EXPENSES PAYABLE account
    // used by hundreds of unrelated payment vouchers, not Property Sale's commission payable at all).
    // Checking the account's TOTAL balance would conflate the two; this isolates what property_sale
    // specifically contributed.
    const accRows = await FinancialLedgerEntry.aggregate([
      { $match: { ...psMatch, accountId: { $in: accounts.map((a) => a._id) } } },
      { $group: { _id: "$accountId", debit: { $sum: dc("debit") }, credit: { $sum: dc("credit") } } },
    ]);
    if (accRows.length) {
      console.log(`   watched account balances:`);
      for (const row of accRows) {
        const acc = byId.get(String(row._id));
        const bal = Math.round((Number(row.debit || 0) - Number(row.credit || 0)) * 100) / 100;
        // NOTE: 2180/2185/2141 are liabilities — a credit-heavy (negative, in this debit-minus-credit
        // convention) balance is their NORMAL healthy state whenever real commissions/tax are still
        // outstanding. Only 1312/1314 (receivables/assets) going negative is actually suspicious here.
        const flag = (acc?.code === "1312" || acc?.code === "1314") && bal < -0.005 ? "  <-- NEGATIVE, investigate (asset account)" : "";
        console.log(`       ${acc?.code} ${acc?.name}: debit=${row.debit.toLocaleString()} credit=${row.credit.toLocaleString()} net=${bal.toLocaleString()}${flag}`);
      }
    }
    console.log("");
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
