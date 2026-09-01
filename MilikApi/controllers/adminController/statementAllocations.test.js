// Integration tests for the admin statement-allocation correction toolkit.
import { describe, it, expect } from "vitest";
import { callController } from "../../test/callController.js";
import { createTestLease, createTestUser } from "../../test/factories.js";
import { createTestInvoice, createTestReceipt } from "../../test/factories.landlord.js";
import { reallocatePayment } from "./statementAllocations.js";
import TenantInvoice from "../../models/TenantInvoice.js";

describe("reallocatePayment", () => {
  it("reverses the old allocation and applies the new one, updating outstanding on both invoices", async () => {
    const leaseBundle = await createTestLease({ rentAmount: 10000 });
    const { tenant, company } = leaseBundle;

    // Invoice A: fully paid by the receipt we are about to reallocate.
    const invoiceABundle = await createTestInvoice({
      leaseBundle,
      category: "RENT_CHARGE",
      amount: 10000,
    });
    const { receipt } = await createTestReceipt({
      invoiceBundle: invoiceABundle,
      amount: 10000,
      allocate: true,
    });

    // Invoice B: a separate pending rent invoice for the same tenant, to be the new target.
    const { invoice: invoiceB } = await createTestInvoice({
      leaseBundle,
      category: "RENT_CHARGE",
      amount: 8000,
    });

    const admin = await createTestUser({ company, isSystemAdmin: true });

    const { statusCode, payload } = await callController(reallocatePayment, {
      user: admin,
      headers: { "x-active-company-id": String(company._id) },
      body: {
        paymentId: String(receipt._id),
        allocations: [{ invoiceId: String(invoiceB._id), amount: 10000 }],
        reason: "Admin correction test",
      },
    });

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.allocationSummary.rent).toBe(10000);
    expect(payload.allocations).toHaveLength(1);
    expect(String(payload.allocations[0].invoice)).toBe(String(invoiceB._id));

    const [refreshedA, refreshedB] = await Promise.all([
      TenantInvoice.findById(invoiceABundle.invoice._id).lean(),
      TenantInvoice.findById(invoiceB._id).lean(),
    ]);

    // Old allocation reversed: invoice A's outstanding restored to its full amount.
    expect(refreshedA.outstanding).toBe(10000);
    expect(refreshedA.status).toBe("pending");

    // New allocation applied: invoice B's outstanding reduced (capped at 0, not negative).
    expect(refreshedB.outstanding).toBe(0);
    expect(refreshedB.status).toBe("paid");
  });

  it("rejects reallocation when the submitted allocation total does not match the payment amount", async () => {
    const leaseBundle = await createTestLease({ rentAmount: 10000 });
    const { company } = leaseBundle;

    const invoiceBundle = await createTestInvoice({
      leaseBundle,
      category: "RENT_CHARGE",
      amount: 10000,
    });
    const { receipt } = await createTestReceipt({
      invoiceBundle,
      amount: 10000,
      allocate: true,
    });

    const admin = await createTestUser({ company, isSystemAdmin: true });

    const { statusCode, payload } = await callController(reallocatePayment, {
      user: admin,
      headers: { "x-active-company-id": String(company._id) },
      body: {
        paymentId: String(receipt._id),
        // Deliberately short of the payment's 10000 amount.
        allocations: [{ invoiceId: String(invoiceBundle.invoice._id), amount: 6000 }],
        reason: "Mismatched total test",
      },
    });

    expect(statusCode).toBe(400);
    expect(payload.error).toMatch(/must equal payment amount/);

    // Nothing should have changed on the invoice since the transaction was rejected/aborted.
    const unchanged = await TenantInvoice.findById(invoiceBundle.invoice._id).lean();
    expect(unchanged.outstanding).toBe(0);
    expect(unchanged.status).toBe("paid");
  });

  it("rejects when Milik Admin access is not present", async () => {
    const leaseBundle = await createTestLease({ rentAmount: 10000 });
    const { company } = leaseBundle;
    const invoiceBundle = await createTestInvoice({ leaseBundle, amount: 10000 });
    const { receipt } = await createTestReceipt({ invoiceBundle, amount: 10000 });
    const nonAdminUser = await createTestUser({ company, isSystemAdmin: false });

    const { statusCode, payload } = await callController(reallocatePayment, {
      user: nonAdminUser,
      headers: { "x-active-company-id": String(company._id) },
      body: {
        paymentId: String(receipt._id),
        allocations: [{ invoiceId: String(invoiceBundle.invoice._id), amount: 10000 }],
        reason: "Should not be allowed",
      },
    });

    expect(statusCode).toBe(403);
    expect(payload.error).toMatch(/Milik Admin/);
  });
});
