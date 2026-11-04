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
import ServiceProvider from "../../models/ServiceProvider.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import ExpenseRequisition from "../../models/ExpenseRequisition.js";
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

// Regression coverage for the same ghost-write failure mode already fixed today in tenant invoice
// deletion, WHT/VAT remittance, Journal Entry posting/reversal and Fixed Asset disposal: a
// multi-leg GL operation posted/reversed with sequential, non-transactional postEntry/postReversal
// calls is vulnerable to a ghost write (an insert commits on the server while the driver's write
// acknowledgment is lost, so the call still throws) — leaving a permanently orphaned, one-sided
// ledger entry behind with no way to clean it up. Both postRequisitionAccrualGL (approval) and
// reverseRequisitionAccrualGL (cancellation) are now wrapped in one Mongo transaction each,
// including the requisition document's own status/audit save, so either everything commits
// together or nothing is left behind at all.
describe("expense requisition — GL posting/reversal transaction atomicity", () => {
  const setupWithProvider = async () => {
    const company = await createTestCompany();
    await createTestChartOfAccounts(company._id);
    const user = await createTestUser({ company });
    const { property } = await createTestProperty({ company });
    const provider = await ServiceProvider.create({
      business: company._id,
      providerCode: "SP9001",
      name: "Atomicity Test Vendor",
    });
    const expenseAccount = await ChartOfAccount.create({
      business: company._id,
      code: "5902",
      name: "Atomicity Test Expense",
      type: "expense",
      isPosting: true,
    });
    return { company, user, property, provider, expenseAccount };
  };

  it("rolls back both legs and the requisition's own approval, leaving no orphaned entry, if the AP leg's postEntry fails mid-approve", async () => {
    const ctx = await setupWithProvider();
    const created = await callController(createExpenseRequisition, {
      user: ctx.user,
      body: {
        title: "Plumbing repair",
        property: String(ctx.property._id),
        serviceProvider: String(ctx.provider._id),
        amount: 7000,
        expenseAccount: String(ctx.expenseAccount._id),
        status: "submitted",
      },
    });

    // Force the CREDIT (AP) leg's postEntry to fail deterministically, AFTER the debit (expense)
    // leg's own postEntry has already run inside the transaction. postRequisitionAccrualGL
    // resolves both accounts up front (a query that doesn't filter on isActive), so deleting the
    // AP account outright would make that resolution itself return null and skip GL posting
    // entirely — not what this test is after. Marking it inactive instead lets resolution still
    // find it, but postEntry's own validatePostingAccount check (which DOES reject an inactive
    // account, with no allowInactiveAccount bypass on a forward post) throws for that second leg.
    // Before the fix, this left a real, orphaned, un-reversed debit leg behind: the old catch
    // block only ever reversed the DEBIT leg, which can't help when it's the CREDIT leg itself
    // that fails to post.
    const apAccount = await ChartOfAccount.findOne({ business: ctx.company._id, code: "2120" });
    expect(apAccount).toBeTruthy();
    await ChartOfAccount.updateOne({ _id: apAccount._id }, { $set: { isActive: false } });

    await expect(
      callController(updateExpenseRequisitionStatus, {
        user: ctx.user,
        params: { id: created.payload._id },
        body: { status: "approved" },
      })
    ).rejects.toThrow();

    // The whole approval failed, so the requisition must still be untouched — still submitted.
    const reloaded = await ExpenseRequisition.findById(created.payload._id).lean();
    expect(reloaded.status).toBe("submitted");
    expect(reloaded.approvedAt).toBeFalsy();
    expect(reloaded.approvedBy).toBeFalsy();

    // No orphaned debit leg may survive from the otherwise-successful first insert.
    const entries = await FinancialLedgerEntry.find({
      business: ctx.company._id,
      sourceTransactionType: "expense_requisition",
      sourceTransactionId: String(created.payload._id),
    }).lean();
    expect(entries).toHaveLength(0);
  });

  it("rolls back every leg's reversal and the requisition's own cancellation, leaving no orphaned entry, if a later leg's reversal fails mid-cancel", async () => {
    const ctx = await setupWithProvider();
    const created = await callController(createExpenseRequisition, {
      user: ctx.user,
      body: {
        title: "Electrical repair",
        property: String(ctx.property._id),
        serviceProvider: String(ctx.provider._id),
        amount: 4200,
        expenseAccount: String(ctx.expenseAccount._id),
        status: "submitted",
      },
    });

    await callController(updateExpenseRequisitionStatus, {
      user: ctx.user,
      params: { id: created.payload._id },
      body: { status: "approved" },
    });

    const originalEntries = await FinancialLedgerEntry.find({
      business: ctx.company._id,
      sourceTransactionType: "expense_requisition",
      sourceTransactionId: String(created.payload._id),
      status: "approved",
      reversalOf: null,
    }).lean();
    expect(originalEntries).toHaveLength(2);

    // Force the SECOND leg's reversal to fail deterministically, after the first leg's reversal
    // has already been posted inside the transaction — by deleting its posting account outright,
    // so postEntry's own account-existence check throws (this check has no allowInactiveAccount
    // bypass, unlike the active/inactive check reversals otherwise skip).
    const secondLegAccountId = originalEntries[1].accountId;
    await ChartOfAccount.deleteOne({ _id: secondLegAccountId });

    await expect(
      callController(updateExpenseRequisitionStatus, {
        user: ctx.user,
        params: { id: created.payload._id },
        body: { status: "cancelled", reason: "Testing rollback on mid-reverse failure" },
      })
    ).rejects.toThrow();

    // The whole cancellation failed, so the requisition itself must still be untouched — still
    // approved, never flipped to cancelled.
    const reloaded = await ExpenseRequisition.findById(created.payload._id).lean();
    expect(reloaded.status).toBe("approved");
    expect(reloaded.cancelledAt).toBeFalsy();

    // Neither original leg may be left half-reversed.
    const reloadedOriginalEntries = await FinancialLedgerEntry.find({
      business: ctx.company._id,
      sourceTransactionType: "expense_requisition",
      sourceTransactionId: String(created.payload._id),
      reversalOf: null,
    }).lean();
    reloadedOriginalEntries.forEach((entry) => {
      expect(entry.status).toBe("approved");
      expect(entry.reversedByEntry).toBeFalsy();
    });

    // And no orphaned REVERSAL document may survive from the first leg's otherwise-successful
    // insert — the exact shape of the production bug already fixed today in the journal/invoice
    // reversal loops, here for the expense requisition cancellation loop.
    const reversalEntries = await FinancialLedgerEntry.find({
      business: ctx.company._id,
      category: "REVERSAL",
      reversalOf: originalEntries[0]._id,
    }).lean();
    expect(reversalEntries).toHaveLength(0);
  });
});
