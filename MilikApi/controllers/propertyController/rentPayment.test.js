// Integration tests for controllers/propertyController/rentPayment.js — the receipt
// allocation engine. Focus: a receipt allocates across multiple open invoices in
// priority order (rent -> deposit -> utility -> late_penalty -> debit_note -> other,
// per the priorityRankMap in tenantInvoices.js), and the receipt description is
// auto-built from what was actually allocated via buildReceiptAllocationLabel.
import { describe, it, expect } from "vitest";
import { callController } from "../../test/callController.js";
import { createTestLease, createTestUser, createTestChartOfAccounts } from "../../test/factories.js";
import { createTestTenantInvoice } from "../../test/factories.payments.js";
import { createPayment, autoApplyPrepayments } from "./rentPayment.js";
import RentPayment from "../../models/RentPayment.js";
import TenantInvoice from "../../models/TenantInvoice.js";

describe("createPayment — receipt allocation engine", () => {
  // Generous per-test timeout: this test creates 4 invoices + posts a receipt against
  // an in-memory Mongo replica set, which can run slower under concurrent test load.
  it("allocates a receipt across multiple open invoices in priority order and builds the description from what was allocated", async () => {
    const { tenant, unit, property, company, landlord } = await createTestLease({});
    const user = await createTestUser({ company });
    // Resolve the chart of accounts + invoice author ONCE and reuse across every
    // createTestTenantInvoice call below — each call would otherwise redundantly
    // re-run ensureSystemChartOfAccounts and create a brand new User.
    const accounts = await createTestChartOfAccounts(company._id);
    const chartAccount = accounts.find((a) => a.code === "1200") || accounts[0];
    const invoiceAuthor = await createTestUser({ company });

    const dueDate = new Date(2026, 2, 1);
    const invoiceDate = new Date(2026, 1, 25);

    const rentInvoice = await createTestTenantInvoice({
      company, property, landlord, tenant, unit, chartAccount, createdBy: invoiceAuthor,
      category: "RENT_CHARGE", amount: 10000, invoiceDate, dueDate,
    });
    const depositInvoice = await createTestTenantInvoice({
      company, property, landlord, tenant, unit, chartAccount, createdBy: invoiceAuthor,
      category: "DEPOSIT_CHARGE", amount: 5000, invoiceDate, dueDate,
    });
    const utilityInvoice = await createTestTenantInvoice({
      company, property, landlord, tenant, unit, chartAccount, createdBy: invoiceAuthor,
      category: "UTILITY_CHARGE", amount: 3000, invoiceDate, dueDate,
      metadata: { utilityType: "Water" },
    });
    const penaltyInvoice = await createTestTenantInvoice({
      company, property, landlord, tenant, unit, chartAccount, createdBy: invoiceAuthor,
      category: "LATE_PENALTY_CHARGE", amount: 2000, invoiceDate, dueDate,
    });

    // Receipt amount exactly covers all four open invoices combined (10000 + 5000 + 3000 + 2000).
    const { statusCode, payload } = await callController(createPayment, {
      user,
      body: {
        tenant: String(tenant._id),
        unit: String(unit._id),
        amount: 20000,
        referenceNumber: `REF-${Date.now()}`,
        cashbook: "Main Cashbook",
        paymentMethod: "cash",
        paymentDate: new Date(2026, 2, 5),
        month: 3,
        year: 2026,
      },
    });

    expect(statusCode).toBe(200);

    // Allocation summary — every invoice fully paid, nothing left unapplied.
    expect(payload.allocationSummary.rent).toBe(10000);
    expect(payload.allocationSummary.deposit).toBe(5000);
    expect(payload.allocationSummary.utility).toBe(3000);
    expect(payload.allocationSummary.latePenalty).toBe(2000);
    expect(payload.allocationSummary.unapplied).toBe(0);

    // Allocation rows applied in priority order: rent(1) -> deposit(2) -> utility(3) -> late_penalty(4).
    expect(payload.allocations).toHaveLength(4);
    expect(payload.allocations.map((row) => row.priorityGroup)).toEqual([
      "rent",
      "deposit",
      "utility",
      "late_penalty",
    ]);
    expect(String(payload.allocations[0].invoice)).toBe(String(rentInvoice._id));
    expect(String(payload.allocations[1].invoice)).toBe(String(depositInvoice._id));
    expect(String(payload.allocations[2].invoice)).toBe(String(utilityInvoice._id));
    expect(String(payload.allocations[3].invoice)).toBe(String(penaltyInvoice._id));
    expect(payload.allocations.map((row) => row.appliedAmount)).toEqual([10000, 5000, 3000, 2000]);

    // Description auto-built via buildReceiptAllocationLabel — its part order is
    // Rent, Utility, Deposit, Penalty (distinct from the priority allocation order above).
    expect(payload.description).toBe("Manual Receipt – Rent + Utility + Deposit + Penalty");

    // Every open invoice is now fully covered — none should remain pending elsewhere.
    expect(payload.allocations.every((row) => row.afterOutstanding === 0)).toBe(true);
  }, 60000);

  it("leaves a remainder unapplied when the receipt exceeds all open invoices and reflects it in the description", async () => {
    const { tenant, unit, property, company, landlord } = await createTestLease({});
    const user = await createTestUser({ company });
    const accounts = await createTestChartOfAccounts(company._id);
    const chartAccount = accounts.find((a) => a.code === "1200") || accounts[0];

    const dueDate = new Date(2026, 2, 1);
    const invoiceDate = new Date(2026, 1, 25);

    await createTestTenantInvoice({
      company, property, landlord, tenant, unit, chartAccount, createdBy: user,
      category: "RENT_CHARGE", amount: 10000, invoiceDate, dueDate,
    });

    const { statusCode, payload } = await callController(createPayment, {
      user,
      body: {
        tenant: String(tenant._id),
        unit: String(unit._id),
        amount: 12000,
        referenceNumber: `REF-${Date.now()}-2`,
        cashbook: "Main Cashbook",
        paymentMethod: "cash",
        paymentDate: new Date(2026, 2, 5),
        month: 3,
        year: 2026,
      },
    });

    expect(statusCode).toBe(200);
    expect(payload.allocationSummary.rent).toBe(10000);
    expect(payload.allocationSummary.unapplied).toBe(2000);
    expect(payload.description).toBe("Manual Receipt – Rent + Unapplied");
  }, 60000);
});

describe("autoApplyPrepayments — targets the chronologically earliest outstanding invoice", () => {
  it("clears an EARLIER unpaid invoice of the same type, not just whichever invoice triggered the call (JANE DOE regression)", async () => {
    // Reproduces the bug: a tenant's September rent invoice got created (in the DB)
    // before their August one — invoice CREATION order, not billing PERIOD order. A
    // held "Rent Prepayment" credit must still clear the earlier (August) bill first,
    // not whichever invoice happened to trigger autoApplyPrepayments.
    const { tenant, unit, property, company, landlord } = await createTestLease({ rentAmount: 17000 });
    const accounts = await createTestChartOfAccounts(company._id);
    const chartAccount = accounts.find((a) => a.code === "1200") || accounts[0];
    const invoiceAuthor = await createTestUser({ company });

    const augInvoice = await createTestTenantInvoice({
      company, property, landlord, tenant, unit, chartAccount, createdBy: invoiceAuthor,
      category: "RENT_CHARGE", amount: 17000, outstanding: 17000,
      invoiceDate: new Date(2026, 7, 1), dueDate: new Date(2026, 7, 5),
    });
    const sepInvoice = await createTestTenantInvoice({
      company, property, landlord, tenant, unit, chartAccount, createdBy: invoiceAuthor,
      category: "RENT_CHARGE", amount: 17000, outstanding: 17000,
      invoiceDate: new Date(2026, 8, 1), dueDate: new Date(2026, 8, 5),
    });

    // A confirmed receipt holding a 2,000 "Rent Prepayment" — the same shape the New
    // Receipt / Allocation Workspace pages create.
    const receipt = await RentPayment.create({
      tenant: tenant._id, unit: unit._id, business: company._id,
      amount: 2000, paymentType: "rent", paymentDate: new Date(2026, 6, 16),
      referenceNumber: `REF-${Date.now()}`, receiptNumber: `REC-${Date.now()}`,
      paymentMethod: "mobile_money", month: 7, year: 2026, isConfirmed: true,
      allocations: [{
        invoice: null, invoiceNumber: "", category: "RENT_CHARGE", priorityGroup: "rent",
        utilityType: "", appliedAmount: 2000, beforeOutstanding: 0, afterOutstanding: 0,
        description: "Rent Prepayment", billItemKey: "rent", prepaymentLabel: "Rent Prepayment",
        isPrepayment: true,
      }],
      allocationSummary: { rent: 0, deposit: 0, utility: 0, latePenalty: 0, debitNote: 0, other: 0, unapplied: 2000 },
    });

    // Simulate September's invoice being the one that triggers auto-apply (e.g. created
    // first during catch-up billing) — the fix must still redirect to August.
    await autoApplyPrepayments({
      businessId: String(company._id), tenantId: String(tenant._id), invoice: sepInvoice, actorId: null,
    });

    const updatedReceipt = await RentPayment.findById(receipt._id).lean();
    const appliedRow = updatedReceipt.allocations.find((a) => !a.isPrepayment && Number(a.appliedAmount) > 0);
    expect(String(appliedRow.invoice)).toBe(String(augInvoice._id));
    expect(appliedRow.appliedAmount).toBe(2000);
    expect(updatedReceipt.allocationSummary.unapplied).toBe(0);
    expect(updatedReceipt.allocationSummary.rent).toBe(2000);

    const [updatedAug, updatedSep] = await Promise.all([
      TenantInvoice.findById(augInvoice._id).select("outstanding status").lean(),
      TenantInvoice.findById(sepInvoice._id).select("outstanding status").lean(),
    ]);
    expect(updatedAug.outstanding).toBe(15000);
    expect(updatedAug.status).toBe("partially_paid");
    // September must be untouched — the credit never should have reached it.
    expect(updatedSep.outstanding).toBe(17000);
    expect(updatedSep.status).toBe("pending");
  }, 60000);
});
