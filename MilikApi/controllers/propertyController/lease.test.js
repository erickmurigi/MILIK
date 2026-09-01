import { describe, it, expect } from "vitest";
import { createLease, renewLease, updateLease } from "./lease.js";
import { callController } from "../../test/callController.js";
import Lease from "../../models/Lease.js";
import {
  createTestTenant,
  createTestUser,
} from "../../test/factories.js";

describe("createLease", () => {
  it("creates a lease for a tenant/unit and auto-resolves the landlord from the property", async () => {
    const { tenant, unit, company, landlord } = await createTestTenant({});
    const user = await createTestUser({ company });

    const startDate = new Date(new Date().getFullYear(), 0, 1);
    const endDate = new Date(new Date().getFullYear() + 1, 0, 1);

    const { statusCode, payload } = await callController(createLease, {
      body: {
        tenant: String(tenant._id),
        unit: String(unit._id),
        startDate,
        endDate,
        rentAmount: unit.rent,
        depositAmount: unit.deposit,
        status: "active",
      },
      user,
    });

    expect(statusCode).toBe(201);
    expect(payload.agreementNumber).toMatch(/^AGR-\d{4}-\d{4}$/);
    expect(String(payload.landlord?._id || payload.landlord)).toBe(String(landlord._id));
    expect(payload.status).toBe("active");
  });
});

describe("renewLease", () => {
  it("renews an active lease: original becomes 'renewed', a new active lease is created", async () => {
    const { tenant, unit, company } = await createTestTenant({});
    const user = await createTestUser({ company });

    const startDate = new Date(new Date().getFullYear() - 1, 0, 1);
    const endDate = new Date(new Date().getFullYear(), 0, 1);

    const created = await callController(createLease, {
      body: {
        tenant: String(tenant._id),
        unit: String(unit._id),
        startDate,
        endDate,
        rentAmount: unit.rent,
        depositAmount: unit.deposit,
        status: "active",
      },
      user,
    });
    const originalLeaseId = created.payload._id;

    const { statusCode, payload } = await callController(renewLease, {
      params: { id: String(originalLeaseId) },
      body: {},
      user,
    });

    expect(statusCode).toBe(200);
    expect(payload.status).toBe("active");
    expect(String(payload.renewalOf)).toBe(String(originalLeaseId));
    expect(String(payload._id)).not.toBe(String(originalLeaseId));

    const originalLease = await Lease.findById(originalLeaseId).lean();
    expect(originalLease.status).toBe("renewed");
  });
});

describe("updateLease termination", () => {
  it("terminates an active lease via updateLease(status='terminated')", async () => {
    const { tenant, unit, company } = await createTestTenant({});
    const user = await createTestUser({ company });

    const startDate = new Date(new Date().getFullYear(), 0, 1);
    const endDate = new Date(new Date().getFullYear() + 1, 0, 1);

    const created = await callController(createLease, {
      body: {
        tenant: String(tenant._id),
        unit: String(unit._id),
        startDate,
        endDate,
        rentAmount: unit.rent,
        depositAmount: unit.deposit,
        status: "active",
      },
      user,
    });
    const leaseId = created.payload._id;

    const { statusCode, payload } = await callController(updateLease, {
      params: { id: String(leaseId) },
      body: { status: "terminated", terminationReason: "Tenant moved out" },
      user,
    });

    expect(statusCode).toBe(200);
    expect(payload.status).toBe("terminated");
    expect(payload.terminationReason).toBe("Tenant moved out");
    expect(payload.terminatedAt).toBeTruthy();
  });
});
