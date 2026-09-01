// Regression test for the "credit note does not detect all invoice types" bug:
// getCreditableTenantInvoices (the backing endpoint for the Credit Note "Source
// Invoice" picker in InvoiceNotes.jsx) was reported to silently omit a real,
// posted, outstanding UTILITY_CHARGE invoice from its results. This test proves
// the bug for every invoice category (not just UTILITY_CHARGE) and must keep
// passing for all of them after the fix.
import { describe, it, expect } from "vitest";
import { getCreditableTenantInvoices } from "./tenantInvoices.js";
import { callController } from "../../test/callController.js";
import { createTestLease } from "../../test/factories.js";
import { createTestTenantInvoice } from "../../test/factories.payments.js";

describe("getCreditableTenantInvoices", () => {
  const categories = ["RENT_CHARGE", "UTILITY_CHARGE", "DEPOSIT_CHARGE", "LATE_PENALTY_CHARGE", "OTHER_CHARGE"];

  it.each(categories)("returns a posted, outstanding %s invoice as creditable", async (category) => {
    const { tenant, unit, property, company, landlord } = await createTestLease({});

    const invoice = await createTestTenantInvoice({
      company,
      property,
      landlord,
      tenant,
      unit,
      category,
      amount: 5070,
      status: "pending",
      postingStatus: "posted",
    });

    const { statusCode, payload } = await callController(getCreditableTenantInvoices, {
      query: { business: String(company._id), tenant: String(tenant._id) },
    });

    expect(statusCode).toBe(200);
    const match = payload.find((row) => String(row._id) === String(invoice._id));
    expect(
      match,
      `Expected ${category} invoice ${invoice._id} (amount 5070, posted, pending) to appear in creditable invoices, got: ${JSON.stringify(
        payload.map((r) => ({ id: r._id, category: r.category, postingStatus: r.postingStatus, computedStatus: r.computedStatus }))
      )}`
    ).toBeTruthy();
    expect(match.category).toBe(category);
    expect(Number(match.remainingCreditableAmount)).toBeCloseTo(5070, 2);

    // Root cause regression guard: InvoiceNotes.jsx's Credit Note picker filters
    // sourceInvoiceOptions by resolvePropertyId(invoice) once a property is selected
    // (which the modal always requires before a tenant can be picked). That helper
    // reads invoice.property (falling back to invoice.unit.property, never populated
    // here) — if "property" isn't projected onto the snapshot, every invoice of every
    // category is silently dropped from the picker the moment a property is selected.
    expect(String(match.property)).toBe(String(property._id));
  });
});
