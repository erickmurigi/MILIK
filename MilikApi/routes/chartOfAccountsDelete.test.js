// Deleting a chart account that has history only switches it off. It must not switch off accounts still holding money or
// accounts Milik posts to, and it must be possible to switch one back on.
import { describe, it, expect } from "vitest";
import router from "./chartOfAccounts.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import { postEntry } from "../services/ledgerPostingService.js";
import { callController } from "../test/callController.js";
import { routeHandler } from "../test/routeHandler.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../test/factories.js";
import { getAccountByCode } from "../test/factories.financial.js";

const remove = routeHandler(router, "delete", "/:id");
const reactivate = routeHandler(router, "post", "/:id/reactivate");

const post = (company, account, direction, amount) => postEntry({
  business: company._id, allowUnscoped: true, sourceTransactionType: "other", sourceTransactionId: String(account._id),
  transactionDate: new Date(), statementPeriodStart: new Date(), statementPeriodEnd: new Date(), category: "ADJUSTMENT",
  amount, direction, accountId: account._id, payer: "n/a", receiver: "n/a",
});

const setup = async () => {
  const company = await createTestCompany({ modules: { accounts: true } });
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const call = (fn, id) => callController(fn, { user, params: { id: String(id) }, query: { business: String(company._id) } });
  return { company, call };
};

describe("deleting chart accounts that have history", () => {
  it("refuses a system account, and one that still has a balance, with the reason", async () => {
    const { company, call } = await setup();
    const mpesa = await getAccountByCode(company._id, "1130");
    await post(company, mpesa, "debit", 500);
    let res = await call(remove, mpesa._id).then((r) => r, (e) => e);
    expect(res.statusCode ?? res.status).toBe(400);
    expect(JSON.stringify(res.payload ?? res.message)).toMatch(/system account/i);
    expect((await ChartOfAccount.findById(mpesa._id)).isActive).not.toBe(false);

    const expense = await getAccountByCode(company._id, "5200");
    await ChartOfAccount.updateOne({ _id: expense._id }, { $set: { isSystem: false } });
    await post(company, expense, "debit", 300);
    res = await call(remove, expense._id);
    expect(res.statusCode).toBe(400);
    expect(res.payload.error).toMatch(/still has a balance of 300/);
    expect((await ChartOfAccount.findById(expense._id)).isActive).not.toBe(false);
  });

  it("deactivates a settled account and lets it be reactivated", async () => {
    const { company, call } = await setup();
    const expense = await getAccountByCode(company._id, "5200");
    await ChartOfAccount.updateOne({ _id: expense._id }, { $set: { isSystem: false } });
    await post(company, expense, "debit", 300);
    await post(company, expense, "credit", 300);

    const removed = await call(remove, expense._id);
    expect(removed.payload.softDeleted).toBe(true);
    expect((await ChartOfAccount.findById(expense._id)).isActive).toBe(false);

    const again = await call(reactivate, expense._id);
    expect(again.statusCode).toBe(200);
    const row = await ChartOfAccount.findById(expense._id);
    expect(row.isActive).toBe(true);
    expect(row.deletedAt).toBeNull();
    expect((await call(reactivate, expense._id)).statusCode).toBe(400); // already active
    await post(company, expense, "debit", 10); // takes postings again
  });
});
