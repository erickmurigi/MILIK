// Integration test for landlord statement generation: verifies a statement correctly
// reflects rent invoiced and rent collected for the period from real invoice/receipt data.
import { describe, it, expect } from "vitest";
import { generateLandlordStatement } from "./landlordStatementService.js";
import { createTestLease, createTestChartOfAccounts } from "../test/factories.js";
import { createTestInvoice, createTestReceipt } from "../test/factories.landlord.js";

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
});
