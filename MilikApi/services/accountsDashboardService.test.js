// The Financial Accounts dashboard must say what the reports say: cash counted like the Cash Flow
// report (transfers and reversal pairs netted out, control accounts excluded), profit counted like the
// Income Statement, every pending item counted regardless of date.
import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { buildAccountsDashboard } from "./accountsDashboardService.js";
import { getAccountsDashboard, getCashFlowReport } from "../controllers/propertyController/financialReports.js";
import { postEntry } from "./ledgerPostingService.js";
import { callController } from "../test/callController.js";
import { createTestCompany, createTestChartOfAccounts } from "../test/factories.js";
import { getAccountByCode } from "../test/factories.financial.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import JournalEntry from "../models/JournalEntry.js";
import PaymentVoucher from "../models/PaymentVoucher.js";

const NOW = new Date();
const thisMonth = (day) => new Date(NOW.getFullYear(), NOW.getMonth(), day, 10);

const pair = async (business, debitAccount, creditAccount, amount, date) => {
  const common = {
    business, allowUnscoped: true, amount, sourceTransactionType: "manual_adjustment", sourceTransactionId: `d-${Math.random()}`,
    transactionDate: date, statementPeriodStart: date, statementPeriodEnd: date, category: "ADJUSTMENT",
    journalGroupId: new mongoose.Types.ObjectId(),
  };
  const [dr, cr] = await Promise.all([
    postEntry({ ...common, accountId: debitAccount._id, direction: "debit" }),
    postEntry({ ...common, accountId: creditAccount._id, direction: "credit" }),
  ]);
  return { dr, cr, groupId: common.journalGroupId };
};

const setup = async () => {
  const company = await createTestCompany();
  await createTestChartOfAccounts(company._id);
  const [cash, bank, fees, office] = await Promise.all(
    ["1100", "1110", "4200", "5200"].map((code) => getAccountByCode(company._id, code)),
  );
  const pos = await ChartOfAccount.create({ business: company._id, code: "1310", name: "POS Receipts Control", type: "asset", group: "assets", subGroup: "Current Assets", isPosting: true });
  return { company, cash, bank, pos, fees, office };
};

describe("accounts dashboard", { timeout: 120000 }, () => {
  it("counts cash like the Cash Flow report and profit like the Income Statement", async () => {
    const { company, cash, bank, pos, fees, office } = await setup();
    const day = thisMonth(Math.min(NOW.getDate(), 2));

    await pair(company._id, cash, fees, 5000, day);   // receipt: cash in 5,000, income 5,000
    await pair(company._id, office, bank, 1200, day); // payment: cash out 1,200, expense 1,200
    await pair(company._id, bank, cash, 3000, day);   // transfer between cash accounts: neither in nor out
    await pair(company._id, pos, fees, 700, day);     // POS control account is not cash

    // A receipt reversed later the same month: the Cash Flow rule drops the pair from cash,
    // the Income Statement nets it to zero.
    const reversed = await pair(company._id, cash, fees, 900, day);
    await FinancialLedgerEntry.collection.updateMany({ journalGroupId: reversed.groupId }, { $set: { status: "reversed" } });
    const rev = { ...{ business: company._id, sourceTransactionType: "manual_adjustment", sourceTransactionId: "rev", category: "REVERSAL", status: "approved", transactionDate: day, createdAt: new Date() } };
    await FinancialLedgerEntry.collection.insertMany([
      { ...rev, accountId: cash._id, debit: 0, credit: 900, amount: 900, direction: "credit" },
      { ...rev, accountId: fees._id, debit: 900, credit: 0, amount: 900, direction: "debit" },
    ]);

    // an older petty cash top-up written without a journal group: still a transfer, not cash in/out
    const legacy = { business: company._id, sourceTransactionType: "petty_cash_replenishment", sourceTransactionId: "rep-1", category: "PETTY_CASH_REPLENISHMENT", status: "approved", transactionDate: day, createdAt: new Date(), amount: 250 };
    await FinancialLedgerEntry.collection.insertMany([
      { ...legacy, accountId: bank._id, debit: 250, credit: 0, direction: "debit" },
      { ...legacy, accountId: cash._id, debit: 0, credit: 250, direction: "credit" },
    ]);

    const d = await buildAccountsDashboard(company._id, { now: NOW });
    const ymd = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    const flow = (await callController(getCashFlowReport, {
      user: { company: company._id, id: "milik-admin", isSystemAdmin: true },
      query: { startDate: ymd(new Date(NOW.getFullYear(), NOW.getMonth(), 1)), endDate: ymd(NOW) },
    })).payload;
    const sections = [flow.operating, flow.investing, flow.financing];
    expect(sections.reduce((t, x) => t + x.totalInflows, 0)).toBe(d.thisMonth.cashIn);
    expect(sections.reduce((t, x) => t + x.totalOutflows, 0)).toBe(d.thisMonth.cashOut);
    expect(d.thisMonth).toMatchObject({ cashIn: 5000, cashOut: 1200, income: 5700, expenses: 1200, net: 4500 });
    expect(d.months).toHaveLength(6);
    expect(d.cash.accounts.map((a) => a.code)).not.toContain("1310");
    const byCode = Object.fromEntries(d.cash.accounts.map((a) => [a.code, a.balance]));
    expect(byCode["1100"]).toBe(1750);  // 5000 in, 3000 + 250 moved to the bank
    expect(byCode["1110"]).toBe(2050);  // 3250 in, 1200 paid out
    expect(d.cash.total).toBe(3800);
    expect(d.cash.overdrawn).toEqual([]);
  });

  it("flags an overdrawn cash account and counts every pending journal and voucher", async () => {
    const { company, cash, office } = await setup();
    await pair(company._id, office, cash, 400, thisMonth(1));

    const old = new Date(NOW.getFullYear() - 1, 0, 15);
    await JournalEntry.collection.insertMany([
      { business: company._id, journalNo: "JV-1", status: "draft", date: old, amount: 10, approvalStatus: "not_required" },
      { business: company._id, journalNo: "JV-2", status: "draft", date: thisMonth(1), amount: 20, approvalStatus: "pending_review" },
      { business: company._id, journalNo: "JV-3", status: "posted", date: thisMonth(1), amount: 30 },
    ]);
    await PaymentVoucher.collection.insertMany([
      { business: company._id, voucherNo: "PV-1", status: "approved", amount: 1000, dueDate: old, createdAt: new Date() },
      { business: company._id, voucherNo: "PV-2", status: "draft", amount: 250, dueDate: new Date(NOW.getTime() + 864e5), createdAt: new Date() },
      { business: company._id, voucherNo: "PV-3", status: "paid", amount: 99, dueDate: old, createdAt: new Date() },
    ]);

    const res = await callController(getAccountsDashboard, { user: { company: company._id, id: "milik-admin", isSystemAdmin: true } });
    expect(res.statusCode).toBe(200);
    const d = res.payload;
    expect(d.cash.overdrawn).toEqual([expect.objectContaining({ code: "1100", balance: -400 })]);
    expect(d.journals).toEqual({ draft: 2, pendingApproval: 1, postedThisMonth: 1 });
    expect(d.vouchers.unpaid).toEqual({ count: 2, amount: 1250 });
    expect(d.vouchers.overdue).toEqual({ count: 1, amount: 1000 });
    expect(d.recent.vouchers).toHaveLength(3);
    expect(d.recent.journals[0].journalNo).toMatch(/JV-/);
  });
});
