// Integration test for landlord statement generation: verifies a statement correctly
// reflects rent invoiced and rent collected for the period from real invoice/receipt data.
import { describe, it, expect } from "vitest";
import { generateLandlordStatement } from "./landlordStatementService.js";
import { createTestLease, createTestChartOfAccounts } from "../test/factories.js";
import { createTestInvoice, createTestReceipt } from "../test/factories.landlord.js";
import PaymentVoucher from "../models/PaymentVoucher.js";
import Tenant from "../models/Tenant.js";

describe("generateLandlordStatement", () => {
  it("reflects rent invoiced and rent collected for the statement period", async () => {
    const leaseBundle = await createTestLease({ rentAmount: 20000 });
    const { property, landlord, company } = leaseBundle;
    await createTestChartOfAccounts(company._id);

    const now = new Date();
    // periodStart / invoiceDate / paymentDate are all pinned to the start of the current
    // month so they land safely inside the period no matter what day-of-month the test
    // suite happens to run on — generateLandlordStatement caps the effective period end at
    // the actual current moment, so a later-in-month fixture date could fall outside it.
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const invoiceDate = periodStart;
    const paymentDate = new Date(periodStart.getTime() + 60 * 1000);

    const invoiceBundle = await createTestInvoice({
      leaseBundle,
      category: "RENT_CHARGE",
      amount: 20000,
      invoiceDate,
      dueDate: new Date(periodStart.getTime() + 7 * 24 * 60 * 60 * 1000),
    });

    // Fully pay the rent invoice within the same period.
    await createTestReceipt({
      invoiceBundle,
      amount: 20000,
      paymentDate,
      allocate: true,
    });

    // Capture the period end AFTER creating the fixtures above, so it is guaranteed to be
    // at or after both the invoice and receipt dates.
    const statement = await generateLandlordStatement({
      propertyId: String(property._id),
      landlordId: String(landlord._id),
      statementPeriodStart: periodStart,
      statementPeriodEnd: new Date(),
    });

    expect(statement.metadata.totals.invoicedRent).toBe(20000);
    expect(statement.metadata.totals.paidRent).toBe(20000);
    expect(statement.metadata.summary.totalRentReceived).toBe(20000);
    expect(statement.metadata.summary.managerCollections).toBeGreaterThan(0);
    // With commissionPercentage defaulted to 0, the full rent collected should flow
    // through as the net amount payable to the landlord.
    expect(statement.metadata.summary.amountPayableToLandlord).toBe(20000);
    // The tenant's own ledger (closingBalance = amount still owed by the tenant) is
    // separately fully settled since the invoice was paid in full.
    expect(statement.closingBalance).toBe(0);
  }, 60000);

  it("only counts rent actually received, not the full invoiced amount, for a partially paid invoice", async () => {
    const leaseBundle = await createTestLease({ rentAmount: 10000 });
    const { property, landlord, company } = leaseBundle;
    await createTestChartOfAccounts(company._id);

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const invoiceDate = periodStart;
    const paymentDate = new Date(periodStart.getTime() + 60 * 1000);

    const invoiceBundle = await createTestInvoice({
      leaseBundle,
      category: "RENT_CHARGE",
      amount: 10000,
      invoiceDate,
      dueDate: new Date(periodStart.getTime() + 7 * 24 * 60 * 60 * 1000),
    });

    await createTestReceipt({
      invoiceBundle,
      amount: 4000,
      paymentDate,
      allocate: true,
    });

    const statement = await generateLandlordStatement({
      propertyId: String(property._id),
      landlordId: String(landlord._id),
      statementPeriodStart: periodStart,
      statementPeriodEnd: new Date(),
    });

    expect(statement.metadata.totals.invoicedRent).toBe(10000);
    expect(statement.metadata.totals.paidRent).toBe(4000);
  }, 60000);

  it("counts a confirmed paidDirectToLandlord receipt in the landlord's direct-collection totals", async () => {
    const leaseBundle = await createTestLease({ rentAmount: 15000 });
    const { property, landlord, company } = leaseBundle;
    await createTestChartOfAccounts(company._id);

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const invoiceDate = periodStart;
    const paymentDate = new Date(periodStart.getTime() + 60 * 1000);

    const invoiceBundle = await createTestInvoice({
      leaseBundle,
      category: "RENT_CHARGE",
      amount: 15000,
      invoiceDate,
      dueDate: new Date(periodStart.getTime() + 7 * 24 * 60 * 60 * 1000),
    });

    // A receipt marked "Direct to Landlord" (cashbook bypassed) and confirmed — this is
    // the combination the bug report claims does not flow into the landlord statement.
    await createTestReceipt({
      invoiceBundle,
      amount: 15000,
      paymentDate,
      allocate: true,
      isConfirmed: true,
      paidDirectToLandlord: true,
      cashbook: "",
    });

    const statement = await generateLandlordStatement({
      propertyId: String(property._id),
      landlordId: String(landlord._id),
      statementPeriodStart: periodStart,
      statementPeriodEnd: new Date(),
    });

    // Tenant-level ledger reflects the rent as paid regardless of who received it.
    expect(statement.metadata.totals.paidRent).toBe(15000);
    expect(statement.closingBalance).toBe(0);

    // The receipt must be bucketed as a direct-to-landlord collection, not a manager one.
    expect(statement.metadata.summary.totalRentReceivedLandlord).toBe(15000);
    expect(statement.metadata.summary.totalRentReceivedManager).toBe(0);
    expect(statement.metadata.summary.directRentCollections).toBe(15000);
    expect(statement.metadata.summary.directToLandlordCollections).toBe(15000);
    expect(statement.metadata.summary.managerCollections).toBe(0);

    // It should also appear as its own line item for the statement's direct-receipts section.
    expect(statement.metadata.directToLandlordRows).toHaveLength(1);
    expect(statement.metadata.directToLandlordRows[0].amount).toBe(15000);
  }, 60000);

  // Regression test: a Payment Voucher categorized "manager_property" ("Operating Expense
  // (Property)" in the voucher form) — a property-scoped expense the manager pays on the
  // landlord's behalf, same as landlord_maintenance/landlord_other — never appeared as a
  // statement deduction. Root cause: both the PaymentVoucher query's category filter and
  // getVoucherExpenseCategory() only recognized landlord_maintenance/landlord_other.
  it("includes an approved manager_property (Operating Expense - Property) payment voucher as an expense row", async () => {
    const leaseBundle = await createTestLease({ rentAmount: 15000 });
    const { property, landlord, company } = leaseBundle;
    await createTestChartOfAccounts(company._id);

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const paidDate = new Date(periodStart.getTime() + 60 * 1000);

    await PaymentVoucher.create({
      voucherNo: `PV-TEST-${Date.now()}`,
      category: "manager_property",
      status: "paid",
      business: company._id,
      property: property._id,
      landlord: landlord._id,
      amount: 8500,
      dueDate: paidDate,
      paidDate,
      narration: "Gate repair — operating expense",
    });

    const statement = await generateLandlordStatement({
      propertyId: String(property._id),
      landlordId: String(landlord._id),
      statementPeriodStart: periodStart,
      statementPeriodEnd: new Date(),
    });

    const voucherRow = statement.metadata.expenseRows.find(
      (row) => row.category === "operating_expense"
    );
    expect(voucherRow).toBeTruthy();
    expect(voucherRow.amount).toBe(8500);
  }, 60000);

  // Regression test: terminating a tenant never clears their tenant.unit field, and the
  // tenants query behind the schedule's "who currently occupies this unit" row seeding
  // only excluded status inactive/moved_out/evicted — not "terminated", the actual value
  // updateTenantStatus stores. So a terminated tenant kept getting a row generated for a
  // unit they no longer occupy on every later statement, even one where someone else now
  // lives there. Fixed by excluding terminated tenants from that specific "current
  // occupant" seeding step (their own legitimate transactions within the period, from
  // before termination, are unaffected — see the second test below).
  it("a terminated tenant with no transactions this period no longer occupies their old unit's row", async () => {
    const leaseBundle = await createTestLease({ rentAmount: 15000 });
    const { tenant, property, landlord, company } = leaseBundle;
    await createTestChartOfAccounts(company._id);

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Terminated with no invoices/receipts at all in the statement period below.
    await Tenant.findByIdAndUpdate(tenant._id, {
      status: "terminated",
      terminationDate: periodStart,
      moveOutDate: periodStart,
    });

    const statement = await generateLandlordStatement({
      propertyId: String(property._id),
      landlordId: String(landlord._id),
      statementPeriodStart: periodStart,
      statementPeriodEnd: new Date(),
    });

    const row = statement.metadata.rows.find(
      (r) => String(r.unitId) === String(tenant.unit)
    );
    expect(row).toBeTruthy();
    expect(row.tenantName).toBe("VACANT");
  }, 60000);

  it("a tenant terminated mid-period (even with real transactions from before the termination) is fully excluded — no date carve-out", async () => {
    const leaseBundle = await createTestLease({ rentAmount: 12000 });
    const { tenant, property, landlord, company } = leaseBundle;
    await createTestChartOfAccounts(company._id);

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const invoiceDate = periodStart;
    const paymentDate = new Date(periodStart.getTime() + 60 * 1000);

    const invoiceBundle = await createTestInvoice({
      leaseBundle,
      category: "RENT_CHARGE",
      amount: 12000,
      invoiceDate,
      dueDate: new Date(periodStart.getTime() + 7 * 24 * 60 * 60 * 1000),
    });

    await createTestReceipt({
      invoiceBundle,
      amount: 12000,
      paymentDate,
      allocate: true,
    });

    // Terminated AFTER the invoice/receipt above — a real mid-period departure. Per the
    // simplified rule, terminated status alone excludes them regardless of when relative
    // to the period the termination happened.
    const terminationDate = new Date(paymentDate.getTime() + 60 * 1000);
    await Tenant.findByIdAndUpdate(tenant._id, {
      status: "terminated",
      terminationDate,
      moveOutDate: terminationDate,
    });

    const statement = await generateLandlordStatement({
      propertyId: String(property._id),
      landlordId: String(landlord._id),
      statementPeriodStart: periodStart,
      statementPeriodEnd: new Date(),
    });

    const row = statement.metadata.rows.find(
      (r) => String(r.unitId) === String(tenant.unit)
    );
    expect(row).toBeTruthy();
    expect(row.tenantName).toBe("VACANT");
  }, 60000);

  it("a tenant terminated BEFORE this statement period does not show by name even if a stray invoice landed inside the period", async () => {
    const leaseBundle = await createTestLease({ rentAmount: 9000 });
    const { tenant, property, landlord, company } = leaseBundle;
    await createTestChartOfAccounts(company._id);

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Terminated BEFORE the period start.
    const terminationDate = new Date(periodStart.getTime() - 24 * 60 * 60 * 1000);
    await Tenant.findByIdAndUpdate(tenant._id, {
      status: "terminated",
      terminationDate,
      moveOutDate: terminationDate,
    });

    // A stray invoice erroneously dated INSIDE the period (e.g. auto-generated a few days
    // ahead, before the termination was processed) — per the stated rule, this must not
    // make the terminated tenant show up.
    await createTestInvoice({
      leaseBundle,
      category: "RENT_CHARGE",
      amount: 9000,
      invoiceDate: periodStart,
      dueDate: new Date(periodStart.getTime() + 7 * 24 * 60 * 60 * 1000),
    });

    const statement = await generateLandlordStatement({
      propertyId: String(property._id),
      landlordId: String(landlord._id),
      statementPeriodStart: periodStart,
      statementPeriodEnd: new Date(),
    });

    const row = statement.metadata.rows.find(
      (r) => String(r.unitId) === String(tenant.unit)
    );
    expect(row).toBeTruthy();
    expect(row.tenantName).toBe("VACANT");
  }, 60000);

  it("a tenant marked terminated with no terminationDate/moveOutDate on record does not show by name (fails safe, not open)", async () => {
    const leaseBundle = await createTestLease({ rentAmount: 11000 });
    const { tenant, property, landlord, company } = leaseBundle;
    await createTestChartOfAccounts(company._id);

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // status set to terminated, but no date recorded at all — e.g. a code path that
    // updated status without going through the normal termination flow.
    await Tenant.findByIdAndUpdate(tenant._id, {
      status: "terminated",
      terminationDate: null,
      moveOutDate: null,
    });

    await createTestInvoice({
      leaseBundle,
      category: "RENT_CHARGE",
      amount: 11000,
      invoiceDate: periodStart,
      dueDate: new Date(periodStart.getTime() + 7 * 24 * 60 * 60 * 1000),
    });

    const statement = await generateLandlordStatement({
      propertyId: String(property._id),
      landlordId: String(landlord._id),
      statementPeriodStart: periodStart,
      statementPeriodEnd: new Date(),
    });

    const row = statement.metadata.rows.find(
      (r) => String(r.unitId) === String(tenant.unit)
    );
    expect(row).toBeTruthy();
    expect(row.tenantName).toBe("VACANT");
  }, 60000);
});
