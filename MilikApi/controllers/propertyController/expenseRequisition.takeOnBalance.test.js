// Coverage for vendor take-on (opening) balances: createVendorTakeOnBalance records what a
// vendor was already owed before being onboarded here. It mirrors the tenant take-on balance
// pattern (flag an existing document type, reuse its normal GL posting + lifecycle) rather than
// introducing a new model — an ExpenseRequisition created pre-approved, with no property required,
// that posts the same accrual GL entry a normal approval would.
import { describe, it, expect } from "vitest";
import {
  createVendorTakeOnBalance,
  createExpenseRequisition,
  updateExpenseRequisitionStatus,
  deleteExpenseRequisition,
} from "./expenseRequisition.js";
import { callController } from "../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser, createTestProperty } from "../../test/factories.js";
import ServiceProvider from "../../models/ServiceProvider.js";
import ExpenseRequisition from "../../models/ExpenseRequisition.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import Budget from "../../models/Budget.js";
import { getServiceProviders } from "./serviceProviders.js";
// Side-effect import, same reason as expenseRequisition.test.js: populateQuery() needs the
// PaymentVoucher schema registered for its "linkedVoucher" populate.
import "../../models/PaymentVoucher.js";

const setup = async () => {
  const company = await createTestCompany();
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const provider = await ServiceProvider.create({ business: company._id, providerCode: "SP0001", name: "Legacy Contractor Ltd" });
  const expenseAccount = await ChartOfAccount.create({
    business: company._id, code: "5901", name: "Repairs & Maintenance", type: "expense", isPosting: true,
  });
  return { company, user, provider, expenseAccount };
};

describe("vendor take-on balance — create", () => {
  it("creates an approved, pre-posted requisition with no property required", async () => {
    const ctx = await setup();
    const res = await callController(createVendorTakeOnBalance, {
      user: ctx.user,
      body: { serviceProvider: String(ctx.provider._id), amount: 15000, expenseAccount: String(ctx.expenseAccount._id), effectiveDate: "2026-01-01" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.payload.status).toBe("approved");
    expect(res.payload.isTakeOnBalance).toBe(true);
    expect(res.payload.property).toBeFalsy();
    expect(res.payload.title).toMatch(/Opening Balance/i);
  });

  it("posts the same accrual GL entries a normal approval would", async () => {
    const ctx = await setup();
    const res = await callController(createVendorTakeOnBalance, {
      user: ctx.user,
      body: { serviceProvider: String(ctx.provider._id), amount: 8000, expenseAccount: String(ctx.expenseAccount._id), effectiveDate: "2026-01-01" },
    });
    const entries = await FinancialLedgerEntry.find({ business: ctx.company._id, sourceTransactionType: "expense_requisition", sourceTransactionId: String(res.payload._id) }).lean();
    expect(entries).toHaveLength(2);
    const liabilityLeg = entries.find((e) => e.metadata?.postingRole === "ap_invoice_liability");
    expect(liabilityLeg.credit).toBe(8000);
  });

  it("surfaces in the vendor's Outstanding balance immediately", async () => {
    const ctx = await setup();
    await callController(createVendorTakeOnBalance, {
      user: ctx.user,
      body: { serviceProvider: String(ctx.provider._id), amount: 5000, expenseAccount: String(ctx.expenseAccount._id), effectiveDate: "2026-01-01" },
    });
    const listed = await callController(getServiceProviders, { user: ctx.user, query: {} });
    const row = listed.payload.data.find((r) => String(r._id) === String(ctx.provider._id));
    expect(row.outstanding).toBe(5000);
  });

  it("rejects a missing service provider", async () => {
    const ctx = await setup();
    await expect(
      callController(createVendorTakeOnBalance, { user: ctx.user, body: { amount: 1000, expenseAccount: String(ctx.expenseAccount._id) } })
    ).rejects.toThrow(/service provider is required/i);
  });

  it("rejects an invalid amount", async () => {
    const ctx = await setup();
    await expect(
      callController(createVendorTakeOnBalance, { user: ctx.user, body: { serviceProvider: String(ctx.provider._id), amount: 0, expenseAccount: String(ctx.expenseAccount._id) } })
    ).rejects.toThrow(/valid opening balance amount/i);
  });

  it("rejects a future effective date", async () => {
    const ctx = await setup();
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    await expect(
      callController(createVendorTakeOnBalance, {
        user: ctx.user,
        body: { serviceProvider: String(ctx.provider._id), amount: 1000, expenseAccount: String(ctx.expenseAccount._id), effectiveDate: future.toISOString() },
      })
    ).rejects.toThrow(/cannot be in the future/i);
  });
});

describe("vendor take-on balance — budget isolation", () => {
  it("does not count toward committed budget for a new requisition against the same account", async () => {
    const ctx = await setup();
    const now = new Date();
    await Budget.create({
      business: ctx.company._id,
      name: "FY Active",
      periodStart: new Date(now.getFullYear(), 0, 1),
      periodEnd: new Date(now.getFullYear(), 11, 31),
      status: "active",
      lines: [{ account: ctx.expenseAccount._id, accountCode: ctx.expenseAccount.code, accountName: ctx.expenseAccount.name, accountType: "expense", budgetedAmount: 10000 }],
    });
    // A large historical take-on balance dated this year, against the same account/budget period.
    await callController(createVendorTakeOnBalance, {
      user: ctx.user,
      body: { serviceProvider: String(ctx.provider._id), amount: 9000, expenseAccount: String(ctx.expenseAccount._id), effectiveDate: now.toISOString() },
    });

    const { property } = await createTestProperty({ company: ctx.company });
    const res = await callController(createExpenseRequisition, {
      user: ctx.user,
      body: { title: "New repair", property: String(property._id), amount: 3000, expenseAccount: String(ctx.expenseAccount._id), status: "submitted" },
    });
    // Full 10000 still available — the take-on's 9000 is historical, not a new commitment.
    expect(res.payload.budgetCheck.available).toBe(10000);
  });
});

describe("vendor take-on balance — correction lifecycle", () => {
  it("can be cancelled (reversing the GL entry) then deleted, like any other requisition", async () => {
    const ctx = await setup();
    const created = await callController(createVendorTakeOnBalance, {
      user: ctx.user,
      body: { serviceProvider: String(ctx.provider._id), amount: 4000, expenseAccount: String(ctx.expenseAccount._id), effectiveDate: "2026-01-01" },
    });

    await callController(updateExpenseRequisitionStatus, {
      user: ctx.user,
      params: { id: created.payload._id },
      body: { status: "cancelled", reason: "Entered in error" },
    });

    // The two original accrual legs flip to "reversed"; postReversal also posts a fresh pair of
    // offsetting entries (status "approved") to net the balance — only the originals (reversalOf:
    // null) are expected to be "reversed".
    const originalEntries = await FinancialLedgerEntry.find({ business: ctx.company._id, sourceTransactionType: "expense_requisition", sourceTransactionId: String(created.payload._id), reversalOf: null }).lean();
    expect(originalEntries).toHaveLength(2);
    expect(originalEntries.every((e) => e.status === "reversed")).toBe(true);

    const deleted = await callController(deleteExpenseRequisition, { user: ctx.user, params: { id: created.payload._id } });
    expect(deleted.payload.success).toBe(true);
    expect(await ExpenseRequisition.findById(created.payload._id)).toBeNull();
  });
});
