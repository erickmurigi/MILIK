// The Chart of Accounts and an account's Ledger Activity must show the ledger as it is: the same balance the Trial
// Balance shows, every account that holds money, and running balances that stay right a page at a time.
import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import router from "./chartOfAccounts.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import User from "../models/User.js";
import { postEntry } from "../services/ledgerPostingService.js";
import { callController } from "../test/callController.js";
import { routeHandler } from "../test/routeHandler.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../test/factories.js";
import { getAccountByCode } from "../test/factories.financial.js";

const list = routeHandler(router, "get", "/");
const activity = routeHandler(router, "get", "/:id/activity");

const post = (company, account, direction, amount, date) => postEntry({
  business: company._id, allowUnscoped: true, sourceTransactionType: "other", sourceTransactionId: `t-${Math.random()}`,
  transactionDate: date, statementPeriodStart: date, statementPeriodEnd: date, category: "ADJUSTMENT",
  amount, direction, accountId: account._id, payer: "n/a", receiver: "n/a",
});

const setup = async () => {
  const company = await createTestCompany({ modules: { accounts: true, propertyManagement: true, hr: false } });
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const call = (fn, { params = {}, query = {} } = {}) =>
    callController(fn, { user, params, query: { business: String(company._id), ...query } });
  return { company, user, call };
};

describe("chart of accounts and ledger activity", { timeout: 120000 }, () => {
  it("lists every account holding money with its ledger balance, and marks contra accounts", async () => {
    const { company, call } = await setup();
    const pctrl = await ChartOfAccount.create({
      business: company._id, code: "PCTRL-P1", name: "Block A – Property Control", type: "asset", group: "assets",
      subGroup: "Property Control Accounts", isSystem: true, isPosting: true, property: new mongoose.Types.ObjectId(),
      moduleScopes: ["propertyManagement"],
    });
    const payrollOnly = await ChartOfAccount.create({
      business: company._id, code: "5402", name: "Employer NSSF Contribution", type: "expense", group: "expenses",
      subGroup: "Administrative Expenses", isSystem: true, isPosting: true, moduleScopes: ["hr"],
    });
    const accumulated = await ChartOfAccount.create({
      business: company._id, code: "1316", name: "Accumulated Depreciation", type: "asset", group: "assets", isPosting: true,
    });
    const day = new Date("2026-03-10T09:00:00Z");
    await post(company, pctrl, "debit", 500, day);
    await post(company, payrollOnly, "debit", 1000, day);
    await post(company, accumulated, "credit", 300, day);

    const { statusCode, payload } = await call(list);
    expect(statusCode).toBe(200);
    const byCode = Object.fromEntries(payload.map((a) => [a.code, a]));
    expect(byCode["PCTRL-P1"].balance).toBe(500);     // its own ledger, not a figure taken from 2110
    expect(byCode["5402"]?.balance).toBe(1000);       // HR is off, but the account holds money
    expect(byCode["1316"]).toMatchObject({ balance: -300, isContra: true });
    expect(byCode["1100"].isContra).toBe(false);
  });

  it("pages the activity with running balances that match the whole ledger", async () => {
    const { company, call } = await setup();
    const cash = await getAccountByCode(company._id, "1100");
    const moves = [["debit", 1000], ["credit", 200], ["debit", 50], ["credit", 75], ["debit", 400], ["credit", 25], ["debit", 10]];
    for (let i = 0; i < moves.length; i += 1) {
      await post(company, cash, moves[i][0], moves[i][1], new Date(Date.UTC(2026, 2, 1 + i, 9)));
    }
    const signedAt = (i) => moves.slice(0, i + 1).reduce((s, [d, a]) => s + (d === "debit" ? a : -a), 0);

    // whole ledger, newest first: balances 1160, 1150, 1175, 775, 850, 800, 1000
    const page2 = (await call(activity, { params: { id: String(cash._id) }, query: { limit: "3", page: "2" } })).payload.data;
    expect(page2).toMatchObject({ count: 7, pages: 3, page: 2, openingBalance: 0, closingBalance: 1160 });
    expect(page2.totals).toEqual({ debit: 1460, credit: 300 });
    expect(page2.entries.map((e) => e.runningBalance)).toEqual([signedAt(3), signedAt(2), signedAt(1)]);

    // from 3 March: opening is everything before it
    const ranged = (await call(activity, { params: { id: String(cash._id) }, query: { startDate: "2026-03-03", endDate: "2026-03-31", limit: "50" } })).payload.data;
    expect(ranged).toMatchObject({ openingBalance: 800, closingBalance: 1160, count: 5 });
    expect(ranged.entries.at(-1).runningBalance).toBe(850);

    // the debit filter narrows the rows, never the balances
    const debits = (await call(activity, { params: { id: String(cash._id) }, query: { direction: "debit" } })).payload.data;
    expect(debits).toMatchObject({ count: 4, closingBalance: 1160 });
    expect(debits.entries.every((e) => e.direction === "debit" && e.runningBalance === null)).toBe(true);
  });

  it("names who posted each line, and gives a page past the end no rows", async () => {
    const { company, user, call } = await setup();
    const cash = await getAccountByCode(company._id, "1100");
    const day = new Date("2026-04-02T09:00:00Z");
    await postEntry({
      business: company._id, allowUnscoped: true, sourceTransactionType: "other", sourceTransactionId: "named",
      transactionDate: day, statementPeriodStart: day, statementPeriodEnd: day, category: "ADJUSTMENT",
      amount: 70, direction: "debit", accountId: cash._id, createdBy: user._id, notes: "Float top-up",
    });
    const d = (await call(activity, { params: { id: String(cash._id) } })).payload.data;
    expect(d.entries[0]).toMatchObject({ debit: 70, credit: 0, displayNarration: "Float top-up", runningBalance: 70 });
    const who = await User.findById(user._id).lean();
    expect(d.entries[0].createdByName).toBe(`${who.surname} ${who.otherNames}`.trim());
    const beyond = (await call(activity, { params: { id: String(cash._id) }, query: { page: "9" } })).payload.data;
    expect(beyond).toMatchObject({ count: 1, pages: 1, entries: [] });
  });
});
