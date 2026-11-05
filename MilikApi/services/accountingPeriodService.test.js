// Accounting periods: a generated fiscal year, close/lock oldest first and reopen newest first with a
// reason, who did it recorded, and a year close that locks the year without touching the ledger.
// Also the Balance Sheet split of earnings at the fiscal-year start that replaces the closing journal.
import { describe, it, expect } from "vitest";
import {
  closeFiscalYear, closePeriod, createPeriod, endPostingWindow, openPostingWindow, generateFiscalYear, listPeriods, lockPeriod, reopenPeriod, yearCloseChecklist,
} from "./accountingPeriodService.js";
import { assertPeriodOpen, postEntry } from "./ledgerPostingService.js";
import { requestScopeMiddleware } from "../utils/requestScope.js";
import { getBalanceSheetReport, getTrialBalanceReport } from "../controllers/propertyController/financialReports.js";
import { callController } from "../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../test/factories.js";
import { getAccountByCode } from "../test/factories.financial.js";
import { dayStart, fiscalYearOf } from "../utils/fiscalPeriods.js";
import AccountingPeriod from "../models/AccountingPeriod.js";
import Company from "../models/Company.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";

const setup = async (fiscalStartMonth = "January") => {
  const company = await createTestCompany();
  await Company.updateOne({ _id: company._id }, { $set: { fiscalStartMonth } });
  const user = await createTestUser({ company, surname: "Wanjiru", otherNames: "Ann" });
  return { company, businessId: company._id, user: { id: String(user._id) } };
};

const byName = async (businessId, name) => AccountingPeriod.findOne({ business: businessId, name });

describe("fiscal period helpers", () => {
  it("uses East Africa days, so EAT-midnight and UTC-midnight dates land in the same period", () => {
    expect(dayStart("2026-10-01").toISOString()).toBe("2026-09-30T21:00:00.000Z");
    expect(fiscalYearOf("2026-03-15", 6)).toMatchObject({ label: "FY 2025/26", startYmd: "2025-07-01", endYmd: "2026-06-30" });
    expect(fiscalYearOf("2026-03-15", 0)).toMatchObject({ label: "FY 2026", startYmd: "2026-01-01", endYmd: "2026-12-31" });
  });
});

describe("accounting periods", { timeout: 120000 }, () => {
  it("generates twelve months from the fiscal start month and skips months already covered", async () => {
    const { businessId, user } = await setup("July");
    await createPeriod({ businessId, name: "Custom Aug", startDate: "2025-08-01", endDate: "2025-08-31", user });
    const result = await generateFiscalYear({ businessId, fiscalYearStart: "2025-07-01", user });
    expect(result).toMatchObject({ fiscalYear: "FY 2025/26", created: 11, skipped: 1 });

    const list = await listPeriods(businessId);
    const fy = list.fiscalYears.find((y) => y.key === "2025-07-01");
    expect(fy.periods).toHaveLength(12);
    expect(fy.periods[0].name).toBe("Jun 2026"); // newest first
    await expect(generateFiscalYear({ businessId, fiscalYearStart: "2025-07-01", user })).rejects.toMatchObject({ status: 409 });
  });

  it("won't close a period that hasn't ended, and still offers a partly covered year", async () => {
    const { businessId, user } = await setup();
    const now = new Date();
    const fy = fiscalYearOf(now, 0);
    const running = await createPeriod({ businessId, name: "Running", startDate: fy.startYmd, endDate: fy.endYmd.replace(/-\d{2}-\d{2}$/, "-12-31"), user });
    await expect(closePeriod({ businessId, id: running._id, user })).rejects.toMatchObject({ status: 409 });
    expect((await yearCloseChecklist({ businessId, fiscalYearStart: fy.key })).blockers.join(" ")).toMatch(/runs until/);

    await AccountingPeriod.deleteMany({ business: businessId });
    await createPeriod({ businessId, name: "Q4", startDate: `${fy.startYear}-10-01`, endDate: `${fy.startYear}-12-31`, user });
    const list = await listPeriods(businessId);
    expect(list.suggestions.find((s) => s.key === fy.key)).toMatchObject({ missing: 9 });
  });

  it("rejects a period overlapping a locked one", async () => {
    const { businessId, user } = await setup();
    const p = await createPeriod({ businessId, name: "Jan", startDate: "2026-01-01", endDate: "2026-01-31", user });
    await closePeriod({ businessId, id: p._id, user });
    await lockPeriod({ businessId, id: p._id, user });
    await expect(createPeriod({ businessId, name: "Clash", startDate: "2026-01-15", endDate: "2026-02-15", user })).rejects.toMatchObject({ status: 409 });
  });

  it("closes and locks oldest first, reopens newest first with a reason, and records who did it", async () => {
    const { businessId, user } = await setup();
    await generateFiscalYear({ businessId, fiscalYearStart: "2026-01-01", user });
    const jan = await byName(businessId, "Jan 2026");
    const feb = await byName(businessId, "Feb 2026");

    await expect(closePeriod({ businessId, id: feb._id, user })).rejects.toMatchObject({ status: 409 });
    await closePeriod({ businessId, id: jan._id, user });
    await closePeriod({ businessId, id: feb._id, user });

    await expect(reopenPeriod({ businessId, id: jan._id, reason: "wrong rent posted", user })).rejects.toMatchObject({ status: 409 });
    await expect(reopenPeriod({ businessId, id: feb._id, reason: "", user })).rejects.toMatchObject({ status: 400 });
    await reopenPeriod({ businessId, id: feb._id, reason: "late supplier invoice", user });

    await expect(lockPeriod({ businessId, id: feb._id, user })).rejects.toMatchObject({ status: 400 }); // open again
    await lockPeriod({ businessId, id: jan._id, user });

    const janAfter = await byName(businessId, "Jan 2026");
    expect(String(janAfter.closedBy)).toBe(user.id);
    expect(janAfter.history.map((h) => h.action)).toEqual(["created", "closed", "locked"]);
    expect(janAfter.history[1].byName).toBe("Wanjiru Ann");
    const febAfter = await byName(businessId, "Feb 2026");
    expect(febAfter.history.find((h) => h.action === "reopened").reason).toBe("late supplier invoice");
  });

  it("closes a fiscal year by locking its periods, posting nothing, and refuses a year with gaps", async () => {
    const { businessId, user } = await setup();
    await createPeriod({ businessId, name: "H1", startDate: "2025-01-01", endDate: "2025-06-30", user });
    const gapped = await yearCloseChecklist({ businessId, fiscalYearStart: "2025-01-01" });
    expect(gapped.blockers.join(" ")).toMatch(/2025-07-01 to 2025-12-31/);
    await expect(closeFiscalYear({ businessId, fiscalYearStart: "2025-01-01", user })).rejects.toMatchObject({ status: 409 });

    await createPeriod({ businessId, name: "H2", startDate: "2025-07-01", endDate: "2025-12-31", user });
    const before = await FinancialLedgerEntry.countDocuments({ business: businessId });
    const result = await closeFiscalYear({ businessId, fiscalYearStart: "2025-01-01", user });
    expect(result).toMatchObject({ fiscalYear: "FY 2025", locked: 2 });
    expect(await FinancialLedgerEntry.countDocuments({ business: businessId })).toBe(before);

    const periods = await AccountingPeriod.find({ business: businessId }).lean();
    expect(periods.every((p) => p.status === "locked" && p.yearEndClosed)).toBe(true);
    await expect(closeFiscalYear({ businessId, fiscalYearStart: "2025-01-01", user })).rejects.toMatchObject({ status: 409 });
  });

  it("splits Balance Sheet earnings into retained earnings and current-year earnings", async () => {
    const { company, businessId } = await setup();
    await createTestChartOfAccounts(businessId);
    const cash = await getAccountByCode(businessId, "1100");
    const income = await getAccountByCode(businessId, "4100");
    const post = (date, amount, id) => Promise.all([
      postEntry({ business: businessId, allowUnscoped: true, accountId: cash._id, direction: "debit", amount, sourceTransactionType: "rent_payment", sourceTransactionId: id, transactionDate: date, statementPeriodStart: date, statementPeriodEnd: date, category: "RENT_RECEIPT_MANAGER" }),
      postEntry({ business: businessId, allowUnscoped: true, accountId: income._id, direction: "credit", amount, sourceTransactionType: "rent_payment", sourceTransactionId: id, transactionDate: date, statementPeriodStart: date, statementPeriodEnd: date, category: "RENT_RECEIPT_MANAGER" }),
    ]);
    await post(new Date("2025-06-15T09:00:00Z"), 8000, "prior-year");
    await post(new Date("2026-03-15T09:00:00Z"), 5000, "this-year");

    const result = await callController(getBalanceSheetReport, {
      query: { business: String(businessId), asOfDate: "2026-06-30" },
      user: { company: company._id },
    });
    expect(result.statusCode).toBe(200);
    expect(result.payload.equity.retainedEarnings).toBe(8000);
    expect(result.payload.equity.currentPeriodEarnings).toBe(5000);
    expect(result.payload.summary.balanced).toBe(true);
  });

  it("a posting window lets only its user post into a closed period, and never into a locked one", async () => {
    const { businessId, user } = await setup();
    const other = await createTestUser({ company: { _id: businessId } });
    const period = await createPeriod({ businessId, name: "Mar 2025", startDate: "2025-03-01", endDate: "2025-03-31", user });
    await closePeriod({ businessId, id: period._id, user });
    const date = new Date("2025-03-10T09:00:00Z");
    const as = (who, fn) => requestScopeMiddleware({ user: who }, null, fn);

    await expect(as(user, () => assertPeriodOpen(businessId, date))).rejects.toMatchObject({ status: 400 });
    await expect(openPostingWindow({ businessId, id: period._id, minutes: 30, reason: "", user })).rejects.toMatchObject({ status: 400 });
    await openPostingWindow({ businessId, id: period._id, minutes: 30, reason: "late electricity bill", user });

    await expect(as(user, () => assertPeriodOpen(businessId, date))).resolves.toBeUndefined();
    await expect(as({ id: String(other._id) }, () => assertPeriodOpen(businessId, date))).rejects.toMatchObject({ status: 400 });
    await expect(assertPeriodOpen(businessId, date)).rejects.toMatchObject({ status: 400 }); // no request: crons, scripts

    await endPostingWindow({ businessId, id: period._id, user });
    await expect(as(user, () => assertPeriodOpen(businessId, date))).rejects.toMatchObject({ status: 400 });

    await openPostingWindow({ businessId, id: period._id, minutes: 15, reason: "one more correction", user });
    await lockPeriod({ businessId, id: period._id, user });
    await expect(as(user, () => assertPeriodOpen(businessId, date))).rejects.toMatchObject({ status: 400 });
    await expect(openPostingWindow({ businessId, id: period._id, minutes: 15, reason: "after the lock", user })).rejects.toMatchObject({ status: 400 });
  });

  it("Trial Balance shows this fiscal year's income and a Retained Earnings line for earlier years", async () => {
    const { company, businessId } = await setup();
    await createTestChartOfAccounts(businessId);
    const cash = await getAccountByCode(businessId, "1100");
    const income = await getAccountByCode(businessId, "4100");
    const post = (date, amount, id) => Promise.all([
      postEntry({ business: businessId, allowUnscoped: true, accountId: cash._id, direction: "debit", amount, sourceTransactionType: "rent_payment", sourceTransactionId: id, transactionDate: date, statementPeriodStart: date, statementPeriodEnd: date, category: "RENT_RECEIPT_MANAGER" }),
      postEntry({ business: businessId, allowUnscoped: true, accountId: income._id, direction: "credit", amount, sourceTransactionType: "rent_payment", sourceTransactionId: id, transactionDate: date, statementPeriodStart: date, statementPeriodEnd: date, category: "RENT_RECEIPT_MANAGER" }),
    ]);
    await post(new Date("2025-06-15T09:00:00Z"), 8000, "tb-prior");
    await post(new Date("2026-03-15T09:00:00Z"), 5000, "tb-this");

    const result = await callController(getTrialBalanceReport, {
      query: { business: String(businessId), asOfDate: "2026-06-30" },
      user: { company: company._id },
    });
    expect(result.statusCode).toBe(200);
    expect(result.payload.rows.find((r) => r.code === "4100").netBalance).toBe(5000);
    expect(result.payload.rows.find((r) => r.code === "RE")).toMatchObject({ creditBalance: 8000, isComputed: true });
    expect(result.payload.rows.find((r) => r.code === "1100").netBalance).toBe(13000);
    expect(result.payload.totals.balanced).toBe(true);
  });
});
