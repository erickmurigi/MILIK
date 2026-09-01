// Regression test for the `lease.property` bug: Lease has no `property` field of
// its own (it's only reachable via unit.property) — processCompany() used to filter
// on a field that never existed, silently skipping every lease. This test fails if
// that regresses.
import { describe, it, expect } from "vitest";
import { processAutoRentInvoices } from "./autoRentInvoicingService.js";
import TenantInvoice from "../models/TenantInvoice.js";
import {
  createTestCompany,
  createTestChartOfAccounts,
  createTestCompanySettings,
  createTestLease,
} from "../test/factories.js";

describe("processAutoRentInvoices", () => {
  it("creates one RENT_CHARGE invoice for an active, auto-invoiced lease", async () => {
    const company = await createTestCompany();
    await createTestChartOfAccounts(company._id);
    await createTestCompanySettings({
      company,
      autoInvoicing: { enabled: true, billingDay: 1 },
    });

    const { lease, tenant } = await createTestLease({
      company,
      rentAmount: 20000,
      autoInvoice: true,
      status: "active",
    });

    const result = await processAutoRentInvoices(company._id, new Date(), { forceRun: true });

    expect(result).toHaveLength(1);
    expect(result[0].created).toBe(1);
    expect(result[0].skipped).toBe(0);
    expect(result[0].errors).toHaveLength(0);

    const invoices = await TenantInvoice.find({ tenant: tenant._id, business: company._id }).lean();
    expect(invoices).toHaveLength(1);
    expect(invoices[0].category).toBe("RENT_CHARGE");
    expect(invoices[0].amount).toBe(20000);
    expect(String(invoices[0].tenant)).toBe(String(tenant._id));
    expect(String(invoices[0].unit)).toBe(String(lease.unit));
  });
});
