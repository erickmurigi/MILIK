// Cash Flow Statement: classifies each cash movement by the account type/sub-group of its
// OFFSETTING (non-cash) leg, not by which module posted it — see getCashFlowReport's own comment.
// This is what actually fixes the real bug: a fixed-asset purchase paid through the normal journal/
// voucher path used to get silently counted as an Operating cash outflow.
import { describe, it, expect } from "vitest";
import { createJournalEntry, postJournalEntry } from "./journalEntries.js";
import { getCashFlowReport } from "./financialReports.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import { callController } from "../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../test/factories.js";
import { getAccountByCode } from "../../test/factories.financial.js";

const range = { startDate: "2000-01-01", endDate: "2100-01-01" };

const setup = async () => {
  const company = await createTestCompany({ modules: { propertyManagement: true, accounts: true } });
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const call = (fn, opts = {}) => callController(fn, { user, ...opts });
  const cash = String((await getAccountByCode(company._id, "1100"))._id);
  const income = String((await ChartOfAccount.find({ business: company._id, type: "income", isPosting: true }).limit(1).lean())[0]._id);

  const vehicle = await ChartOfAccount.create({
    business: company._id, code: "1500", name: "Motor Vehicles", type: "asset", group: "assets", subGroup: "Fixed Assets", isPosting: true,
  });
  const loan = await ChartOfAccount.create({
    business: company._id, code: "2500", name: "Bank Loan Payable", type: "liability", group: "liabilities", subGroup: "Long-term Liabilities", isPosting: true,
  });

  const post = async (lines) => {
    const j = (await call(createJournalEntry, { body: { date: new Date(), lines } })).payload;
    await call(postJournalEntry, { params: { id: j._id } });
  };

  return { call, cash, income, vehicle, loan, post };
};

describe("cash flow statement — classification by offsetting account, not transaction type", () => {
  it("puts a routine cash collection in Operating, a vehicle purchase in Investing, and a loan drawdown in Financing", async () => {
    const { call, cash, income, vehicle, loan, post } = await setup();

    // Routine operating cash: Dr Cash / Cr Income
    await post([{ account: cash, debit: 10000 }, { account: income, credit: 10000 }]);

    // Buying a vehicle: Dr Fixed Asset (Motor Vehicles) / Cr Cash — paid through the exact same
    // generic journal/posting path as any other payment, with no special "this is capex" flag.
    await post([{ account: String(vehicle._id), debit: 300000 }, { account: cash, credit: 300000 }]);

    // Loan drawdown: Dr Cash / Cr Long-term Liability
    await post([{ account: cash, debit: 500000 }, { account: String(loan._id), credit: 500000 }]);

    const report = (await call(getCashFlowReport, { query: range })).payload;

    expect(report.operating.net).toBe(10000);
    expect(report.investing.net).toBe(-300000);
    expect(report.financing.net).toBe(500000);

    // Reconciliation must always hold regardless of how the movements are classified.
    expect(report.summary.netChange).toBe(10000 - 300000 + 500000);
    expect(report.summary.closingCash).toBe(round2(report.summary.openingCash + report.summary.netChange));
  });
});

const round2 = (n) => Math.round(n * 100) / 100;
