// Coverage for AP Aging (Payment Aged Analysis / AR-AP Aging Report)'s vendor side:
// - getAPAgingReport used to read pending PaymentVoucher records directly for vendor-tied rows,
//   which missed any accrual that was never (yet) turned into a voucher — including every vendor
//   take-on (opening) balance, which never gets a voucher at all. It now delegates to
//   computeVendorApAgingRows (serviceProviders.js), which FIFO-allocates approved settlements
//   against approved accruals and ages whatever's left — the same ledger Outstanding/Statement
//   already read, so the numbers can't disagree between the two.
// - Landlord-category vouchers still come from PaymentVoucher directly (no accrual-first pipeline
//   exists for them), and a free-text one-off payee (no registered provider) still falls back to
//   payeeName — both unchanged from before.
import { describe, it, expect } from "vitest";
import { getAPAgingReport } from "./financialReports.js";
import { createVendorTakeOnBalance } from "./expenseRequisition.js";
import { callController } from "../../test/callController.js";
import { createTestCompany, createTestUser, createTestChartOfAccounts } from "../../test/factories.js";
import ServiceProvider from "../../models/ServiceProvider.js";
import PaymentVoucher from "../../models/PaymentVoucher.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";

const setup = async () => {
  const company = await createTestCompany();
  const user = await createTestUser({ company });
  return { company, user };
};

const accrual = (ctx, provider, { amount, date, requisitionNo = "ERQ0001" }) =>
  FinancialLedgerEntry.create({
    business: ctx.company._id,
    serviceProvider: provider._id,
    sourceTransactionType: "expense_requisition",
    sourceTransactionId: String(provider._id),
    transactionDate: date,
    statementPeriodStart: new Date(date.getFullYear(), date.getMonth(), 1),
    statementPeriodEnd: new Date(date.getFullYear(), date.getMonth() + 1, 0),
    category: "EXPENSE_DEDUCTION",
    amount,
    direction: "credit",
    debit: 0,
    credit: amount,
    status: "approved",
    metadata: { postingRole: "ap_invoice_liability", requisitionNo },
  });

const settlement = (ctx, provider, { amount, date }) =>
  FinancialLedgerEntry.create({
    business: ctx.company._id,
    serviceProvider: provider._id,
    sourceTransactionType: "payment_voucher",
    sourceTransactionId: String(provider._id),
    transactionDate: date,
    statementPeriodStart: new Date(date.getFullYear(), date.getMonth(), 1),
    statementPeriodEnd: new Date(date.getFullYear(), date.getMonth() + 1, 0),
    category: "EXPENSE_DEDUCTION",
    amount,
    direction: "debit",
    debit: amount,
    credit: 0,
    status: "approved",
    metadata: { postingRole: "liability_settlement" },
  });

describe("AP aging report — vendor attribution", () => {
  it("falls back to the free-text payeeName when no service provider is linked", async () => {
    const ctx = await setup();
    await PaymentVoucher.create({
      business: ctx.company._id,
      voucherNo: "PV0002",
      category: "company_operational",
      status: "approved",
      amount: 1500,
      dueDate: new Date(),
      payeeName: "One-off Supplier",
    });

    const res = await callController(getAPAgingReport, { user: ctx.user, query: {} });
    const row = res.payload.rows[0];
    expect(row.vendorName).toBe("One-off Supplier");
    expect(row.serviceProviderId).toBeNull();
  });

  it("leaves vendorName null for a landlord-tied voucher", async () => {
    const ctx = await setup();
    await PaymentVoucher.create({
      business: ctx.company._id,
      voucherNo: "PV0003",
      category: "landlord_maintenance",
      status: "approved",
      amount: 2500,
      dueDate: new Date(),
    });

    const res = await callController(getAPAgingReport, { user: ctx.user, query: {} });
    const row = res.payload.rows[0];
    expect(row.vendorName).toBeNull();
    expect(row.serviceProviderId).toBeNull();
  });

  it("does not surface a vendor-tied voucher by presence alone — it needs a posted accrual", async () => {
    const ctx = await setup();
    const provider = await ServiceProvider.create({ business: ctx.company._id, providerCode: "SP0001", name: "Acme Contractors" });
    await PaymentVoucher.create({
      business: ctx.company._id,
      voucherNo: "PV0001",
      category: "company_operational",
      status: "approved",
      amount: 4000,
      dueDate: new Date(),
      serviceProvider: provider._id,
    });

    const res = await callController(getAPAgingReport, { user: ctx.user, query: {} });
    expect(res.payload.rows).toHaveLength(0);
  });
});

describe("AP aging report — vendor GL-based aging", () => {
  it("surfaces a vendor's unpaid accrual with the right vendor name and bucket", async () => {
    const ctx = await setup();
    const provider = await ServiceProvider.create({ business: ctx.company._id, providerCode: "SP0010", name: "Acme Contractors" });
    const asOf = new Date();
    const accrualDate = new Date(asOf.getTime() - 45 * 86_400_000); // 45 days old → 31-60 bucket
    await accrual(ctx, provider, { amount: 6000, date: accrualDate });

    const res = await callController(getAPAgingReport, { user: ctx.user, query: {} });
    const row = res.payload.rows.find((r) => String(r.serviceProviderId) === String(provider._id));
    expect(row.vendorName).toBe("Acme Contractors");
    expect(row.amount).toBe(6000);
    expect(row.bucket).toBe("d31_60");
  });

  it("FIFO-allocates a partial payment against the oldest accrual first", async () => {
    const ctx = await setup();
    const provider = await ServiceProvider.create({ business: ctx.company._id, providerCode: "SP0011", name: "Beta Security" });
    const now = new Date();
    const older = new Date(now.getTime() - 50 * 86_400_000);
    const newer = new Date(now.getTime() - 10 * 86_400_000);
    await accrual(ctx, provider, { amount: 3000, date: older, requisitionNo: "ERQ0001" });
    await accrual(ctx, provider, { amount: 5000, date: newer, requisitionNo: "ERQ0002" });
    await settlement(ctx, provider, { amount: 3000, date: now });

    const res = await callController(getAPAgingReport, { user: ctx.user, query: {} });
    const rows = res.payload.rows.filter((r) => String(r.serviceProviderId) === String(provider._id));
    // The 3000 payment fully clears the older 3000 accrual; only the newer 5000 one remains.
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(5000);
    expect(rows[0].daysOverdue).toBeGreaterThanOrEqual(9);
  });

  it("excludes a fully-paid accrual entirely", async () => {
    const ctx = await setup();
    const provider = await ServiceProvider.create({ business: ctx.company._id, providerCode: "SP0012", name: "Gamma Cleaning" });
    const date = new Date(Date.now() - 20 * 86_400_000);
    await accrual(ctx, provider, { amount: 2000, date });
    await settlement(ctx, provider, { amount: 2000, date: new Date() });

    const res = await callController(getAPAgingReport, { user: ctx.user, query: {} });
    expect(res.payload.rows.find((r) => String(r.serviceProviderId) === String(provider._id))).toBeUndefined();
  });

  it("surfaces a vendor take-on (opening) balance — the exact gap this fix closes", async () => {
    const ctx = await setup();
    await createTestChartOfAccounts(ctx.company._id);
    const provider = await ServiceProvider.create({ business: ctx.company._id, providerCode: "SP0013", name: "Legacy Contractor" });
    const expenseAccount = await ChartOfAccount.create({
      business: ctx.company._id, code: "5901", name: "Repairs & Maintenance", type: "expense", isPosting: true,
    });
    await callController(createVendorTakeOnBalance, {
      user: ctx.user,
      body: { serviceProvider: String(provider._id), amount: 7000, expenseAccount: String(expenseAccount._id), effectiveDate: "2026-01-01" },
    });

    const res = await callController(getAPAgingReport, { user: ctx.user, query: {} });
    const row = res.payload.rows.find((r) => String(r.serviceProviderId) === String(provider._id));
    expect(row).toBeDefined();
    expect(row.amount).toBe(7000);
  });
});
