// Coverage for the Service Provider list/delete improvements:
// - getServiceProviders now attaches a per-row `outstanding` balance (invoiced - paid), computed
//   only for the page being returned so it stays cheap regardless of how many providers exist.
// - deleteServiceProvider now refuses to hard-delete a provider that has linked requisitions,
//   vouchers or ledger entries (it would silently orphan those references) — it should be marked
//   inactive instead.
// - create/updateServiceProvider now accept+validate a defaultExpenseAccount (pre-fills, never
//   forces, the GL account on a new requisition/voucher for this vendor) and surface
//   non-blocking duplicateWarnings when a KRA PIN/bank account/paybill/M-Pesa number already
//   belongs to another provider on file — the classic fake-vendor fraud signature.
import { describe, it, expect } from "vitest";
import {
  createServiceProvider,
  updateServiceProvider,
  getServiceProviders,
  deleteServiceProvider,
} from "./serviceProviders.js";
import { callController } from "../../test/callController.js";
import { createTestCompany, createTestUser, createTestProperty, createTestChartOfAccounts } from "../../test/factories.js";
import ServiceProvider from "../../models/ServiceProvider.js";
import ExpenseRequisition from "../../models/ExpenseRequisition.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";

const setup = async () => {
  const company = await createTestCompany();
  const user = await createTestUser({ company });
  const { property } = await createTestProperty({ company });
  return { company, user, property };
};

const ledgerEntry = (ctx, provider, overrides = {}) => {
  const now = new Date();
  return FinancialLedgerEntry.create({
    business: ctx.company._id,
    serviceProvider: provider._id,
    sourceTransactionType: "expense_requisition",
    sourceTransactionId: String(provider._id),
    transactionDate: now,
    statementPeriodStart: new Date(now.getFullYear(), now.getMonth(), 1),
    statementPeriodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0),
    category: "EXPENSE_DEDUCTION",
    amount: overrides.debit || overrides.credit || 0,
    direction: overrides.debit ? "debit" : "credit",
    debit: overrides.debit || 0,
    credit: overrides.credit || 0,
    status: "approved",
    metadata: { postingRole: overrides.postingRole },
    ...overrides.extra,
  });
};

describe("service providers — list outstanding balance", () => {
  it("reports zero outstanding for a provider with no ledger activity", async () => {
    const ctx = await setup();
    const provider = await ServiceProvider.create({ business: ctx.company._id, providerCode: "SP0001", name: "Acme Repairs" });

    const res = await callController(getServiceProviders, { user: ctx.user, query: {} });
    const row = res.payload.data.find((r) => String(r._id) === String(provider._id));
    expect(row.outstanding).toBe(0);
  });

  it("nets invoiced accruals against settlements for the returned page", async () => {
    const ctx = await setup();
    const provider = await ServiceProvider.create({ business: ctx.company._id, providerCode: "SP0002", name: "Beta Security" });
    await ledgerEntry(ctx, provider, { credit: 5000, postingRole: "ap_invoice_liability" });
    await ledgerEntry(ctx, provider, { debit: 2000, postingRole: "liability_settlement" });

    const res = await callController(getServiceProviders, { user: ctx.user, query: {} });
    const row = res.payload.data.find((r) => String(r._id) === String(provider._id));
    expect(row.outstanding).toBe(3000);
  });
});

describe("service providers — delete guard", () => {
  it("deletes a provider with no linked transactions", async () => {
    const ctx = await setup();
    const provider = await ServiceProvider.create({ business: ctx.company._id, providerCode: "SP0003", name: "Gamma Cleaning" });

    const res = await callController(deleteServiceProvider, { user: ctx.user, params: { id: String(provider._id) } });
    expect(res.payload.success).toBe(true);
    expect(await ServiceProvider.findById(provider._id)).toBeNull();
  });

  it("refuses to delete a provider with a linked expense requisition", async () => {
    const ctx = await setup();
    const provider = await ServiceProvider.create({ business: ctx.company._id, providerCode: "SP0004", name: "Delta Legal" });
    await ExpenseRequisition.create({
      business: ctx.company._id,
      requisitionNo: "ERQ0001",
      title: "Legal review",
      amount: 1000,
      property: ctx.property._id,
      serviceProvider: provider._id,
      status: "draft",
      createdBy: ctx.user._id,
      requestedBy: ctx.user._id,
    });

    await expect(
      callController(deleteServiceProvider, { user: ctx.user, params: { id: String(provider._id) } })
    ).rejects.toThrow(/cannot be deleted/i);
    expect(await ServiceProvider.findById(provider._id)).not.toBeNull();
  });

  it("refuses to delete a provider with linked ledger entries", async () => {
    const ctx = await setup();
    const provider = await ServiceProvider.create({ business: ctx.company._id, providerCode: "SP0005", name: "Epsilon Contractors" });
    await ledgerEntry(ctx, provider, { credit: 1000, postingRole: "ap_invoice_liability" });

    await expect(
      callController(deleteServiceProvider, { user: ctx.user, params: { id: String(provider._id) } })
    ).rejects.toThrow(/cannot be deleted/i);
  });
});

describe("service providers — default expense account", () => {
  it("resolves and stores a valid posting expense account on create, and populates it on list", async () => {
    const ctx = await setup();
    await createTestChartOfAccounts(ctx.company._id);
    const account = await ChartOfAccount.create({
      business: ctx.company._id, code: "5901", name: "Repairs & Maintenance", type: "expense", isPosting: true,
    });

    const created = await callController(createServiceProvider, {
      user: ctx.user,
      body: { name: "Acme Repairs", defaultExpenseAccount: String(account._id) },
    });
    expect(String(created.payload.defaultExpenseAccount)).toBe(String(account._id));

    const listed = await callController(getServiceProviders, { user: ctx.user, query: {} });
    const row = listed.payload.data.find((r) => String(r._id) === String(created.payload._id));
    expect(row.defaultExpenseAccount.name).toBe("Repairs & Maintenance");
  });

  it("silently drops a header (non-postable) account rather than storing an unpostable default", async () => {
    const ctx = await setup();
    await createTestChartOfAccounts(ctx.company._id);
    const header = await ChartOfAccount.create({
      business: ctx.company._id, code: "5900", name: "Operating Expenses", type: "expense", isHeader: true, isPosting: false,
    });

    const created = await callController(createServiceProvider, {
      user: ctx.user,
      body: { name: "Beta Vendor", defaultExpenseAccount: String(header._id) },
    });
    expect(created.payload.defaultExpenseAccount).toBeNull();
  });

  it("updates the default expense account on an existing provider", async () => {
    const ctx = await setup();
    await createTestChartOfAccounts(ctx.company._id);
    const account = await ChartOfAccount.create({
      business: ctx.company._id, code: "5902", name: "Utilities", type: "expense", isPosting: true,
    });
    const provider = await ServiceProvider.create({ business: ctx.company._id, providerCode: "SP0010", name: "Gamma Utilities" });

    const updated = await callController(updateServiceProvider, {
      user: ctx.user,
      params: { id: String(provider._id) },
      body: { defaultExpenseAccount: String(account._id) },
    });
    expect(String(updated.payload.defaultExpenseAccount)).toBe(String(account._id));
  });
});

describe("service providers — duplicate vendor detection", () => {
  it("flags a new provider whose bank account number matches an existing active provider", async () => {
    const ctx = await setup();
    await ServiceProvider.create({ business: ctx.company._id, providerCode: "SP0020", name: "Real Contractor Ltd", accountNumber: "0123456789" });

    const created = await callController(createServiceProvider, {
      user: ctx.user,
      body: { name: "Suspicious New Vendor", accountNumber: "0123456789" },
    });
    expect(created.payload.duplicateWarnings).toHaveLength(1);
    expect(created.payload.duplicateWarnings[0]).toMatchObject({ field: "accountNumber", matchedProviderName: "Real Contractor Ltd" });
  });

  it("flags a KRA PIN collision independently of a bank account collision", async () => {
    const ctx = await setup();
    await ServiceProvider.create({ business: ctx.company._id, providerCode: "SP0021", name: "Original Firm", kraPin: "A123456789Z" });

    const created = await callController(createServiceProvider, {
      user: ctx.user,
      body: { name: "Second Trading Name", kraPin: "a123456789z" },
    });
    expect(created.payload.duplicateWarnings).toHaveLength(1);
    expect(created.payload.duplicateWarnings[0].field).toBe("kraPin");
  });

  it("reports no warnings when nothing overlaps", async () => {
    const ctx = await setup();
    await ServiceProvider.create({ business: ctx.company._id, providerCode: "SP0022", name: "Unrelated Vendor", accountNumber: "999999" });

    const created = await callController(createServiceProvider, {
      user: ctx.user,
      body: { name: "Clean Vendor", accountNumber: "111111" },
    });
    expect(created.payload.duplicateWarnings).toEqual([]);
  });

  it("does not flag a provider against itself when updating other fields", async () => {
    const ctx = await setup();
    const provider = await ServiceProvider.create({ business: ctx.company._id, providerCode: "SP0023", name: "Self Match Co", accountNumber: "555555" });

    const updated = await callController(updateServiceProvider, {
      user: ctx.user,
      params: { id: String(provider._id) },
      body: { notes: "updated notes" },
    });
    expect(updated.payload.duplicateWarnings).toEqual([]);
  });
});
