import { describe, it, expect } from "vitest";
import { createTenant, getTenant, getTenants, updateTenant, updateTenantStatus, transferTenantUnit } from "./tenants.js";
import { callController } from "../../test/callController.js";
import Unit from "../../models/Unit.js";
import Tenant from "../../models/Tenant.js";
import Lease from "../../models/Lease.js";
import {
  createTestUnit,
  createTestTenant,
  createTestUser,
  createTestLease,
  createTestChartOfAccounts,
  createTestProperty,
} from "../../test/factories.js";
import { createTestInvoice } from "../../test/factories.landlord.js";

// Regression test: a tenant occupying more than one unit used to get exactly ONE
// Lease record (tied to their primary unit only) — syncTenantLeaseRecord resolved
// only tenantDoc.unit and never looped tenantDoc.additionalUnits. Since
// autoRentInvoicingService.js bills strictly off active Lease records, every unit
// beyond the tenant's primary one was silently skipped by auto-invoicing, even
// though it had been billed correctly every month before auto-invoicing replaced
// manual booking. Fixed with syncTenantLeaseRecordsForUnits — one Lease per
// occupied unit, each billing only that unit's own rent (not the tenant's combined
// total, which would double/triple-bill once auto-invoicing sums every active lease).
describe("multi-unit tenant lease sync", () => {
  it("creates one Lease per occupied unit, each carrying only that unit's own rent", async () => {
    const { property, company } = await createTestProperty({});
    const { unit: unitA } = await createTestUnit({ property, company, rent: 8000 });
    const { unit: unitB } = await createTestUnit({ property, company, rent: 12000 });
    const user = await createTestUser({ company });

    const { statusCode, payload } = await callController(createTenant, {
      body: {
        unit: String(unitA._id),
        additionalUnits: [String(unitB._id)],
        name: "Multi Unit Tenant",
        rent: 20000, // the tenant's COMBINED rent across both units
        moveInDate: new Date().toISOString(),
        leaseType: "at_will",
      },
      user,
    });

    expect(statusCode).toBe(201);

    const leases = await Lease.find({
      business: company._id,
      tenant: payload.data._id,
      status: "active",
    }).lean();
    expect(leases).toHaveLength(2);

    const leaseByUnit = new Map(leases.map((l) => [String(l.unit), l]));
    expect(leaseByUnit.get(String(unitA._id))?.rentAmount).toBe(8000);
    expect(leaseByUnit.get(String(unitB._id))?.rentAmount).toBe(12000);
  });

  it("terminates every occupied unit's lease when the tenant is terminated, and restores them all", async () => {
    const { property, company } = await createTestProperty({});
    const { unit: unitA } = await createTestUnit({ property, company, rent: 5000 });
    const { unit: unitB } = await createTestUnit({ property, company, rent: 7000 });
    const user = await createTestUser({ company });

    const created = await callController(createTenant, {
      body: {
        unit: String(unitA._id),
        additionalUnits: [String(unitB._id)],
        name: "Terminate Restore Tenant",
        rent: 12000,
        moveInDate: new Date().toISOString(),
        leaseType: "at_will",
      },
      user,
    });
    const tenantId = created.payload.data._id;

    await callController(updateTenantStatus, {
      params: { id: String(tenantId) },
      body: { status: "terminated" },
      user,
    });

    const afterTerminate = await Lease.find({ business: company._id, tenant: tenantId }).lean();
    expect(afterTerminate).toHaveLength(2);
    expect(afterTerminate.every((l) => l.status === "terminated")).toBe(true);

    await callController(updateTenantStatus, {
      params: { id: String(tenantId) },
      body: { status: "active" },
      user,
    });

    const afterRestore = await Lease.find({ business: company._id, tenant: tenantId }).lean();
    expect(afterRestore).toHaveLength(2);
    expect(afterRestore.every((l) => l.status === "active")).toBe(true);
  });
});

// Regression test: getTenants used to paginate with `.sort({ createdAt: -1 })` while the
// frontend re-sorted only the received page into property/unit order for display. Because
// the server's skip/limit windows were computed against creation-recency (not the order the
// UI shows), different page sizes landed on different, non-overlapping windows of tenants —
// e.g. page 1 at limit=2 could show entirely different tenants than the first two rows of
// page 1 at limit=4. Fixed by sorting server-side by property/unit/name BEFORE paginating.
describe("getTenants pagination order", () => {
  it("paginates in property/unit order, independent of creation order, and nests across page sizes", async () => {
    const { property, company } = await createTestProperty({});
    const user = await createTestUser({ company });

    // Deliberately create units/tenants OUT OF unit-number order, so a createdAt-based
    // sort would not coincidentally match the expected ascending-by-unit display order.
    // tenantCode is explicit (not auto-generated outside the createTenant controller) —
    // the schema default is a shared `null`, which collides on the unique
    // {business, tenantCode} index once more than one tenant exists per business.
    const unitNumbers = ["305", "101", "204", "102", "306", "103"];
    for (const unitNumber of unitNumbers) {
      const { unit } = await createTestUnit({ property, company, unitNumber });
      await createTestTenant({ unit, property, company, name: `Tenant ${unitNumber}`, tenantCode: `TT-${unitNumber}` });
    }

    const expectedOrder = ["101", "102", "103", "204", "305", "306"];

    const smallPage = await callController(getTenants, {
      query: { business: String(company._id), page: "1", limit: "2" },
      user,
    });
    expect(smallPage.payload.data.map((t) => t.unit.unitNumber)).toEqual(expectedOrder.slice(0, 2));

    const largerPage = await callController(getTenants, {
      query: { business: String(company._id), page: "1", limit: "4" },
      user,
    });
    expect(largerPage.payload.data.map((t) => t.unit.unitNumber)).toEqual(expectedOrder.slice(0, 4));

    // The smaller page must be an exact prefix of the larger page — pagination windows
    // should nest, not jump to an unrelated subset when the page size changes.
    expect(smallPage.payload.data.map((t) => String(t._id))).toEqual(
      largerPage.payload.data.slice(0, 2).map((t) => String(t._id))
    );

    const secondPage = await callController(getTenants, {
      query: { business: String(company._id), page: "2", limit: "2" },
      user,
    });
    expect(secondPage.payload.data.map((t) => t.unit.unitNumber)).toEqual(expectedOrder.slice(2, 4));

    expect(smallPage.payload.total).toBe(6);
    expect(largerPage.payload.total).toBe(6);
  });
});

describe("createTenant", () => {
  it("creates a tenant on a vacant unit and occupies the unit", async () => {
    const { unit, company } = await createTestUnit({});
    const user = await createTestUser({ company });

    const { statusCode, payload } = await callController(createTenant, {
      body: {
        unit: String(unit._id),
        name: "Jane Doe",
        rent: unit.rent,
        moveInDate: new Date().toISOString(),
        leaseType: "at_will",
      },
      user,
    });

    expect(statusCode).toBe(201);
    expect(payload.success).toBe(true);
    expect(payload.data.name).toBe("Jane Doe");
    expect(payload.data.tenantCode).toMatch(/^TT\d+$/);
    expect(String(payload.data.unit?._id || payload.data.unit)).toBe(String(unit._id));

    const updatedUnit = await Unit.findById(unit._id).lean();
    expect(updatedUnit.status).toBe("occupied");
    expect(updatedUnit.isVacant).toBe(false);
  });
});

describe("getTenant BOLA guard", () => {
  it("404s (not leaks existence) when a tenant is requested from a foreign business", async () => {
    const { tenant, company: ownerCompany } = await createTestTenant({});
    const { company: foreignCompany } = await createTestUnit({});
    const foreignUser = await createTestUser({ company: foreignCompany });

    await expect(
      callController(getTenant, {
        params: { id: String(tenant._id) },
        user: foreignUser,
      })
    ).rejects.toMatchObject({ status: 404 });

    // Sanity: the same lookup succeeds for the owning business.
    const ownerUser = await createTestUser({ company: ownerCompany });
    const { statusCode, payload } = await callController(getTenant, {
      params: { id: String(tenant._id) },
      user: ownerUser,
    });
    expect(statusCode).toBe(200);
    expect(String(payload.data._id)).toBe(String(tenant._id));
  });
});

// Regression test: updateTenantStatus built its response with
// updatedTenant.toObject({ virtuals: true }) on a value fetched via a .lean() query —
// .lean() returns a plain object with no .toObject() method, so this threw a TypeError on
// every status change, terminate included. The update itself succeeded; only building the
// response crashed, which the client saw as a generic 500 "Internal Server Error".
describe("updateTenantStatus — terminate", () => {
  it("terminating an active tenant returns 200 instead of a 500 while building the response", async () => {
    const { tenant, company } = await createTestTenant({});
    const user = await createTestUser({ company });

    const { statusCode, payload } = await callController(updateTenantStatus, {
      params: { id: String(tenant._id) },
      body: {
        business: String(company._id),
        status: "terminated",
        terminationDate: new Date().toISOString(),
        terminationReason: "Test termination",
      },
      user,
    });

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.status).toBe("terminated");
    expect(payload.message).toBe("Tenant terminated successfully");
  });
});

// Regression: transferTenantUnit updated the tenant's unit/lease but never touched their
// existing invoices — an unpaid invoice already generated against the OLD unit stayed in
// the database, so it kept appearing on the landlord statement for a unit the tenant no
// longer occupies (merged into their row as a misleading "+1 more unit"). Now blocked with
// a clear error until the manager cancels/resolves that invoice first.
describe("transferTenantUnit — leaves no orphaned invoice at the previous unit", () => {
  it("blocks the transfer when an unpaid invoice at the previous unit is dated on/after the effective date", async () => {
    const leaseBundle = await createTestLease({ rentAmount: 15000 });
    const { tenant, property, company } = leaseBundle;
    await createTestChartOfAccounts(company._id);
    const { unit: newUnit } = await createTestUnit({ property, company });
    const user = await createTestUser({ company });

    const effectiveDate = new Date();
    await createTestInvoice({
      leaseBundle,
      category: "RENT_CHARGE",
      amount: 15000,
      invoiceDate: effectiveDate,
      dueDate: new Date(effectiveDate.getTime() + 7 * 24 * 60 * 60 * 1000),
    });

    await expect(
      callController(transferTenantUnit, {
        params: { id: String(tenant._id) },
        body: { newUnit: String(newUnit._id), effectiveDate: effectiveDate.toISOString() },
        user,
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "OPEN_INVOICES_AT_PREVIOUS_UNIT" });
  });

  it("allows the transfer when the tenant has no unpaid invoices at the previous unit", async () => {
    const { tenant, property, company } = await createTestLease({ rentAmount: 15000 });
    const { unit: newUnit } = await createTestUnit({ property, company });
    const user = await createTestUser({ company });

    const { statusCode, payload } = await callController(transferTenantUnit, {
      params: { id: String(tenant._id) },
      body: { newUnit: String(newUnit._id), effectiveDate: new Date().toISOString() },
      user,
    });

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(String(payload.data.unit?._id || payload.data.unit)).toBe(String(newUnit._id));
  });
});

// Regression: updateTenant (the generic edit form) applied any field unconditionally,
// including unit/additionalUnits/status on a terminated tenant — bypassing the dedicated
// Restore/Transfer flows that correctly clear termination fields and check unit
// availability. That let a terminated tenant's tenant.unit drift out of sync with reality,
// which the landlord statement (and anything else keyed off tenant.unit) then trusted.
describe("updateTenant — terminated tenant", () => {
  it("blocks a unit change on a terminated tenant", async () => {
    const { tenant, property, company } = await createTestLease({ rentAmount: 15000 });
    const { unit: otherUnit } = await createTestUnit({ property, company });
    const user = await createTestUser({ company });

    await Tenant.findByIdAndUpdate(tenant._id, { status: "terminated", terminationDate: new Date(), moveOutDate: new Date() });

    await expect(
      callController(updateTenant, {
        params: { id: String(tenant._id) },
        body: { unit: String(otherUnit._id) },
        user,
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("blocks a status change on a terminated tenant from this form", async () => {
    const { tenant, company } = await createTestLease({ rentAmount: 15000 });
    const user = await createTestUser({ company });

    await Tenant.findByIdAndUpdate(tenant._id, { status: "terminated", terminationDate: new Date(), moveOutDate: new Date() });

    await expect(
      callController(updateTenant, {
        params: { id: String(tenant._id) },
        body: { status: "active" },
        user,
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("still allows plain data corrections (e.g. phone) on a terminated tenant", async () => {
    const { tenant, company } = await createTestLease({ rentAmount: 15000 });
    const user = await createTestUser({ company });

    await Tenant.findByIdAndUpdate(tenant._id, { status: "terminated", terminationDate: new Date(), moveOutDate: new Date() });

    const { statusCode, payload } = await callController(updateTenant, {
      params: { id: String(tenant._id) },
      body: { phone: "0722123456" },
      user,
    });

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.phone).toContain("722123456");
  });
});
