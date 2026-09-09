import { describe, it, expect } from "vitest";
import { createTenant, getTenant, updateTenant, updateTenantStatus, transferTenantUnit } from "./tenants.js";
import { callController } from "../../test/callController.js";
import Unit from "../../models/Unit.js";
import Tenant from "../../models/Tenant.js";
import {
  createTestUnit,
  createTestTenant,
  createTestUser,
  createTestLease,
  createTestChartOfAccounts,
} from "../../test/factories.js";
import { createTestInvoice } from "../../test/factories.landlord.js";

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
