// Regression test for a real production bug found while tracing a GL-vs-document drift: all 8
// drifted receipts in the affected company shared one fingerprint — each referenced a TenantInvoice
// id that no longer existed anywhere in the database. deleteTenantInvoice's hard-delete branch (for
// off-ledger or never-posted invoices) called TenantInvoice.deleteOne(...) with no check for whether
// any RentPayment had already allocated money to that invoice. The receipt was left holding a
// dangling allocation referencing a phantom invoice — its document claimed the money was applied,
// while the GL side of that allocation was orphaned or never happened at all. The fix blocks the
// delete outright (same convention as the existing paid/partially_paid and active-notes checks)
// whenever a non-cancelled, non-reversed receipt still has an allocation against the invoice. See
// tenantInvoices.js's deleteTenantInvoice for the fix and full reasoning.
import { describe, it, expect } from "vitest";
import { callController } from "../../test/callController.js";
import { createTestLease, createTestUser, createTestChartOfAccounts } from "../../test/factories.js";
import { createTestTenantInvoice } from "../../test/factories.payments.js";
import { deleteTenantInvoice } from "./tenantInvoices.js";
import RentPayment from "../../models/RentPayment.js";
import TenantInvoice from "../../models/TenantInvoice.js";

describe("deleteTenantInvoice — receipt allocation guard", () => {
  it("refuses to delete (even via the hard-delete path) an invoice a receipt has already allocated money to", async () => {
    const { tenant, unit, property, company, landlord } = await createTestLease({ rentAmount: 15000 });
    const user = await createTestUser({ company });
    const accounts = await createTestChartOfAccounts(company._id);
    const chartAccount = accounts.find((a) => a.code === "1200") || accounts[0];
    const invoiceAuthor = await createTestUser({ company });

    // Still "pending"/"unposted" with no ledger entries of its own — exactly the shape that
    // qualifies for the hard-delete branch (canHardDeleteWithoutAuditReversal) if nothing stops it.
    const invoice = await createTestTenantInvoice({
      company, property, landlord, tenant, unit, chartAccount, createdBy: invoiceAuthor,
      category: "RENT_CHARGE", amount: 15000, status: "pending", postingStatus: "unposted",
      invoiceDate: new Date(2026, 1, 1), dueDate: new Date(2026, 1, 5),
    });

    // Mirrors the real-world pattern found in production: a receipt's allocations array points at
    // this invoice with real appliedAmount, independent of the invoice's own status/ledger state.
    const receipt = await RentPayment.create({
      tenant: tenant._id, unit: unit._id, business: company._id,
      amount: 15000, paymentType: "rent", paymentDate: new Date(2026, 1, 3),
      referenceNumber: `DEL-GUARD-${Date.now()}`, receiptNumber: `REC-${Date.now()}`,
      paymentMethod: "bank_transfer", month: 2, year: 2026, isConfirmed: true,
      allocations: [{
        invoice: invoice._id, invoiceNumber: invoice.invoiceNumber, category: "RENT_CHARGE",
        priorityGroup: "rent", appliedAmount: 15000, beforeOutstanding: 15000, afterOutstanding: 0,
        description: "Rent", isPrepayment: false,
      }],
      allocationSummary: { rent: 15000, deposit: 0, utility: 0, latePenalty: 0, debitNote: 0, other: 0, unapplied: 0 },
    });

    await expect(
      callController(deleteTenantInvoice, { user, params: { id: String(invoice._id) } })
    ).rejects.toThrow(/allocated/i);

    // Invoice must still exist, untouched — the hard-delete must never have run.
    const invoiceAfter = await TenantInvoice.findById(invoice._id).lean();
    expect(invoiceAfter).toBeTruthy();
    expect(invoiceAfter.status).toBe("pending");

    // Receipt's allocation must be untouched too.
    const receiptAfter = await RentPayment.findById(receipt._id).lean();
    expect(String(receiptAfter.allocations[0].invoice)).toBe(String(invoice._id));
  }, 60000);
});
