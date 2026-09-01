// Integration tests for unit creation/listing.
import { describe, it, expect } from "vitest";
import { callController } from "../../test/callController.js";
import {
  createTestCompany,
  createTestProperty,
  createTestUnit,
  createTestUser,
} from "../../test/factories.js";
import { createUnit, getUnits, getUnit } from "./units.js";

describe("createUnit", () => {
  it("creates a vacant unit under a property and derives rent from property defaults when not supplied", async () => {
    const company = await createTestCompany();
    const { property } = await createTestProperty({ company });
    // Give the property a rent-per-measure default so rent-derivation is exercised.
    property.rentPerMeasure = 100;
    await property.save();

    const user = await createTestUser({ company });

    const { statusCode, payload } = await callController(createUnit, {
      user,
      body: {
        property: String(property._id),
        unitNumber: "A1",
        unitType: "1bed",
        areaSqFt: 200,
      },
    });

    expect(statusCode).toBe(201);
    expect(payload.unitNumber).toBe("A1");
    expect(payload.status).toBe("vacant");
    expect(payload.isVacant).toBe(true);
    expect(payload.rent).toBe(100 * 200);
  });

  it("rejects unit creation without a unit number", async () => {
    const company = await createTestCompany();
    const { property } = await createTestProperty({ company });
    const user = await createTestUser({ company });

    await expect(
      callController(createUnit, {
        user,
        body: { property: String(property._id), unitType: "1bed" },
      })
    ).rejects.toThrow(/Unit number is required/);
  });
});

describe("getUnits", () => {
  it("lists units for the business and reflects the total count", async () => {
    const company = await createTestCompany();
    const { property } = await createTestProperty({ company });
    await createTestUnit({ property, company });
    await createTestUnit({ property, company });

    const user = await createTestUser({ company });
    const { statusCode, payload } = await callController(getUnits, { user });

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.total).toBe(2);
    expect(payload.data).toHaveLength(2);
  });

  it("filters units by property", async () => {
    const company = await createTestCompany();
    const { property: propertyA } = await createTestProperty({ company });
    const { property: propertyB } = await createTestProperty({ company });
    await createTestUnit({ property: propertyA, company });
    await createTestUnit({ property: propertyB, company });

    const user = await createTestUser({ company });
    const { statusCode, payload } = await callController(getUnits, {
      user,
      query: { property: String(propertyA._id) },
    });

    expect(statusCode).toBe(200);
    expect(payload.total).toBe(1);
    expect(String(payload.data[0].property._id)).toBe(String(propertyA._id));
  });
});

describe("getUnit", () => {
  it("returns a single unit with currentTenant attached (null when vacant)", async () => {
    const company = await createTestCompany();
    const { unit } = await createTestUnit({ company });
    const user = await createTestUser({ company });

    const { statusCode, payload } = await callController(getUnit, {
      user,
      params: { id: String(unit._id) },
    });

    expect(statusCode).toBe(200);
    expect(String(payload._id)).toBe(String(unit._id));
    expect(payload.currentTenant).toBeNull();
    expect(payload.status).toBe("vacant");
  });
});
