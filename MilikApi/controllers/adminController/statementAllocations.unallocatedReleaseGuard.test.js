// Regression test for a real production bug found via a ledger trace on live data: the admin
// "reallocate payment" tool released a GL debit against Unallocated Receipts (2130) sized by the
// payment's STORED allocationSummary.unapplied field — which can drift out of sync with the real
// ledger (e.g. a payment originally posted fully allocated to a real invoice, with zero 2130
// activity, whose allocationSummary was later recalculated by a separate process without touching
// the GL). Releasing against that stale field debited 2130 for money that was never actually
// credited there, permanently distorting the account balance. The fix caps the release at what the
// ledger itself shows is actually outstanding on 2130 for this payment. See
// statementAllocations.js's "Step 4b" for the fix and full reasoning.
import { describe, it, expect } from "vitest";
import { callController } from "../../test/callController.js";
import { createTestLease, createTestUser, createTestChartOfAccounts } from "../../test/factories.js";
import { createTestTenantInvoice } from "../../test/factories.payments.js";
import { createPayment } from "../propertyController/rentPayment.js";
import { reallocatePayment } from "./statementAllocations.js";
import RentPayment from "../../models/RentPayment.js";
import TenantInvoice from "../../models/TenantInvoice.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";

describe("reallocatePayment — Unallocated Receipts (2130) release guard", () => {
  it("does not debit 2130 when the stored unapplied field is stale and nothing was ever credited there", async () => {
    const { tenant, unit, property, company, landlord } = await createTestLease({});
    const user = await createTestUser({ company });
    const admin = await createTestUser({ company, isSystemAdmin: true });
    const accounts = await createTestChartOfAccounts(company._id);
    const chartAccount = accounts.find((a) => a.code === "1200") || accounts[0];
    const invoiceAuthor = await createTestUser({ company });

    const invoiceA = await createTestTenantInvoice({
      company, property, landlord, tenant, unit, chartAccount, createdBy: invoiceAuthor,
      category: "RENT_CHARGE", amount: 15000, invoiceDate: new Date(2026, 1, 1), dueDate: new Date(2026, 1, 5),
    });

    // A normal receipt fully allocated to invoiceA from the start — real GL posting, zero 2130
    // activity (it never went through the "unapplied" bucket at all).
    const { statusCode: payStatus, payload: receiptPayload } = await callController(createPayment, {
      user,
      body: {
        tenant: String(tenant._id), unit: String(unit._id), amount: 15000,
        referenceNumber: `REALLOC-GUARD-${Date.now()}`,
        cashbook: "Main Cashbook", paymentMethod: "bank_transfer",
        paymentDate: new Date(2026, 1, 3), month: 2, year: 2026, isConfirmed: true,
      },
    });
    expect(payStatus).toBe(200);

    const invoiceB = await createTestTenantInvoice({
      company, property, landlord, tenant, unit, chartAccount, createdBy: invoiceAuthor,
      category: "RENT_CHARGE", amount: 15000, invoiceDate: new Date(2026, 2, 1), dueDate: new Date(2026, 2, 5),
    });

    // Simulate the real-world drift: some other process marked this payment as having an
    // unapplied balance, without ever touching the GL. This is the exact stale state found in
    // production — reproduced directly here since the upstream process that causes the drift is
    // a separate, not-yet-identified issue outside this test's scope.
    await RentPayment.findByIdAndUpdate(receiptPayload._id, { "allocationSummary.unapplied": 15000 });

    const { statusCode, payload } = await callController(reallocatePayment, {
      user: admin,
      headers: { "x-active-company-id": String(company._id) },
      body: {
        paymentId: String(receiptPayload._id),
        allocations: [{ invoiceId: String(invoiceB._id), amount: 15000 }],
        reason: "Regression test — stale unapplied field guard",
      },
    });

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);

    const unallocatedAccount = await ChartOfAccount.findOne({ business: company._id, code: "2130" }).lean();
    expect(unallocatedAccount).toBeTruthy();

    const entries = await FinancialLedgerEntry.find({
      business: company._id,
      accountId: unallocatedAccount._id,
      sourceTransactionId: String(receiptPayload._id),
    }).lean();
    expect(entries).toHaveLength(0);

    const refreshedB = await TenantInvoice.findById(invoiceB._id).lean();
    expect(refreshedB.outstanding).toBe(0);
  });
});
