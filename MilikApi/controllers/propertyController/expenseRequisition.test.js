// Coverage for the budget-awareness + amount-based approval tier added to Expense Requisitions:
// - A requisition carries a real expenseAccount (ChartOfAccount ref) instead of only a loose
//   category, so it can be matched against Budget's account-keyed lines.
// - Approving snapshots a budgetCheck (budgeted/committed/actual/available) and requires an
//   approvalOverrideNote when the requisition would exceed available budget — advisory, not a
//   hard block.
// - Above a company-configured expenseApprovalThreshold, approval requires the separate
//   expenses.approveHighValue permission on top of the base expenses.approve.
import { describe, it, expect } from "vitest";
import {
  createExpenseRequisition,
  updateExpenseRequisitionStatus,
} from "./expenseRequisition.js";
import { callController } from "../../test/callController.js";
import {
  createTestCompany,
  createTestChartOfAccounts,
  createTestUser,
  createTestCompanySettings,
} from "../../test/factories.js";
import { createTestProperty } from "../../test/factories.js";
import Budget from "../../models/Budget.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
// Side-effect import: populateQuery() populates "linkedVoucher" (ref: "PaymentVoucher"), and
// Mongoose only registers a ref'd model's schema if something in the loaded module graph actually
// imports it — unlike production, where every route file's imports register every model at startup.
import "../../models/PaymentVoucher.js";

const setup = async () => {
  const company = await createTestCompany();
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const { property } = await createTestProperty({ company });
  const expenseAccount = await ChartOfAccount.create({
    business: company._id,
    code: "5901",
    name: "Repairs & Maintenance",
    type: "expense",
    isPosting: true,
  });
  return { company, user, property, expenseAccount };
};

const createRequisitionReq = (ctx, overrides = {}) =>
  callController(createExpenseRequisition, {
    user: ctx.user,
    body: {
      title: "Roof repair",
      property: String(ctx.property._id),
      amount: 5000,
      expenseAccount: String(ctx.expenseAccount._id),
      status: "submitted",
      ...overrides,
    },
  });

const activeBudget = async (ctx, { budgetedAmount = 10000, monthlyAmounts } = {}) =>
  Budget.create({
    business: ctx.company._id,
    name: "FY Active",
    periodStart: new Date(new Date().getFullYear(), 0, 1),
    periodEnd: new Date(new Date().getFullYear(), 11, 31),
    status: "active",
    lines: [
      {
        account: ctx.expenseAccount._id,
        accountCode: ctx.expenseAccount.code,
        accountName: ctx.expenseAccount.name,
        accountType: "expense",
        budgetedAmount,
        ...(monthlyAmounts ? { monthlyAmounts } : {}),
      },
    ],
  });

describe("expense requisition — budget headroom check", () => {
  it("stores no budgetCheck when no active budget covers the account (advisory-skip, not overBudget)", async () => {
    const ctx = await setup();
    const res = await createRequisitionReq(ctx);
    expect(res.payload.budgetCheck?.checkedAt).toBeFalsy();
  });

  it("snapshots an available, non-overBudget check on submit when within budget", async () => {
    const ctx = await setup();
    await activeBudget(ctx, { budgetedAmount: 10000 });

    const res = await createRequisitionReq(ctx, { amount: 3000 });
    expect(res.payload.budgetCheck.budgeted).toBe(10000);
    expect(res.payload.budgetCheck.available).toBe(10000);
    expect(res.payload.budgetCheck.overBudget).toBe(false);
  });

  it("flags overBudget on submit but does not block the submission itself", async () => {
    const ctx = await setup();
    await activeBudget(ctx, { budgetedAmount: 1000 });

    const res = await createRequisitionReq(ctx, { amount: 5000 });
    expect(res.statusCode).toBe(201);
    expect(res.payload.budgetCheck.overBudget).toBe(true);
    expect(res.payload.budgetCheck.available).toBe(1000);
  });

  it("counts other submitted/approved requisitions against the same account as committed", async () => {
    const ctx = await setup();
    await activeBudget(ctx, { budgetedAmount: 10000 });

    await createRequisitionReq(ctx, { amount: 4000 });
    const second = await createRequisitionReq(ctx, { amount: 3000 });

    // 10000 budgeted - 4000 already committed (the first requisition) = 6000 available
    expect(second.payload.budgetCheck.available).toBe(6000);
  });

  it("rejects approval without an override note when the requisition is over budget", async () => {
    const ctx = await setup();
    await activeBudget(ctx, { budgetedAmount: 1000 });
    const created = await createRequisitionReq(ctx, { amount: 5000 });

    await expect(
      callController(updateExpenseRequisitionStatus, {
        user: ctx.user,
        params: { id: created.payload._id },
        body: { status: "approved" },
      })
    ).rejects.toThrow(/approval override note is required/i);
  });

  it("approves an over-budget requisition once an override note is supplied, recording it", async () => {
    const ctx = await setup();
    await activeBudget(ctx, { budgetedAmount: 1000 });
    const created = await createRequisitionReq(ctx, { amount: 5000 });

    const res = await callController(updateExpenseRequisitionStatus, {
      user: ctx.user,
      params: { id: created.payload._id },
      body: { status: "approved", approvalOverrideNote: "Emergency roof leak, approved anyway" },
    });

    expect(res.payload.status).toBe("approved");
    expect(res.payload.approvalOverrideNote).toBe("Emergency roof leak, approved anyway");
    expect(res.payload.budgetCheck.overBudget).toBe(true);
  });

  it("approves normally with no override note required when within budget", async () => {
    const ctx = await setup();
    await activeBudget(ctx, { budgetedAmount: 10000 });
    const created = await createRequisitionReq(ctx, { amount: 3000 });

    const res = await callController(updateExpenseRequisitionStatus, {
      user: ctx.user,
      params: { id: created.payload._id },
      body: { status: "approved" },
    });
    expect(res.payload.status).toBe("approved");
    expect(res.payload.budgetCheck.overBudget).toBe(false);
  });

  it("matches the specific month's spread, not the whole period, when the line has a monthly breakdown", async () => {
    const ctx = await setup();
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    await activeBudget(ctx, {
      budgetedAmount: 12000,
      monthlyAmounts: [{ month: thisMonth, amount: 500 }],
    });

    const res = await createRequisitionReq(ctx, { amount: 2000 });
    // Only this month's 500 spread counts, not the full-period 12000.
    expect(res.payload.budgetCheck.budgeted).toBe(500);
    expect(res.payload.budgetCheck.overBudget).toBe(true);
  });
});

describe("expense requisition — amount-based approval tier", () => {
  it("allows approval under the threshold with only the base approve permission", async () => {
    const ctx = await setup();
    await createTestCompanySettings({ company: ctx.company, expenseApprovalThreshold: 2000 });
    const created = await createRequisitionReq(ctx, { amount: 1000 });

    const approver = { ...ctx.user, adminAccess: false, permissions: { expenses: { approve: true } } };
    const res = await callController(updateExpenseRequisitionStatus, {
      user: approver,
      params: { id: created.payload._id },
      body: { status: "approved" },
    });
    expect(res.payload.status).toBe("approved");
  });

  it("rejects approval above the threshold without expenses.approveHighValue", async () => {
    const ctx = await setup();
    await createTestCompanySettings({ company: ctx.company, expenseApprovalThreshold: 2000 });
    const created = await createRequisitionReq(ctx, { amount: 5000 });

    const approver = { ...ctx.user, adminAccess: false, permissions: { expenses: { approve: true } } };
    await expect(
      callController(updateExpenseRequisitionStatus, {
        user: approver,
        params: { id: created.payload._id },
        body: { status: "approved" },
      })
    ).rejects.toThrow(/high-value approval threshold/i);
  });

  it("allows approval above the threshold with expenses.approveHighValue granted", async () => {
    const ctx = await setup();
    await createTestCompanySettings({ company: ctx.company, expenseApprovalThreshold: 2000 });
    const created = await createRequisitionReq(ctx, { amount: 5000 });

    const seniorApprover = {
      ...ctx.user,
      adminAccess: false,
      permissions: { expenses: { approve: true, approveHighValue: true } },
    };
    const res = await callController(updateExpenseRequisitionStatus, {
      user: seniorApprover,
      params: { id: created.payload._id },
      body: { status: "approved" },
    });
    expect(res.payload.status).toBe("approved");
  });

  it("does not tier approvals at all when no threshold is configured (default, backward-compatible)", async () => {
    const ctx = await setup();
    const created = await createRequisitionReq(ctx, { amount: 999999 });

    const approver = { ...ctx.user, adminAccess: false, permissions: { expenses: { approve: true } } };
    const res = await callController(updateExpenseRequisitionStatus, {
      user: approver,
      params: { id: created.payload._id },
      body: { status: "approved" },
    });
    expect(res.payload.status).toBe("approved");
  });
});
