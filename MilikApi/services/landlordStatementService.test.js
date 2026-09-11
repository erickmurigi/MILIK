// Integration test for landlord statement generation: verifies a statement correctly
// reflects rent invoiced and rent collected for the period from real invoice/receipt data.
import { describe, it, expect } from "vitest";
import { generateLandlordStatement } from "./landlordStatementService.js";
import { createTestLease, createTestChartOfAccounts, createTestUnit } from "../test/factories.js";
import { createTestInvoice, createTestReceipt } from "../test/factories.landlord.js";
import PaymentVoucher from "../models/PaymentVoucher.js";
import Tenant from "../models/Tenant.js";
import Property from "../models/Property.js";

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

  it("a tenant prepayment is excluded from Paid/collections when received, and recognised exactly once when later applied to a real charge", async () => {
    const leaseBundle = await createTestLease({ rentAmount: 15000 });
    const { property, landlord, unit } = leaseBundle;
    await createTestChartOfAccounts(leaseBundle.company._id);

    const now = new Date();
    const periodNStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const periodNEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    const periodN1Start = new Date(now.getFullYear(), now.getMonth(), 1);

    // Tenant pays 15,000 last period with no invoice yet to apply it to — a pure
    // prepayment, mirrored as an unapplied receipt (allocate: false).
    const prepaymentDate = new Date(periodNStart.getTime() + 60 * 1000);
    const { receipt } = await createTestReceipt({
      invoiceBundle: leaseBundle,
      amount: 15000,
      paymentDate: prepaymentDate,
      allocate: false,
    });

    const statementN = await generateLandlordStatement({
      propertyId: String(property._id),
      landlordId: String(landlord._id),
      statementPeriodStart: periodNStart,
      statementPeriodEnd: periodNEnd,
    });

    // Received but not yet applied to any charge — must not show as collected this period.
    expect(statementN.metadata.totals.paidRent).toBe(0);
    expect(statementN.metadata.summary.totalRentReceived).toBe(0);
    expect(statementN.metadata.summary.managerCollections).toBe(0);
    const rowN = statementN.metadata.rows.find((r) => String(r.unitId) === String(unit._id));
    expect(rowN.unappliedCredits).toBe(15000);

    // This period, a real rent invoice is raised and the prepayment gets applied to it —
    // mirroring what production allocation does to the same receipt document.
    const { invoice } = await createTestInvoice({
      leaseBundle,
      category: "RENT_CHARGE",
      amount: 15000,
      invoiceDate: periodN1Start,
      dueDate: new Date(periodN1Start.getTime() + 7 * 24 * 60 * 60 * 1000),
    });

    receipt.allocations.push({
      invoice: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      category: invoice.category,
      priorityGroup: "",
      appliedAmount: 15000,
      beforeOutstanding: 15000,
      afterOutstanding: 0,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      description: invoice.description || "",
    });
    receipt.allocationSummary.unapplied = 0;
    receipt.allocationSummary.rent = 15000;
    await receipt.save();
    invoice.outstanding = 0;
    invoice.status = "paid";
    await invoice.save();

    const statementN1 = await generateLandlordStatement({
      propertyId: String(property._id),
      landlordId: String(landlord._id),
      statementPeriodStart: periodN1Start,
      statementPeriodEnd: new Date(),
    });

    expect(statementN1.metadata.totals.invoicedRent).toBe(15000);
    // Recognised exactly once, now — in the period it's actually applied to a real charge.
    expect(statementN1.metadata.totals.paidRent).toBe(15000);
    expect(statementN1.metadata.summary.totalRentReceived).toBe(15000);
    expect(statementN1.metadata.summary.managerCollections).toBeGreaterThan(0);
    expect(statementN1.metadata.broughtForwardCreditApplications.totals.rentApplied).toBe(15000);
    const rowN1 = statementN1.metadata.rows.find((r) => String(r.unitId) === String(unit._id));
    expect(rowN1.closingBalance).toBe(0);
  }, 60000);

  it("a tenant occupying several units in one property is shown as ONE consolidated row, like the Paid & Balance report", async () => {
    const leaseBundle = await createTestLease({ rentAmount: 12000 });
    const { tenant, unit: unitA, property, landlord, company } = leaseBundle;
    await createTestChartOfAccounts(company._id);

    // Second unit in the SAME property, assigned to the same tenant as an additional unit.
    const { unit: unitB } = await createTestUnit({ property, company, rent: 8000 });
    await Tenant.findByIdAndUpdate(tenant._id, { additionalUnits: [unitB._id] });

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const invoiceDate = periodStart;
    const dueDate = new Date(periodStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const invoiceBundleA = await createTestInvoice({
      leaseBundle, category: "RENT_CHARGE", amount: 12000, invoiceDate, dueDate,
    });
    const invoiceBundleB = await createTestInvoice({
      leaseBundle: { ...leaseBundle, unit: unitB },
      category: "RENT_CHARGE", amount: 8000, invoiceDate, dueDate,
    });

    // One receipt of 20,000, recorded against unit A, allocated across BOTH rent invoices —
    // the exact shape that makes the per-unit rows individually misleading (A overpaid,
    // B unpaid) while the tenant's real position is settled.
    const paymentDate = new Date(periodStart.getTime() + 60 * 1000);
    const { receipt } = await createTestReceipt({
      invoiceBundle: invoiceBundleA, amount: 20000, paymentDate, allocate: false,
    });
    receipt.allocations = [
      {
        invoice: invoiceBundleA.invoice._id, invoiceNumber: invoiceBundleA.invoice.invoiceNumber,
        category: "RENT_CHARGE", appliedAmount: 12000, beforeOutstanding: 12000, afterOutstanding: 0,
        invoiceDate, dueDate,
      },
      {
        invoice: invoiceBundleB.invoice._id, invoiceNumber: invoiceBundleB.invoice.invoiceNumber,
        category: "RENT_CHARGE", appliedAmount: 8000, beforeOutstanding: 8000, afterOutstanding: 0,
        invoiceDate, dueDate,
      },
    ];
    receipt.allocationSummary = { rent: 20000, deposit: 0, utility: 0, latePenalty: 0, debitNote: 0, other: 0, unapplied: 0 };
    await receipt.save();
    for (const inv of [invoiceBundleA.invoice, invoiceBundleB.invoice]) {
      inv.outstanding = 0;
      inv.status = "paid";
      await inv.save();
    }

    const statement = await generateLandlordStatement({
      propertyId: String(property._id),
      landlordId: String(landlord._id),
      statementPeriodStart: periodStart,
      statementPeriodEnd: new Date(),
    });

    const tenantRows = statement.metadata.rows.filter(
      (r) => String(r.tenantId) === String(tenant._id)
    );
    // Exactly one consolidated row for the tenant — not one per unit.
    expect(tenantRows).toHaveLength(1);
    const row = tenantRows[0];
    expect(row.consolidatedUnitCount).toBe(2);
    expect(Array.isArray(row.unitBreakdown)).toBe(true);
    expect(row.unitBreakdown).toHaveLength(2);
    // Both unit numbers listed together in the label.
    expect(row.unit).toContain(unitA.unitNumber);
    expect(row.unit).toContain(unitB.unitNumber);
    // The consolidated position is settled (12000 + 8000 invoiced, 20000 paid) — even
    // though a per-unit split would show A at -8000 and B at +8000.
    expect(row.closingBalance).toBe(0);
    expect(row.invoicedRent).toBe(20000);
    expect(row.totalPaid).toBe(20000);
    // Column totals are unchanged — merging preserves every sum.
    expect(statement.metadata.totals.invoicedRent).toBe(20000);
    expect(statement.metadata.totals.paidRent).toBe(20000);
    // Both units still counted as occupied.
    expect(statement.metadata.summary.occupiedUnits).toBeGreaterThanOrEqual(2);
  }, 60000);

  it("a payment allocated to a future-dated rent invoice is held as a prepayment, then recognised exactly once in the invoice's own period (on_invoice_allocation)", async () => {
    const leaseBundle = await createTestLease({ rentAmount: 12000 });
    const { property, landlord, unit, company } = leaseBundle;
    await createTestChartOfAccounts(company._id);

    const now = new Date();
    const periodNStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const periodNEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    const periodN1Start = new Date(now.getFullYear(), now.getMonth(), 1);

    // Invoice A — this period's rent. Invoice B — next period's rent, raised early.
    const invA = await createTestInvoice({
      leaseBundle, category: "RENT_CHARGE", amount: 12000,
      invoiceDate: new Date(periodNStart.getTime() + 60 * 1000),
      dueDate: new Date(periodNStart.getTime() + 7 * 24 * 60 * 60 * 1000),
    });
    const invB = await createTestInvoice({
      leaseBundle, category: "RENT_CHARGE", amount: 12000,
      invoiceDate: new Date(periodN1Start.getTime() + 60 * 1000),
      dueDate: new Date(periodN1Start.getTime() + 7 * 24 * 60 * 60 * 1000),
    });

    // One 24,000 payment last period, split across both invoices — 12,000 is ahead of
    // the billing (invoice B belongs to next period).
    const payDate = new Date(periodNStart.getTime() + 2 * 60 * 1000);
    const { receipt } = await createTestReceipt({
      invoiceBundle: invA, amount: 24000, paymentDate: payDate, allocate: false,
    });
    receipt.allocations = [
      { invoice: invA.invoice._id, invoiceNumber: invA.invoice.invoiceNumber, category: "RENT_CHARGE", priorityGroup: "rent", appliedAmount: 12000, beforeOutstanding: 12000, afterOutstanding: 0, invoiceDate: invA.invoice.invoiceDate, dueDate: invA.invoice.dueDate },
      { invoice: invB.invoice._id, invoiceNumber: invB.invoice.invoiceNumber, category: "RENT_CHARGE", priorityGroup: "rent", appliedAmount: 12000, beforeOutstanding: 12000, afterOutstanding: 0, invoiceDate: invB.invoice.invoiceDate, dueDate: invB.invoice.dueDate },
    ];
    receipt.allocationSummary = { rent: 24000, deposit: 0, utility: 0, latePenalty: 0, debitNote: 0, other: 0, unapplied: 0 };
    await receipt.save();
    for (const inv of [invA.invoice, invB.invoice]) { inv.outstanding = 0; inv.status = "paid"; await inv.save(); }

    const gen = (start, end) => generateLandlordStatement({
      propertyId: String(property._id), landlordId: String(landlord._id),
      statementPeriodStart: start, statementPeriodEnd: end,
    });
    const rowFor = (stmt) => stmt.metadata.rows.find((r) => String(r.unitId) === String(unit._id));

    // Period N: only invoice A's 12,000 is "paid this period"; invoice B's 12,000 is held.
    const nStmt = await gen(periodNStart, periodNEnd);
    const nRow = rowFor(nStmt);
    expect(nRow.paidRent).toBe(12000);
    expect(nRow.closingBalance).toBe(0);
    expect(nRow.unappliedCredits).toBe(12000);
    expect(nStmt.metadata.totals.paidRent).toBe(12000);
    expect(nStmt.metadata.summary.commissionBaseAmount).toBe(12000);

    // Period N+1: invoice B's 12,000 is recognised now — once, not again on top of N.
    const n1Stmt = await gen(periodN1Start, new Date());
    const n1Row = rowFor(n1Stmt);
    expect(n1Row.paidRent).toBe(12000);
    expect(n1Row.closingBalance).toBe(0);
    expect(n1Stmt.metadata.totals.paidRent).toBe(12000);
    expect(n1Stmt.metadata.summary.commissionBaseAmount).toBe(12000);

    // 24,000 collected, counted 12,000 + 12,000 across the two periods — exactly once each.
  }, 60000);

  it("on_receipt policy: the full payment is recognised when it lands, and never again when the future invoice's period arrives", async () => {
    const leaseBundle = await createTestLease({ rentAmount: 12000 });
    const { property, landlord, unit, company } = leaseBundle;
    await createTestChartOfAccounts(company._id);
    await Property.findByIdAndUpdate(property._id, { prepaymentRecognition: "on_receipt" });

    const now = new Date();
    const periodNStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const periodNEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    const periodN1Start = new Date(now.getFullYear(), now.getMonth(), 1);

    const invA = await createTestInvoice({
      leaseBundle, category: "RENT_CHARGE", amount: 12000,
      invoiceDate: new Date(periodNStart.getTime() + 60 * 1000),
      dueDate: new Date(periodNStart.getTime() + 7 * 24 * 60 * 60 * 1000),
    });
    const invB = await createTestInvoice({
      leaseBundle, category: "RENT_CHARGE", amount: 12000,
      invoiceDate: new Date(periodN1Start.getTime() + 60 * 1000),
      dueDate: new Date(periodN1Start.getTime() + 7 * 24 * 60 * 60 * 1000),
    });

    const payDate = new Date(periodNStart.getTime() + 2 * 60 * 1000);
    const { receipt } = await createTestReceipt({
      invoiceBundle: invA, amount: 24000, paymentDate: payDate, allocate: false,
    });
    receipt.allocations = [
      { invoice: invA.invoice._id, invoiceNumber: invA.invoice.invoiceNumber, category: "RENT_CHARGE", priorityGroup: "rent", appliedAmount: 12000, beforeOutstanding: 12000, afterOutstanding: 0, invoiceDate: invA.invoice.invoiceDate, dueDate: invA.invoice.dueDate },
      { invoice: invB.invoice._id, invoiceNumber: invB.invoice.invoiceNumber, category: "RENT_CHARGE", priorityGroup: "rent", appliedAmount: 12000, beforeOutstanding: 12000, afterOutstanding: 0, invoiceDate: invB.invoice.invoiceDate, dueDate: invB.invoice.dueDate },
    ];
    receipt.allocationSummary = { rent: 24000, deposit: 0, utility: 0, latePenalty: 0, debitNote: 0, other: 0, unapplied: 0 };
    await receipt.save();
    for (const inv of [invA.invoice, invB.invoice]) { inv.outstanding = 0; inv.status = "paid"; await inv.save(); }

    const gen = (start, end) => generateLandlordStatement({
      propertyId: String(property._id), landlordId: String(landlord._id),
      statementPeriodStart: start, statementPeriodEnd: end,
    });
    const rowFor = (stmt) => stmt.metadata.rows.find((r) => String(r.unitId) === String(unit._id));

    // Period N: the whole 24,000 is recognised on receipt.
    const nStmt = await gen(periodNStart, periodNEnd);
    expect(rowFor(nStmt).paidRent).toBe(24000);
    expect(nStmt.metadata.totals.paidRent).toBe(24000);

    // Period N+1: invoice B is billed, but its payment was already counted — not re-counted.
    const n1Stmt = await gen(periodN1Start, new Date());
    expect(rowFor(n1Stmt).paidRent).toBe(0);
    expect(n1Stmt.metadata.totals.paidRent).toBe(0);
  }, 60000);

  it("on_invoice_allocation caps rent recognition at what the tenant owes — a lump overpayment beyond the bill is held as a prepayment credit", async () => {
    const leaseBundle = await createTestLease({ rentAmount: 13000 });
    const { property, landlord, unit, company } = leaseBundle;
    await createTestChartOfAccounts(company._id);

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const invoiceDate = new Date(periodStart.getTime() + 60 * 1000);

    // Billed 13,000 rent this period; tenant pays 28,000 in one receipt recorded as a
    // lump "rent" amount (no per-invoice allocation rows) — the KETHI OWINO shape.
    await createTestInvoice({
      leaseBundle, category: "RENT_CHARGE", amount: 13000, invoiceDate,
      dueDate: new Date(periodStart.getTime() + 7 * 24 * 60 * 60 * 1000),
    });
    const { receipt } = await createTestReceipt({
      invoiceBundle: leaseBundle, amount: 28000,
      paymentDate: new Date(periodStart.getTime() + 2 * 60 * 1000),
      allocate: false, paymentType: "rent",
    });
    receipt.allocations = [];
    receipt.allocationSummary = { rent: 28000, deposit: 0, utility: 0, latePenalty: 0, debitNote: 0, other: 0, unapplied: 0 };
    await receipt.save();

    const statement = await generateLandlordStatement({
      propertyId: String(property._id), landlordId: String(landlord._id),
      statementPeriodStart: periodStart, statementPeriodEnd: new Date(),
    });
    const row = statement.metadata.rows.find((r) => String(r.unitId) === String(unit._id));

    // Only the 13,000 covering the bill is recognised; 15,000 held as a prepayment credit.
    expect(row.paidRent).toBe(13000);
    expect(row.closingBalance).toBe(0);
    expect(row.unappliedCredits).toBe(15000);
    expect(statement.metadata.totals.paidRent).toBe(13000);
    // Commission and remittance basis exclude the prepayment.
    expect(statement.metadata.summary.commissionBaseAmount).toBe(13000);
    expect(statement.metadata.summary.unappliedPayments).toBe(15000);
  }, 60000);

  it("shows a generic Deposit column (invoiced + paid) for a tenant billed a security deposit, without affecting the rent-ledger balance", async () => {
    const leaseBundle = await createTestLease({ rentAmount: 10000 });
    const { property, landlord, unit, company } = leaseBundle;
    await createTestChartOfAccounts(company._id);

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const invoiceDate = new Date(periodStart.getTime() + 60 * 1000);
    const dueDate = new Date(periodStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const rentInvoiceBundle = await createTestInvoice({
      leaseBundle, category: "RENT_CHARGE", amount: 10000, invoiceDate, dueDate,
    });
    const depositInvoiceBundle = await createTestInvoice({
      leaseBundle, category: "DEPOSIT_CHARGE", amount: 17000, invoiceDate, dueDate,
    });

    // Rent paid in full, deposit paid in full — via two separate, explicitly allocated
    // receipts (mirroring how a real deposit invoice is settled).
    await createTestReceipt({
      invoiceBundle: rentInvoiceBundle, amount: 10000,
      paymentDate: new Date(periodStart.getTime() + 2 * 60 * 1000),
      allocate: true,
    });
    await createTestReceipt({
      invoiceBundle: depositInvoiceBundle, amount: 17000,
      paymentDate: new Date(periodStart.getTime() + 3 * 60 * 1000),
      allocate: false,
      allocations: [
        {
          invoice: depositInvoiceBundle.invoice._id,
          invoiceNumber: depositInvoiceBundle.invoice.invoiceNumber,
          category: "DEPOSIT_CHARGE",
          priorityGroup: "deposit",
          appliedAmount: 17000,
          beforeOutstanding: 17000,
          afterOutstanding: 0,
          invoiceDate, dueDate,
        },
      ],
      allocationSummary: { rent: 0, deposit: 17000, utility: 0, latePenalty: 0, debitNote: 0, other: 0, unapplied: 0 },
    });

    const statement = await generateLandlordStatement({
      propertyId: String(property._id), landlordId: String(landlord._id),
      statementPeriodStart: periodStart, statementPeriodEnd: new Date(),
    });

    const row = statement.metadata.rows.find((r) => String(r.unitId) === String(unit._id));

    // The generic "Deposit" column shows the full billed and paid deposit amount.
    expect(row.totalDepositInvoiced).toBe(17000);
    expect(row.totalDepositPaid).toBe(17000);
    expect(Array.isArray(statement.metadata.depositColumns)).toBe(true);
    const depositColumn = statement.metadata.depositColumns.find((c) => c.key === "deposit");
    expect(depositColumn).toBeTruthy();
    expect(depositColumn.label).toBe("Deposit");
    expect(depositColumn.invoiced).toBe(17000);
    expect(depositColumn.paid).toBe(17000);

    // Deposit is a liability, not income — it must NEVER be folded into the rent-ledger
    // balance. Rent alone is billed 10,000 and paid 10,000, so closingBalance is 0
    // regardless of the 17,000 of deposit activity on the same row.
    expect(row.invoicedRent).toBe(10000);
    expect(row.paidRent).toBe(10000);
    expect(row.closingBalance).toBe(0);
  }, 60000);

  it("hides the Deposit column entirely when a property has no deposit activity this period", async () => {
    const leaseBundle = await createTestLease({ rentAmount: 9000 });
    const { property, landlord, company } = leaseBundle;
    await createTestChartOfAccounts(company._id);

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const invoiceDate = new Date(periodStart.getTime() + 60 * 1000);

    await createTestInvoice({
      leaseBundle, category: "RENT_CHARGE", amount: 9000, invoiceDate,
      dueDate: new Date(periodStart.getTime() + 7 * 24 * 60 * 60 * 1000),
    });

    const statement = await generateLandlordStatement({
      propertyId: String(property._id), landlordId: String(landlord._id),
      statementPeriodStart: periodStart, statementPeriodEnd: new Date(),
    });

    expect(statement.metadata.depositColumns).toEqual([]);
  }, 60000);
});
