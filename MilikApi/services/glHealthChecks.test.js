// GL Health Centre: contra accounts are never "abnormal" or cleared, balance sides are spelled out,
// and sub-ledgers / stored balances / late postings into closed periods are reported.
import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { runIntegrityReport, repairClearAbnormalBalance } from "../controllers/propertyController/ledgerDiagnostics.js";
import { postEntry } from "./ledgerPostingService.js";
import { callController } from "../test/callController.js";
import { createTestCompany, createTestChartOfAccounts } from "../test/factories.js";
import { getAccountByCode } from "../test/factories.financial.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import PettyCashAccount from "../models/PettyCashAccount.js";
import AccountingPeriod from "../models/AccountingPeriod.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";

const pair = (business, debitAccount, creditAccount, amount, date = new Date("2026-02-10T09:00:00Z"), id = `hc-${Math.random()}`) => {
  const common = {
    business, allowUnscoped: true, amount, sourceTransactionType: "manual_adjustment", sourceTransactionId: id,
    transactionDate: date, statementPeriodStart: date, statementPeriodEnd: date, category: "ADJUSTMENT",
    journalGroupId: new mongoose.Types.ObjectId(),
  };
  return Promise.all([
    postEntry({ ...common, accountId: debitAccount._id, direction: "debit" }),
    postEntry({ ...common, accountId: creditAccount._id, direction: "credit" }),
  ]);
};

const setup = async () => {
  const company = await createTestCompany();
  await createTestChartOfAccounts(company._id);
  const cash = await getAccountByCode(company._id, "1100");
  const income = await getAccountByCode(company._id, "4100");
  const accumulated = await ChartOfAccount.create({ business: company._id, code: "1316", name: "Accumulated Depreciation", type: "asset", group: "assets", isPosting: true });
  const expense = await getAccountByCode(company._id, "5100");
  return { company, cash, income, accumulated, expense };
};

const runReport = async (company) => {
  const result = await callController(runIntegrityReport, { user: { company: company._id, id: "milik-admin", isSystemAdmin: true } });
  expect(result.statusCode).toBe(200);
  return result.payload;
};

describe("GL health checks", { timeout: 120000 }, () => {
  it("leaves contra accounts out of abnormal balances and refuses to clear them", async () => {
    const { company, accumulated, expense, cash } = await setup();
    await pair(company._id, expense, accumulated, 8100); // depreciation: Cr accumulated depreciation
    await pair(company._id, cash, expense, 4500);        // expense account pushed to a credit balance

    const report = await runReport(company);
    const codes = report.detail.abnormalBalances.map((a) => a.code);
    expect(codes).not.toContain("1316");
    expect(report.detail.abnormalBalances.find((a) => a.code === "5100")).toBeUndefined(); // 8100 Dr - 4500 Cr stays debit
    expect(report.healthRunId).toBeTruthy(); // the built-in admin's run is saved

    const refused = await callController(repairClearAbnormalBalance, {
      user: { company: company._id, id: "milik-admin", isSystemAdmin: true },
      body: { accountId: String(accumulated._id), offsetAccountId: String(cash._id), notes: "tidy the balance" },
    }).catch((e) => e);
    expect(refused.status).toBe(400);
  });

  it("spells out the side of an abnormal balance", async () => {
    const { company, cash, income } = await setup();
    await pair(company._id, income, cash, 3000); // income account with a debit balance
    const row = (await runReport(company)).detail.abnormalBalances.find((a) => a.code === "4100");
    expect(row).toMatchObject({ side: "Dr", amount: 3000 });
  });

  it("reports a petty cash box that disagrees with its GL account, stale stored balances, and late postings into closed periods", async () => {
    const { company, cash, income } = await setup();
    await PettyCashAccount.create({ business: company._id, name: "Front desk", glAccountId: cash._id, currentBalance: 500, floatAmount: 1000 });
    await pair(company._id, cash, income, 2000);
    await ChartOfAccount.updateOne({ _id: cash._id }, { $set: { balance: 999 } });

    await AccountingPeriod.create({
      business: company._id, name: "Feb 2026", status: "closed", closedAt: new Date(),
      startDate: new Date("2026-02-01T00:00:00Z"), endDate: new Date("2026-02-28T23:59:59Z"),
    });
    // a row written straight to the ledger after the close, bypassing the period check
    await FinancialLedgerEntry.collection.insertOne({
      business: company._id, accountId: cash._id, debit: 10, credit: 0, amount: 10, direction: "debit", status: "approved",
      transactionDate: new Date("2026-02-15T09:00:00Z"), createdAt: new Date(), sourceTransactionType: "manual_adjustment", sourceTransactionId: "late",
    });

    const { detail, issues } = await runReport(company);
    const petty = detail.reconciliations.find((r) => r.key.startsWith("petty-"));
    expect(petty).toMatchObject({ subledger: 500, gl: 2010, difference: 1510 });
    expect(detail.storedBalanceMismatches.find((m) => m.code === "1100")).toMatchObject({ stored: 999 });
    expect(detail.closedPeriodPostings[0]).toMatchObject({ name: "Feb 2026", entries: 1 });
    expect(issues.map((i) => i.issue).join(" ")).toMatch(/sub-ledger/);
  });
});
