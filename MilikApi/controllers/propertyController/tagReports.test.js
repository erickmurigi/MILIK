// Profit and loss by journal-line tag: the tag summary report and the tag filter on the income statement.
import { describe, it, expect } from "vitest";
import { createJournalEntry, postJournalEntry, reverseJournalEntry } from "./journalEntries.js";
import { getTagSummaryReport } from "./tagReports.js";
import { getIncomeStatementReport } from "./financialReports.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import { isOperatingExpenseAccount, isOperatingIncomeAccount } from "../../utils/accountClassifiers.js";
import mongoose from "mongoose";
import SaleProject from "../../modules/propertySale/models/SaleProject.js";
import SaleListing from "../../modules/propertySale/models/SaleListing.js";
import SaleDeal from "../../modules/propertySale/models/SaleDeal.js";
import SaleAgent from "../../modules/propertySale/models/SaleAgent.js";
import CostCentre from "../../models/CostCentre.js";
import Zone from "../../models/Zone.js";
import { callController } from "../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser, createTestProperty } from "../../test/factories.js";
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
  const costCentre = await CostCentre.create({ business: company._id, name: "Sales" });
  const post = async (lines) => {
    const j = (await call(createJournalEntry, { body: { date: new Date(), lines } })).payload;
    await call(postJournalEntry, { params: { id: j._id } });
    return j;
  };
  return { company, call, cash, expense, income, project, other, costCentre, post };
};

const range = { startDate: "2000-01-01", endDate: "2100-01-01" };

describe("profit and loss by tag", () => {
  it("groups income and expenses per project and per cost centre, ignoring untagged and balance-sheet lines", async () => {
    const { call, cash, expense, income, project, other, costCentre, post } = await setup();
    const p = String(project._id);
    await post([{ account: cash, debit: 1000, dimensions: { project: p } }, { account: income, credit: 1000, dimensions: { project: p } }]);
    await post([{ account: expense, debit: 300, dimensions: { project: p, costCentre: String(costCentre._id) } }, { account: cash, credit: 300, dimensions: { project: p } }]);
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

  it("groups by zone via each property's zoneRegion, rolling an unmatched property into Unassigned", async () => {
    const { call, cash, income, company, post } = await setup();
    const { property: zonedProperty } = await createTestProperty({ company, zoneRegion: "North" });
    const { property: strayProperty } = await createTestProperty({ company, zoneRegion: "Nowhere" });
    await Zone.create({ company: company._id, name: "North", code: "ZN-001" });

    await post([
      { account: cash, debit: 1000, dimensions: { property: String(zonedProperty._id) } },
      { account: income, credit: 1000, dimensions: { property: String(zonedProperty._id) } },
    ]);
    await post([
      { account: cash, debit: 500, dimensions: { property: String(strayProperty._id) } },
      { account: income, credit: 500, dimensions: { property: String(strayProperty._id) } },
    ]);

    const byZone = (await call(getTagSummaryReport, { query: { by: "zone", ...range } })).payload;
    expect(byZone.rows).toEqual([
      expect.objectContaining({ label: "North", income: 1000, expenses: 0, net: 1000 }),
      expect.objectContaining({ label: "Unassigned", income: 500, expenses: 0, net: 500 }),
    ]);
  });

  it("groups by listing, deal and agent — the three groupings never exercised elsewhere", async () => {
    const { call, cash, expense, income, company, post } = await setup();
    const agent = await SaleAgent.create({ business: company._id, agentNumber: "AGT-1", fullName: "Jane Mwangi" });
    const listing = await SaleListing.create({
      business: company._id, listingNumber: "LST-1", title: "2BR Unit", unitNumber: "A4", askingPrice: 4500000,
    });
    const deal = await SaleDeal.create({
      business: company._id, dealNumber: "DEAL-1", listing: listing._id, buyer: new mongoose.Types.ObjectId(), agreedPrice: 4500000,
    });

    await post([
      { account: cash, debit: 2000, dimensions: { listing: String(listing._id), deal: String(deal._id), agent: String(agent._id) } },
      { account: income, credit: 2000, dimensions: { listing: String(listing._id), deal: String(deal._id), agent: String(agent._id) } },
    ]);
    await post([
      { account: expense, debit: 150, dimensions: { agent: String(agent._id) } },
      { account: cash, credit: 150, dimensions: { agent: String(agent._id) } },
    ]);

    const byListing = (await call(getTagSummaryReport, { query: { by: "listing", ...range } })).payload;
    expect(byListing.rows).toEqual([expect.objectContaining({ label: "LST-1 · Unit A4", income: 2000, expenses: 0, net: 2000 })]);

    const byDeal = (await call(getTagSummaryReport, { query: { by: "deal", ...range } })).payload;
    expect(byDeal.rows).toEqual([expect.objectContaining({ label: "DEAL-1", income: 2000, expenses: 0, net: 2000 })]);

    const byAgent = (await call(getTagSummaryReport, { query: { by: "agent", ...range } })).payload;
    expect(byAgent.rows).toEqual([expect.objectContaining({ label: "AGT-1 · Jane Mwangi", income: 2000, expenses: 150, net: 1850 })]);
  });
});
