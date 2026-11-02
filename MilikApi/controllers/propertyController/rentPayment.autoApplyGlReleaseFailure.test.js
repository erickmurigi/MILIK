// Regression test for a real production bug found via a GL-vs-document drift audit on live data:
// autoApplyPrepayments saved the receipt (with its held prepayment reduced/removed and the matching
// invoice marked paid) BEFORE attempting the Unallocated Receipts (2130) GL release, and the release
// was wrapped in a non-fatal try/catch that only console.error'd on failure. Whenever the release
// failed or was skipped, the receipt document ended up claiming the money was applied while the GL
// never actually moved — Unallocated Receipts stayed overstated relative to the real unapplied
// balance (confirmed for receipt REC00464 and 7 others, totalling KES 33,500 across one company).
// The fix reorders this: the GL release is attempted first, and the receipt's allocations/summary
// are only persisted (and the target invoice's outstanding only reduced) if that release actually
// succeeds. See rentPayment.js's autoApplyPrepayments for the fix and full reasoning.
import { describe, it, expect } from "vitest";
import { callController } from "../../test/callController.js";
import { createTestLease, createTestUser, createTestChartOfAccounts } from "../../test/factories.js";
import { createTestTenantInvoice } from "../../test/factories.payments.js";
import { createPayment, autoApplyPrepayments } from "./rentPayment.js";
import RentPayment from "../../models/RentPayment.js";
import TenantInvoice from "../../models/TenantInvoice.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";

describe("autoApplyPrepayments — does not persist a release that never reached the GL", () => {
  it("leaves the receipt and target invoice untouched when the Unallocated Receipts release fails", async () => {
    const { tenant, unit, property, company, landlord } = await createTestLease({ rentAmount: 15000 });
    const user = await createTestUser({ company });
    const accounts = await createTestChartOfAccounts(company._id);
    const chartAccount = accounts.find((a) => a.code === "1200") || accounts[0];
    const invoiceAuthor = await createTestUser({ company });

    const invoiceA = await createTestTenantInvoice({
      company, property, landlord, tenant, unit, chartAccount, createdBy: invoiceAuthor,
      category: "RENT_CHARGE", amount: 15000,
      invoiceDate: new Date(2026, 1, 1), dueDate: new Date(2026, 1, 5),
    });

    // Overpay by 2,000 on a real, GL-posted receipt — the excess is auto-tagged as a held
    // "Rent Prepayment" and 2,000 is actually credited to Unallocated Receipts (2130).
    const { statusCode: payStatus, payload: receiptPayload } = await callController(createPayment, {
      user,
      body: {
        tenant: String(tenant._id), unit: String(unit._id), amount: 17000,
        referenceNumber: `AUTOAPPLY-FAIL-${Date.now()}`,
        cashbook: "Main Cashbook", paymentMethod: "bank_transfer",
        paymentDate: new Date(2026, 1, 3), month: 2, year: 2026, isConfirmed: true,
      },
    });
    expect(payStatus).toBe(200);

    const receiptBefore = await RentPayment.findById(receiptPayload._id).lean();
    expect(receiptBefore.journalGroupId).toBeTruthy();
    expect(receiptBefore.allocationSummary.unapplied).toBe(2000);

    const glEntriesBefore = await FinancialLedgerEntry.find({
      business: company._id,
      sourceTransactionId: String(receiptPayload._id),
    }).lean();
    expect(glEntriesBefore.length).toBeGreaterThan(0);

    // Simulate a real-world failure mode: the liability account got deactivated between the
    // receipt being posted and the next invoice triggering auto-apply.
    const unallocatedAccount = await ChartOfAccount.findOne({ business: company._id, code: "2130" });
    expect(unallocatedAccount).toBeTruthy();
    unallocatedAccount.isActive = false;
    await unallocatedAccount.save();

    const invoiceB = await createTestTenantInvoice({
      company, property, landlord, tenant, unit, chartAccount, createdBy: invoiceAuthor,
      category: "RENT_CHARGE", amount: 2000, outstanding: 2000,
      invoiceDate: new Date(2026, 2, 1), dueDate: new Date(2026, 2, 5),
    });

    await autoApplyPrepayments({
      businessId: String(company._id), tenantId: String(tenant._id), invoice: invoiceB, actorId: String(user._id),
    });

    // The receipt must be left exactly as it was — still holding the 2,000 as a held prepayment,
    // not silently marked as applied to invoiceB while the GL never moved.
    const receiptAfter = await RentPayment.findById(receiptPayload._id).lean();
    expect(receiptAfter.allocationSummary.unapplied).toBe(2000);
    const prepaymentRow = receiptAfter.allocations.find((a) => !a.invoice && a.isPrepayment);
    expect(prepaymentRow?.appliedAmount).toBe(2000);
    expect(receiptAfter.allocations.some((a) => String(a.invoice) === String(invoiceB._id))).toBe(false);

    // invoiceB must remain fully outstanding — it was never actually paid.
    const invoiceBAfter = await TenantInvoice.findById(invoiceB._id).select("outstanding status").lean();
    expect(invoiceBAfter.outstanding).toBe(2000);
    expect(invoiceBAfter.status).toBe("pending");

    // No new GL activity was created for this receipt beyond the original posting.
    const glEntriesAfter = await FinancialLedgerEntry.find({
      business: company._id,
      sourceTransactionId: String(receiptPayload._id),
    }).lean();
    expect(glEntriesAfter.length).toBe(glEntriesBefore.length);
  }, 60000);
});
