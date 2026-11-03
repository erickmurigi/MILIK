// Regression test for the `lease.property` bug: Lease has no `property` field of
// its own (it's only reachable via unit.property) — processCompany() used to filter
// on a field that never existed, silently skipping every lease. This test fails if
// that regresses.
import { describe, it, expect } from "vitest";
import { processAutoRentInvoices } from "./autoRentInvoicingService.js";
import { createTenantInvoiceRecord } from "../controllers/propertyController/tenantInvoices.js";
import TenantInvoice from "../models/TenantInvoice.js";
import {
  createTestCompany,
  createTestChartOfAccounts,
  createTestCompanySettings,
  createTestLease,
  createTestUser,
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

  // Regression test for the real GLR double-booking incident: a lease in its SECOND (or later)
  // billing month used to get two different periodKey values depending on which code path created
  // the invoice — cron used the lease's raw startDate as the period anchor (wrong beyond month 1),
  // while the booking UI correctly walked the schedule forward to the invoiced month. Those two
  // different periodKey strings produced two different idempotencyKey strings, so the unique
  // {business, idempotencyKey} index never caught a cron invoice and a manually-booked invoice for
  // the SAME tenant/unit/month coexisting. Both paths must now derive the identical key.
  it("never lets a manual booking duplicate a cron-generated invoice for the same tenant/unit/month, even in the lease's second billing month", async () => {
    const company = await createTestCompany();
    await createTestChartOfAccounts(company._id);
    await createTestCompanySettings({ company, autoInvoicing: { enabled: true, billingDay: 1 } });
    const user = await createTestUser({ company });

    // Lease started LAST month — this is the lease's SECOND billing month, the exact case where
    // the old code (anchoring periodKey on the lease's raw startDate) went wrong. Dates are built
    // with Date.UTC, matching how this codebase actually stores "YYYY-MM-DD" dates (true UTC
    // midnight — see billingPeriodService.js) rather than a local-timezone Date constructor, which
    // would shift the stored instant onto the wrong calendar day on a positive-UTC-offset machine.
    // Pinned to UTC noon on the 15th (well clear of any month boundary) so the lease-month-offset
    // math below is stable regardless of the machine's local timezone.
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15, 12, 0, 0));
    const leaseStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const { lease, tenant, property, landlord } = await createTestLease({
      company,
      startDate: leaseStart,
      rentAmount: 18000,
      autoInvoice: true,
      status: "active",
    });

    // Cron runs for the current month — the lease's second billing cycle.
    const cronResult = await processAutoRentInvoices(company._id, today, { forceRun: true });
    expect(cronResult[0].created).toBe(1);

    const afterCron = await TenantInvoice.find({ tenant: tenant._id, business: company._id }).lean();
    expect(afterCron).toHaveLength(1);

    // Now simulate a staff member manually booking the same tenant for the same month via the
    // booking UI's path (createTenantInvoiceRecord directly, no explicit idempotencyKey — exactly
    // what the real booking endpoint sends when the UI's own period computation is bypassed, e.g.
    // a raw API retry). This must be recognized as the same period as the cron invoice and
    // rejected/deduped, not create a second invoice.
    const invoiceDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    await expect(
      createTenantInvoiceRecord({
        req: { user, body: {} },
        payload: {
          business: String(company._id),
          property: String(property._id),
          landlord: landlord?._id || landlord,
          tenant: String(tenant._id),
          unit: String(lease.unit),
          category: "RENT_CHARGE",
          amount: 18000,
          description: "Manual duplicate booking attempt",
          invoiceDate,
          dueDate: new Date(invoiceDate.getTime() + 4 * 24 * 60 * 60 * 1000),
        },
      })
    ).rejects.toThrow(/already exists/i);

    const afterManualBooking = await TenantInvoice.find({ tenant: tenant._id, business: company._id }).lean();
    expect(afterManualBooking).toHaveLength(1);
  }, 30000);
});
