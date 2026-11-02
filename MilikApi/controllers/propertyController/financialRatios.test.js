// getFinancialRatios used to throw "Promise.all(...).allowDiskUse is not a function" on every call —
// .allowDiskUse(true) was chained onto the Promise.all() array result instead of onto the aggregate()
// call itself. Same bug existed in getTrialBalanceExceptions and getTenantSummaryReport.
import { describe, it, expect } from "vitest";
import { createJournalEntry, postJournalEntry } from "./journalEntries.js";
import { getFinancialRatios } from "./financialReports.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import { callController } from "../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../test/factories.js";
import { getAccountByCode } from "../../test/factories.financial.js";

describe("getFinancialRatios", () => {
  it("computes ratios from real GL balances instead of throwing on allowDiskUse", async () => {
    const company = await createTestCompany({ modules: { propertyManagement: true, accounts: true } });
    await createTestChartOfAccounts(company._id);
    const user = await createTestUser({ company });
    const call = (fn, opts = {}) => callController(fn, { user, ...opts });
    const cash = String((await getAccountByCode(company._id, "1100"))._id);
    const income = String((await ChartOfAccount.find({ business: company._id, type: "income", isPosting: true }).limit(1).lean())[0]._id);

    const j = (await call(createJournalEntry, { body: { date: new Date(), lines: [{ account: cash, debit: 1000 }, { account: income, credit: 1000 }] } })).payload;
    await call(postJournalEntry, { params: { id: j._id } });

    const { statusCode, payload } = await call(getFinancialRatios);
    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.components.totalIncome).toBe(1000);
    expect(payload.components.currentAssets).toBe(1000);

    // Real income accounts are named things like "Rental Income" / "Commission Income" — never
    // literally "Revenue" or "Sales" — so totalRevenue must still pick them up, and Net Margin must
    // be computable (not "N/A") the moment there's any income at all.
    expect(payload.components.totalRevenue).toBe(1000);
    expect(payload.ratios.netMargin).toBe(100);

    // No Year-End Close has run, so there's no real Retained Earnings posting yet — Total Equity must
    // still reflect the period's net income the same way the Balance Sheet's "Current Period
    // Earnings" line does, so Debt-to-Equity is a real number instead of "N/A".
    expect(payload.components.totalEquity).toBe(1000);
    expect(payload.ratios.debtToEquity).not.toBeNull();
  });
});
