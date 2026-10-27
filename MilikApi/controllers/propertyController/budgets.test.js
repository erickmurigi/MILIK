// No test coverage existed for Budgets before this file. Added alongside the Budget vs
// Actual page audit, which surfaced the same createdBy-cast bug already fixed once in
// fixedAssets.js: createBudget cast req.user?._id || req.user?.id straight into an
// ObjectId, crashing for system-admin sessions whose token id is a non-ObjectId string.
// Fixed by switching to currentUserId(req). Also added period-order validation (end
// before start was previously silently accepted on both create and update).
import { describe, it, expect } from "vitest";
import {
  getBudgets,
  getBudget,
  createBudget,
  updateBudget,
  deleteBudget,
} from "./budgets.js";
import { callController } from "../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../test/factories.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";

const setup = async () => {
  const company = await createTestCompany();
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const [expenseAccount] = await Promise.all([
    ChartOfAccount.create({ business: company._id, code: "5900", name: "Office Supplies", type: "expense", isPosting: true }),
  ]);
  return { company, user, expenseAccount };
};

const createBudgetReq = (ctx, overrides = {}) => callController(createBudget, {
  user: ctx.user,
  body: {
    name: "FY 2026 Annual",
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    lines: [{ account: String(ctx.expenseAccount._id), budgetedAmount: 12000 }],
    ...overrides,
  },
});

describe("budgets — create", () => {
  it("creates a draft budget without crashing for a system-admin session (regression for createdBy cast)", async () => {
    const ctx = await setup();
    const systemAdminUser = { ...ctx.user, id: "milik-admin", _id: undefined };

    const res = await callController(createBudget, {
      user: systemAdminUser,
      body: {
        name: "FY 2026 Annual",
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
        lines: [{ account: String(ctx.expenseAccount._id), budgetedAmount: 12000 }],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.payload.status).toBe("draft");
    expect(res.payload.createdBy).toBeFalsy();
  });

  it("rejects a period end before the period start", async () => {
    const ctx = await setup();
    await expect(createBudgetReq(ctx, { periodStart: "2026-06-01", periodEnd: "2026-01-01" }))
      .rejects.toThrow(/period end must be on or after/i);
  });

  it("denormalizes account code/name/type onto each line", async () => {
    const ctx = await setup();
    const res = await createBudgetReq(ctx);
    expect(res.payload.lines[0].accountCode).toBe("5900");
    expect(res.payload.lines[0].accountType).toBe("expense");
  });

  it("merges duplicate lines for the same account instead of creating two (would double-count budgeted against one shared actual)", async () => {
    const ctx = await setup();
    const res = await createBudgetReq(ctx, {
      lines: [
        { account: String(ctx.expenseAccount._id), budgetedAmount: 5000 },
        { account: String(ctx.expenseAccount._id), budgetedAmount: 3000 },
      ],
    });
    expect(res.payload.lines).toHaveLength(1);
    expect(res.payload.lines[0].budgetedAmount).toBe(8000);
  });

  it("drops a line referencing another company's account instead of keeping an orphaned reference", async () => {
    const ctx = await setup();
    const otherCompany = await createTestCompany();
    const foreignAccount = await ChartOfAccount.create({ business: otherCompany._id, code: "9999", name: "Foreign Account", type: "expense", isPosting: true });

    const res = await createBudgetReq(ctx, {
      lines: [
        { account: String(ctx.expenseAccount._id), budgetedAmount: 5000 },
        { account: String(foreignAccount._id), budgetedAmount: 1000 },
      ],
    });
    expect(res.payload.lines).toHaveLength(1);
    expect(res.payload.lines[0].accountCode).toBe("5900");
  });
});

describe("budgets — list + variance", () => {
  it("lists budgets with totalBudgeted and lineCount", async () => {
    const ctx = await setup();
    await createBudgetReq(ctx);

    const res = await callController(getBudgets, { user: ctx.user, query: { business: String(ctx.company._id) } });
    expect(res.payload).toHaveLength(1);
    expect(res.payload[0].totalBudgeted).toBe(12000);
    expect(res.payload[0].lineCount).toBe(1);
  });

  it("computes variance against actual GL postings (0 postings = fully unfavorable variance)", async () => {
    const ctx = await setup();
    const created = await createBudgetReq(ctx);

    const res = await callController(getBudget, { user: ctx.user, params: { id: created.payload._id } });
    expect(res.payload.lines[0].budgeted).toBe(12000);
    expect(res.payload.lines[0].actual).toBe(0);
    expect(res.payload.lines[0].variance).toBe(12000);
    expect(res.payload.lines[0].pctUsed).toBe(0);
  });

  it("picks up real GL postings against the budgeted account within the period (regression for the business-id not being cast to ObjectId in the aggregate match)", async () => {
    const ctx = await setup();
    const created = await createBudgetReq(ctx);

    await FinancialLedgerEntry.create({
      business: ctx.company._id,
      accountId: ctx.expenseAccount._id,
      sourceTransactionType: "expense",
      sourceTransactionId: "test-1",
      transactionDate: new Date("2026-03-15"),
      statementPeriodStart: new Date("2026-03-01"),
      statementPeriodEnd: new Date("2026-03-31"),
      category: "ADJUSTMENT",
      amount: 5000,
      direction: "debit",
      status: "approved",
    });

    const res = await callController(getBudget, { user: ctx.user, params: { id: created.payload._id } });
    expect(res.payload.lines[0].actual).toBe(5000);
    expect(res.payload.lines[0].variance).toBe(7000);
  });

  it("nets a reversed entry against its offsetting reversal entry to zero (regression for excluding status 'reversed')", async () => {
    const ctx = await setup();
    const created = await createBudgetReq(ctx);

    const original = await FinancialLedgerEntry.create({
      business: ctx.company._id,
      accountId: ctx.expenseAccount._id,
      sourceTransactionType: "expense",
      sourceTransactionId: "test-2",
      transactionDate: new Date("2026-04-10"),
      statementPeriodStart: new Date("2026-04-01"),
      statementPeriodEnd: new Date("2026-04-30"),
      category: "ADJUSTMENT",
      amount: 3000,
      direction: "debit",
      status: "reversed",
    });
    await FinancialLedgerEntry.create({
      business: ctx.company._id,
      accountId: ctx.expenseAccount._id,
      sourceTransactionType: "expense",
      sourceTransactionId: "test-2-reversal",
      transactionDate: new Date("2026-04-10"),
      statementPeriodStart: new Date("2026-04-01"),
      statementPeriodEnd: new Date("2026-04-30"),
      category: "REVERSAL",
      amount: 3000,
      direction: "credit",
      status: "approved",
      reversalOf: original._id,
    });

    const res = await callController(getBudget, { user: ctx.user, params: { id: created.payload._id } });
    expect(res.payload.lines[0].actual).toBe(0);
  });
});

describe("budgets — monthly spread", () => {
  it("recomputes budgetedAmount as the sum of monthlyAmounts, ignoring a client-sent flat total", async () => {
    const ctx = await setup();
    const res = await createBudgetReq(ctx, {
      lines: [{
        account: String(ctx.expenseAccount._id),
        budgetedAmount: 999999, // should be ignored/overwritten once monthlyAmounts is present
        monthlyAmounts: [
          { month: "2026-01", amount: 1000 },
          { month: "2026-02", amount: 2000 },
        ],
      }],
    });
    expect(res.payload.lines[0].budgetedAmount).toBe(3000);
    expect(res.payload.lines[0].monthlyAmounts).toHaveLength(2);
  });

  it("drops a month outside the budget's own period instead of erroring", async () => {
    const ctx = await setup();
    const res = await createBudgetReq(ctx, {
      lines: [{
        account: String(ctx.expenseAccount._id),
        monthlyAmounts: [
          { month: "2026-01", amount: 1000 },
          { month: "2027-06", amount: 5000 }, // outside Jan–Dec 2026
        ],
      }],
    });
    expect(res.payload.lines[0].monthlyAmounts).toHaveLength(1);
    expect(res.payload.lines[0].budgetedAmount).toBe(1000);
  });

  it("merges monthly amounts for duplicate account lines month-by-month", async () => {
    const ctx = await setup();
    const res = await createBudgetReq(ctx, {
      lines: [
        { account: String(ctx.expenseAccount._id), monthlyAmounts: [{ month: "2026-01", amount: 1000 }] },
        { account: String(ctx.expenseAccount._id), monthlyAmounts: [{ month: "2026-01", amount: 500 }, { month: "2026-02", amount: 700 }] },
      ],
    });
    expect(res.payload.lines).toHaveLength(1);
    const jan = res.payload.lines[0].monthlyAmounts.find((m) => m.month === "2026-01");
    expect(jan.amount).toBe(1500);
    expect(res.payload.lines[0].budgetedAmount).toBe(2200);
  });

  it("getBudget attaches per-month actual/variance alongside each month's budgeted amount", async () => {
    const ctx = await setup();
    const created = await createBudgetReq(ctx, {
      lines: [{
        account: String(ctx.expenseAccount._id),
        monthlyAmounts: [
          { month: "2026-01", amount: 1000 },
          { month: "2026-02", amount: 1000 },
        ],
      }],
    });

    await FinancialLedgerEntry.create({
      business: ctx.company._id,
      accountId: ctx.expenseAccount._id,
      sourceTransactionType: "expense",
      sourceTransactionId: "test-monthly-1",
      transactionDate: new Date("2026-01-20"),
      statementPeriodStart: new Date("2026-01-01"),
      statementPeriodEnd: new Date("2026-01-31"),
      category: "ADJUSTMENT",
      amount: 400,
      direction: "debit",
      status: "approved",
    });

    const res = await callController(getBudget, { user: ctx.user, params: { id: created.payload._id } });
    const monthly = res.payload.lines[0].monthly;
    const jan = monthly.find((m) => m.month === "2026-01");
    const feb = monthly.find((m) => m.month === "2026-02");
    expect(jan.budgeted).toBe(1000);
    expect(jan.actual).toBe(400);
    expect(jan.variance).toBe(600);
    expect(feb.actual).toBe(0);
    expect(feb.variance).toBe(1000);
  });
});

describe("budgets — update", () => {
  it("rejects editing a closed budget", async () => {
    const ctx = await setup();
    const created = await createBudgetReq(ctx);
    await callController(updateBudget, { user: ctx.user, params: { id: created.payload._id }, body: { status: "closed" } });

    await expect(callController(updateBudget, { user: ctx.user, params: { id: created.payload._id }, body: { name: "x" } }))
      .rejects.toThrow(/closed budgets cannot be edited/i);
  });

  it("rejects moving period end before period start on update", async () => {
    const ctx = await setup();
    const created = await createBudgetReq(ctx);

    await expect(callController(updateBudget, {
      user: ctx.user,
      params: { id: created.payload._id },
      body: { periodEnd: "2025-01-01" },
    })).rejects.toThrow(/period end must be on or after/i);
  });
});

describe("budgets — delete", () => {
  it("rejects deleting a non-draft budget", async () => {
    const ctx = await setup();
    const created = await createBudgetReq(ctx);
    await callController(updateBudget, { user: ctx.user, params: { id: created.payload._id }, body: { status: "active" } });

    await expect(callController(deleteBudget, { user: ctx.user, params: { id: created.payload._id } }))
      .rejects.toThrow(/only draft budgets can be deleted/i);
  });
});

describe("budgets — cross-tenant isolation", () => {
  it("getBudget/updateBudget/deleteBudget 404 for a different company's user", async () => {
    const ctx = await setup();
    const created = await createBudgetReq(ctx);
    const otherUser = await createTestUser({ company: await createTestCompany() });

    await expect(callController(getBudget, { user: otherUser, params: { id: created.payload._id } }))
      .rejects.toThrow(/not found/i);
    await expect(callController(updateBudget, { user: otherUser, params: { id: created.payload._id }, body: { name: "x" } }))
      .rejects.toThrow(/not found/i);
    await expect(callController(deleteBudget, { user: otherUser, params: { id: created.payload._id } }))
      .rejects.toThrow(/not found/i);
  });
});
