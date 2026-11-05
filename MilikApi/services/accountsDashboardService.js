// Everything the Financial Accounts dashboard shows, in one call. Each figure uses the same rules as
// the report it links to, so the dashboard and the reports always agree:
//   - cash in / out and cash balances: the Cash Flow report's cash accounts and ledger rule
//     (approved, reversal pairs excluded, transfers between cash accounts netted out);
//   - income / expenses / net: the Income Statement's accounts and ledger rule;
//   - month boundaries: the reports' (server-local calendar months).
import mongoose from "mongoose";
import ChartOfAccount from "../models/ChartOfAccount.js";
import Company from "../models/Company.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import JournalEntry from "../models/JournalEntry.js";
import PaymentVoucher from "../models/PaymentVoucher.js";
import AccountingPeriod from "../models/AccountingPeriod.js";
import GLHealthRun from "../models/GLHealthRun.js";
import "../models/ServiceProvider.js"; // populated on recent vouchers
import "../models/Landlord.js";
import {
  isOperatingIncomeAccount,
  isOperatingExpenseAccount,
  isSelfManagingLandlordIncomeAccount,
  isSelfManagingLandlordExpenseAccount,
} from "../utils/accountClassifiers.js";
import { isSelfManagingLandlordCompany } from "../utils/companyModules.js";
import { round2 } from "../utils/math.js";

const REPORT_LEDGER_STATUSES = ["approved", "reversed"];
const CASH_LEDGER_MATCH = { status: "approved", category: { $ne: "REVERSAL" } };

const debitExpr = {
  $cond: [{ $gt: ["$debit", 0] }, "$debit", { $cond: [{ $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "debit"] }, { $ifNull: ["$amount", 0] }, 0] }],
};
const creditExpr = {
  $cond: [{ $gt: ["$credit", 0] }, "$credit", { $cond: [{ $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "credit"] }, { $ifNull: ["$amount", 0] }, 0] }],
};

// The accounts the Cash Flow report treats as cash: posting asset accounts named or grouped as cash,
// bank or petty cash. Control accounts such as "POS Receipts Control" are not cash.
export const findCashAccounts = (businessId) =>
  ChartOfAccount.find({
    business: businessId,
    type: "asset",
    isHeader: { $ne: true },
    isPosting: { $ne: false },
    $or: [
      { subGroup: { $regex: /cash|bank|petty/i } },
      { name: { $regex: /cash|bank|petty/i } },
      { group: { $regex: /cash|bank/i } },
    ],
  }).sort({ code: 1 }).lean();

export const monthRanges = (months, now = new Date()) =>
  Array.from({ length: months }, (_, i) => {
    const start = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999);
    return {
      key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
      label: start.toLocaleDateString("en-GB", { month: "short" }),
      startDate: start,
      endDate: end,
    };
  });

const monthKeyExpr = (ranges) => ({
  $switch: {
    branches: ranges.map((r) => ({ case: { $and: [{ $gte: ["$transactionDate", r.startDate] }, { $lte: ["$transactionDate", r.endDate] }] }, then: r.key })),
    default: null,
  },
});

// Per month: cash in and out, counted the way the Cash Flow report counts them. A posting whose cash
// legs net to zero (a transfer from the bank to petty cash) is not cash in or out.
const cashByMonth = async (businessOid, cashIds, ranges) => {
  if (!cashIds.length) return new Map();
  const rows = await FinancialLedgerEntry.aggregate([
    {
      $match: {
        business: businessOid, accountId: { $in: cashIds }, ...CASH_LEDGER_MATCH,
        transactionDate: { $gte: ranges[0].startDate, $lte: ranges[ranges.length - 1].endDate },
      },
    },
    { $addFields: { ym: monthKeyExpr(ranges) } },
    { $match: { ym: { $ne: null } } },
    // One posting = one journal group; older postings without a group are tied by their source document.
    { $group: { _id: { ym: "$ym", g: { $ifNull: ["$journalGroupId", { t: "$sourceTransactionType", id: "$sourceTransactionId" }] } }, debit: { $sum: debitExpr }, credit: { $sum: creditExpr } } },
  ]).allowDiskUse(true);

  const byMonth = new Map();
  for (const row of rows) {
    if (Math.abs(round2(row.debit - row.credit)) < 0.01) continue;
    const bucket = byMonth.get(row._id.ym) || { cashIn: 0, cashOut: 0 };
    bucket.cashIn += row.debit;
    bucket.cashOut += row.credit;
    byMonth.set(row._id.ym, bucket);
  }
  return byMonth;
};

const cashBalances = async (businessOid, cashAccounts) => {
  if (!cashAccounts.length) return [];
  const rows = await FinancialLedgerEntry.aggregate([
    { $match: { business: businessOid, accountId: { $in: cashAccounts.map((a) => a._id) }, ...CASH_LEDGER_MATCH } },
    { $group: { _id: "$accountId", debit: { $sum: debitExpr }, credit: { $sum: creditExpr }, entries: { $sum: 1 } } },
  ]).allowDiskUse(true);
  const byId = new Map(rows.map((r) => [String(r._id), r]));
  return cashAccounts
    .filter((a) => a.isActive !== false || byId.has(String(a._id)))
    .map((a) => {
      const r = byId.get(String(a._id));
      return { _id: a._id, code: a.code, name: a.name, balance: round2((r?.debit || 0) - (r?.credit || 0)), entries: r?.entries || 0 };
    });
};

// Per month: income and expenses on the Income Statement's accounts.
const profitByMonth = async (businessOid, company, ranges) => {
  const selfManaging = isSelfManagingLandlordCompany(company);
  const incomeClassifier = selfManaging ? isSelfManagingLandlordIncomeAccount : isOperatingIncomeAccount;
  const expenseClassifier = selfManaging ? isSelfManagingLandlordExpenseAccount : isOperatingExpenseAccount;
  const accounts = await ChartOfAccount.find(
    { business: businessOid, type: { $in: ["income", "expense"] }, isPosting: { $ne: false }, isHeader: { $ne: true } },
    { _id: 1, code: 1, name: 1, type: 1, subGroup: 1 },
  ).lean();
  const included = accounts.filter((a) => (a.type === "income" ? incomeClassifier(a) : expenseClassifier(a)));
  if (!included.length) return new Map();
  const incomeIds = new Set(included.filter((a) => a.type === "income").map((a) => String(a._id)));

  const rows = await FinancialLedgerEntry.aggregate([
    {
      $match: {
        business: businessOid, accountId: { $in: included.map((a) => a._id) }, status: { $in: REPORT_LEDGER_STATUSES },
        transactionDate: { $gte: ranges[0].startDate, $lte: ranges[ranges.length - 1].endDate },
      },
    },
    { $addFields: { ym: monthKeyExpr(ranges) } },
    { $match: { ym: { $ne: null } } },
    { $group: { _id: { ym: "$ym", accountId: "$accountId" }, debit: { $sum: debitExpr }, credit: { $sum: creditExpr } } },
  ]).allowDiskUse(true);

  const byMonth = new Map();
  for (const row of rows) {
    const bucket = byMonth.get(row._id.ym) || { income: 0, expenses: 0 };
    if (incomeIds.has(String(row._id.accountId))) bucket.income += row.credit - row.debit;
    else bucket.expenses += row.debit - row.credit;
    byMonth.set(row._id.ym, bucket);
  }
  return byMonth;
};

const sumBy = (businessOid, match) =>
  PaymentVoucher.aggregate([
    { $match: { business: businessOid, ...match } },
    { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: { $ifNull: ["$amount", 0] } } } },
  ]).then(([r]) => ({ count: r?.count || 0, amount: round2(r?.amount || 0) }));

const payeeOf = (v) => v.serviceProvider?.name || v.payeeName || v.landlord?.landlordName || v.landlord?.name || "";

export const buildAccountsDashboard = async (businessId, { months = 6, now = new Date() } = {}) => {
  const businessOid = new mongoose.Types.ObjectId(String(businessId));
  const ranges = monthRanges(Math.max(1, Math.min(24, Number(months) || 6)), now);
  const thisMonth = ranges[ranges.length - 1];
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [company, cashAccounts] = await Promise.all([
    Company.findById(businessOid, { modules: 1, companyMode: 1 }).lean(),
    findCashAccounts(businessOid),
  ]);
  const cashIds = cashAccounts.map((a) => a._id);

  const [
    cashMonths, profitMonths, balances,
    draftJournals, pendingApproval, postedThisMonth,
    draftVouchers, approvedVouchers, overdueVouchers,
    currentPeriod, lastHealthRun, recentVouchers, recentJournals,
  ] = await Promise.all([
    cashByMonth(businessOid, cashIds, ranges),
    profitByMonth(businessOid, company, ranges),
    cashBalances(businessOid, cashAccounts),
    JournalEntry.countDocuments({ business: businessOid, status: "draft" }),
    JournalEntry.countDocuments({ business: businessOid, status: "draft", approvalStatus: { $in: ["pending_review", "reviewed"] } }),
    JournalEntry.countDocuments({ business: businessOid, status: "posted", date: { $gte: thisMonth.startDate, $lte: thisMonth.endDate } }),
    sumBy(businessOid, { status: "draft" }),
    sumBy(businessOid, { status: "approved" }),
    sumBy(businessOid, { status: "approved", dueDate: { $lt: todayStart } }),
    AccountingPeriod.findOne({ business: businessOid, startDate: { $lte: now }, endDate: { $gte: now } }).select("name status startDate endDate").lean(),
    GLHealthRun.findOne({ business: businessOid }).sort({ runAt: -1 }).select("runAt overallStatus issueCount").lean(),
    PaymentVoucher.find({ business: businessOid })
      .sort({ createdAt: -1 }).limit(6)
      .select("voucherNo status amount dueDate paidDate paidAt payeeName narration serviceProvider landlord")
      .populate("serviceProvider", "name").populate("landlord", "landlordName name")
      .lean(),
    JournalEntry.find({ business: businessOid })
      .sort({ date: -1, createdAt: -1 }).limit(6)
      .select("journalNo date narration reference status amount")
      .lean(),
  ]);

  const monthsOut = ranges.map((r) => {
    const cash = cashMonths.get(r.key) || { cashIn: 0, cashOut: 0 };
    const pl = profitMonths.get(r.key) || { income: 0, expenses: 0 };
    const income = round2(pl.income);
    const expenses = round2(pl.expenses);
    return {
      key: r.key, month: r.label, startDate: r.startDate, endDate: r.endDate,
      cashIn: round2(cash.cashIn), cashOut: round2(cash.cashOut),
      income, expenses, net: round2(income - expenses),
    };
  });

  return {
    asOf: now,
    months: monthsOut,
    thisMonth: monthsOut[monthsOut.length - 1],
    cash: {
      accounts: balances,
      total: round2(balances.reduce((s, a) => s + a.balance, 0)),
      overdrawn: balances.filter((a) => a.balance < -0.005).map((a) => ({ code: a.code, name: a.name, balance: a.balance })),
    },
    journals: { draft: draftJournals, pendingApproval, postedThisMonth },
    vouchers: {
      draft: draftVouchers,
      approved: approvedVouchers,
      overdue: overdueVouchers,
      unpaid: { count: draftVouchers.count + approvedVouchers.count, amount: round2(draftVouchers.amount + approvedVouchers.amount) },
    },
    period: currentPeriod || null,
    glHealth: lastHealthRun || null,
    recent: {
      vouchers: recentVouchers.map((v) => ({
        _id: v._id, voucherNo: v.voucherNo, status: v.status, amount: round2(v.amount || 0),
        dueDate: v.dueDate || null, paidDate: v.paidDate || v.paidAt || null, payee: payeeOf(v) || v.narration || "",
      })),
      journals: recentJournals.map((j) => ({
        _id: j._id, journalNo: j.journalNo, date: j.date, status: j.status,
        narration: j.narration || j.reference || "", amount: round2(j.amount || 0),
      })),
    },
  };
};
