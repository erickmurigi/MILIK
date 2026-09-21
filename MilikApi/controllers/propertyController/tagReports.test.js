// Profit and loss by journal-line tag: the tag summary report and the tag filter on the income statement.
import { describe, it, expect } from "vitest";
import { createJournalEntry, postJournalEntry, reverseJournalEntry } from "./journalEntries.js";
import { getTagSummaryReport } from "./tagReports.js";
import { getIncomeStatementReport } from "./financialReports.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import { isOperatingExpenseAccount, isOperatingIncomeAccount } from "../../utils/accountClassifiers.js";
import SaleProject from "../../modules/propertySale/models/SaleProject.js";
import { callController } from "../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../test/factories.js";
import { getAccountByCode } from "../../test/factories.financial.js";

const setup = async () => {
  const company = await createTestCompany({ modules: { propertyManagement: true, propertySale: true, accounts: true } });
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const call = (fn, opts = {}) => callController(fn, { user, ...opts });
  const cash = String((await getAccountByCode(company._id, "1100"))._id);
  // accounts the company's own profit and loss counts (rental / landlord-side ones are left out of it by design)
  const pick = async (type, ok) => String((await ChartOfAccount.find({ business: company._id, type, isPosting: true }).sort({ code: 1 }).lean()).find(ok)._id);
  const expense = await pick("expense", isOperatingExpenseAccount);
  const income = await pick("income", isOperatingIncomeAccount);
  const project = await SaleProject.create({ business: company._id, projectNumber: "PRJ-1", name: "Kitengela Plots" });
  const other = await SaleProject.create({ business: company._id, projectNumber: "PRJ-2", name: "Athi River" });
  const post = async (lines) => {
    const j = (await call(createJournalEntry, { body: { date: new Date(), lines } })).payload;
    await call(postJournalEntry, { params: { id: j._id } });
    return j;
  };
  return { company, call, cash, expense, income, project, other, post };
};

const range = { startDate: "2000-01-01", endDate: "2100-01-01" };

describe("profit and loss by tag", () => {
  it("groups income and expenses per project and per cost centre, ignoring untagged and balance-sheet lines", async () => {
    const { call, cash, expense, income, project, other, post } = await setup();
    const p = String(project._id);
    await post([{ account: cash, debit: 1000, dimensions: { project: p } }, { account: income, credit: 1000, dimensions: { project: p } }]);
    await post([{ account: expense, debit: 300, dimensions: { project: p, costCentre: "Sales" } }, { account: cash, credit: 300, dimensions: { project: p } }]);
    await post([{ account: expense, debit: 80, dimensions: { project: String(other._id) } }, { account: cash, credit: 80 }]);
    await post([{ account: cash, debit: 500 }, { account: income, credit: 500 }]); // untagged

    const byProject = (await call(getTagSummaryReport, { query: { by: "project", ...range } })).payload;
    expect(byProject.rows).toEqual([
      expect.objectContaining({ label: "PRJ-1 · Kitengela Plots", income: 1000, expenses: 300, net: 700 }),
      expect.objectContaining({ label: "PRJ-2 · Athi River", income: 0, expenses: 80, net: -80 }),
    ]);
    expect(byProject.totals).toEqual({ income: 1000, expenses: 380, net: 620 });

    const byCentre = (await call(getTagSummaryReport, { query: { by: "costCentre", ...range } })).payload;
    expect(byCentre.rows).toEqual([expect.objectContaining({ label: "Sales", income: 0, expenses: 300 })]);

    await expect(call(getTagSummaryReport, { query: { by: "nonsense" } })).rejects.toThrow(/Group by/);
  });

  it("scopes the income statement to one project, and a reversal takes the amount back out", async () => {
    const { call, cash, income, project, post } = await setup();
    const p = String(project._id);
    const j = await post([{ account: cash, debit: 1000, dimensions: { project: p } }, { account: income, credit: 1000, dimensions: { project: p } }]);
    await post([{ account: cash, debit: 500 }, { account: income, credit: 500 }]);

    const all = (await call(getIncomeStatementReport, { query: range })).payload;
    const scoped = (await call(getIncomeStatementReport, { query: { ...range, projectId: p } })).payload;
    expect(all.summary.totalIncome).toBe(1500);
    expect(scoped.summary.totalIncome).toBe(1000);

    await call(reverseJournalEntry, { params: { id: j._id }, body: { reason: "wrong project" } });
    const after = (await call(getIncomeStatementReport, { query: { ...range, projectId: p } })).payload;
    expect(after.summary.totalIncome).toBe(0);
    const summary = (await call(getTagSummaryReport, { query: { by: "project", ...range } })).payload;
    expect(summary.totals.income).toBe(0);
  });
});
