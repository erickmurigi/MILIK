// Integration tests for property creation/listing.
import { describe, it, expect } from "vitest";
import { callController } from "../../test/callController.js";
import {
  createTestCompany,
  createTestLandlord,
  createTestProperty,
  createTestUser,
} from "../../test/factories.js";
import Property from "../../models/Property.js";
import { createProperty, getProperties, getProperty } from "./property.js";

describe("createProperty", () => {
  it("creates a property linked to a landlord and assigns a sequential property code", async () => {
    const company = await createTestCompany();
    const { landlord } = await createTestLandlord({ company });
    const user = await createTestUser({ company });

    const { statusCode, payload } = await callController(createProperty, {
      user,
      body: {
        propertyName: "Sunrise Apartments",
        propertyType: "Residential",
        landlords: [{ landlordId: String(landlord._id), name: landlord.landlordName }],
      },
    });

    expect(statusCode).toBe(201);
    expect(payload.success).toBe(true);
    expect(payload.data.propertyName).toBe("Sunrise Apartments");
    expect(payload.data.propertyCode).toMatch(/^PRO\d{3}$/);
    expect(payload.data.landlords).toHaveLength(1);
    expect(String(payload.data.landlords[0].landlordId._id || payload.data.landlords[0].landlordId)).toBe(
      String(landlord._id)
    );
    // A control account must be provisioned for every property on creation.
    expect(payload.data.controlAccount).toBeTruthy();
  });

  it("rejects property creation with no valid landlord for a non self-managing company", async () => {
    const company = await createTestCompany();
    const user = await createTestUser({ company });

    const { statusCode, payload } = await callController(createProperty, {
      user,
      body: {
        propertyName: "No Landlord Property",
        propertyType: "Residential",
        landlords: [],
      },
    });

    expect(statusCode).toBe(400);
    expect(payload.success).toBe(false);
  });
});

describe("getProperties", () => {
  // Regression guard: getProperties' .select() must include utilityRates, otherwise the
  // list response silently drops a property's configured utility rates even though the
  // field is populated in the database.
  it("includes utilityRates in the list response for a property that has them configured", async () => {
    const company = await createTestCompany();
    const { property } = await createTestProperty({ company });

    await Property.findByIdAndUpdate(property._id, {
      utilityRates: [
        { utilityType: "Water", unitCost: 150, billingCycle: "monthly", isActive: true },
        { utilityType: "Garbage", unitCost: 500, billingCycle: "monthly", isActive: true },
      ],
    });

    const user = await createTestUser({ company });
    const { statusCode, payload } = await callController(getProperties, { user });

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    const listed = payload.data.find((p) => String(p._id) === String(property._id));
    expect(listed).toBeTruthy();
    expect(Array.isArray(listed.utilityRates)).toBe(true);
    expect(listed.utilityRates).toHaveLength(2);
    expect(listed.utilityRates.map((r) => r.utilityType).sort()).toEqual(["Garbage", "Water"]);
    expect(listed.utilityRates[0].unitCost).toBeGreaterThan(0);
  });

  it("scopes results to the requesting user's business", async () => {
    const companyA = await createTestCompany();
    const companyB = await createTestCompany();
    await createTestProperty({ company: companyA });
    await createTestProperty({ company: companyB });

    const userA = await createTestUser({ company: companyA });
    const { statusCode, payload } = await callController(getProperties, { user: userA });

    expect(statusCode).toBe(200);
    expect(payload.data.length).toBeGreaterThan(0);
    payload.data.forEach((p) => {
      expect(String(p.business)).toBe(String(companyA._id));
    });
  });
});

describe("getProperty", () => {
  it("returns a single property with its pctrl balance computed", async () => {
    const company = await createTestCompany();
    const { property } = await createTestProperty({ company });
    const user = await createTestUser({ company });

    const { statusCode, payload } = await callController(getProperty, {
      user,
      params: { id: String(property._id) },
    });

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(String(payload.data._id)).toBe(String(property._id));
    expect(payload.data.pctrlBalance).toBe(0);
  });

  it("returns 403 when the property belongs to a different business", async () => {
    const companyA = await createTestCompany();
    const companyB = await createTestCompany();
    const { property } = await createTestProperty({ company: companyA });
    const userB = await createTestUser({ company: companyB });

    const { statusCode, payload } = await callController(getProperty, {
      user: userB,
      params: { id: String(property._id) },
    });

    expect(statusCode).toBe(403);
    expect(payload.success).toBe(false);
  });
});
