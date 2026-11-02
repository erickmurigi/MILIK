// Read-only diagnostic: breaks down Landlord Remittance Payable (2110) activity for one company by
// sourceTransactionType + metadata.postingRole, so we can see which posting path is crediting the
// liability without a matching debit (i.e. not clearing).
//
//   node scripts/diagnoseLandlordPayable.js --companyCode=GLR
import mongoose from "mongoose";
import dotenv from "dotenv";
import Company from "../models/Company.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";

dotenv.config();

const getArg = (name, fallback = "") => {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
};

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

async function main() {
  const mongoUrl = process.env.MONGO_URL || process.env.MONGODB_URL;
  if (!mongoUrl) throw new Error("MONGO_URL is required.");
  await mongoose.connect(mongoUrl);

  const companyCode = getArg("companyCode");
  const companyName = getArg("companyName");
  const company = companyCode
    ? await Company.findOne({ companyCode }).lean()
    : await Company.findOne({ companyName: new RegExp(companyName, "i") }).lean();
  if (!company) throw new Error("Company not found.");
  console.log("Company:", company.companyName, company.companyCode);

  const account = await ChartOfAccount.findOne({ business: company._id, code: "2110" }).lean();
  if (!account) throw new Error("2110 account not found for this company.");
  console.log("Account:", account.code, account.name, "id:", account._id);

  const debitExpr = { $cond: [{ $gt: ["$debit", 0] }, "$debit", { $cond: [{ $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "debit"] }, { $ifNull: ["$amount", 0] }, 0] }] };
  const creditExpr = { $cond: [{ $gt: ["$credit", 0] }, "$credit", { $cond: [{ $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "credit"] }, { $ifNull: ["$amount", 0] }, 0] }] };

  const byType = await FinancialLedgerEntry.aggregate([
    { $match: { business: company._id, accountId: account._id, status: { $in: ["approved", "reversed"] } } },
    {
      $group: {
        _id: { sourceTransactionType: "$sourceTransactionType", postingRole: "$metadata.postingRole" },
        debit: { $sum: debitExpr },
        credit: { $sum: creditExpr },
        count: { $sum: 1 },
        firstDate: { $min: "$transactionDate" },
        lastDate: { $max: "$transactionDate" },
      },
    },
    { $sort: { "_id.sourceTransactionType": 1, "_id.postingRole": 1 } },
  ]);

  console.log("\nBreakdown by (sourceTransactionType, postingRole):");
  let totalDebit = 0, totalCredit = 0;
  for (const row of byType) {
    const net = round2(row.debit - row.credit);
    totalDebit += row.debit;
    totalCredit += row.credit;
    console.log(
      `  ${String(row._id.sourceTransactionType || "—").padEnd(28)} ${String(row._id.postingRole || "—").padEnd(32)} ` +
      `debit=${round2(row.debit).toFixed(2).padStart(14)} credit=${round2(row.credit).toFixed(2).padStart(14)} net=${net.toFixed(2).padStart(14)} count=${row.count} ` +
      `(${row.firstDate?.toISOString().slice(0, 10)} .. ${row.lastDate?.toISOString().slice(0, 10)})`
    );
  }
  console.log(`\nTOTAL debit=${round2(totalDebit).toFixed(2)} credit=${round2(totalCredit).toFixed(2)} net(credit-debit)=${round2(totalCredit - totalDebit).toFixed(2)}`);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err?.stack || err);
  process.exit(1);
});
