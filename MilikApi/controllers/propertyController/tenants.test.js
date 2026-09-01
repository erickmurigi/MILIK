import { describe, it, expect } from "vitest";
import { createTenant, getTenant } from "./tenants.js";
import { callController } from "../../test/callController.js";
import Unit from "../../models/Unit.js";
import {
  createTestUnit,
  createTestTenant,
  createTestUser,
} from "../../test/factories.js";

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
