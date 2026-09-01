// Integration tests for landlord CRUD.
import { describe, it, expect } from "vitest";
import { callController } from "../../test/callController.js";
import {
  createTestCompany,
  createTestLandlord,
  createTestProperty,
  createTestUser,
} from "../../test/factories.js";
import {
  createLandlord,
  getLandlords,
  getLandlord,
  updateLandlord,
  deleteLandlord,
} from "./landlord.js";

describe("createLandlord", () => {
  it("creates a landlord with an auto-generated sequential code", async () => {
    const company = await createTestCompany();
    const user = await createTestUser({ company });

    const { statusCode, payload } = await callController(createLandlord, {
      user,
      body: { landlordName: "Jane Doe", landlordType: "Individual", email: "jane@example.com" },
    });

    expect(statusCode).toBe(201);
    expect(payload.success).toBe(true);
    expect(payload.data.landlordName).toBe("Jane Doe");
    expect(payload.data.landlordCode).toMatch(/^LL\d{3}$/);
  });

  it("rejects a duplicate email within the same company", async () => {
    const company = await createTestCompany();
    const user = await createTestUser({ company });
    await createTestLandlord({ company, email: "dup@example.com" });

    await expect(
      callController(createLandlord, {
        user,
        body: { landlordName: "Duplicate Landlord", email: "dup@example.com" },
      })
    ).rejects.toThrow(/Email already exists/);
  });

  it("rejects landlord creation with no name", async () => {
    const company = await createTestCompany();
    const user = await createTestUser({ company });

    await expect(
      callController(createLandlord, { user, body: {} })
    ).rejects.toThrow(/Landlord name is required/);
  });
});

describe("getLandlords", () => {
  it("lists landlords scoped to the company with active property counts", async () => {
    const company = await createTestCompany();
    const { landlord } = await createTestLandlord({ company });
    await createTestProperty({ company, landlord });

    const user = await createTestUser({ company });
    const { statusCode, payload } = await callController(getLandlords, { user });

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    const listed = payload.data.find((l) => String(l._id) === String(landlord._id));
    expect(listed).toBeTruthy();
    expect(listed.activeProperties).toBe(1);
  });

  it("does not leak landlords from other companies", async () => {
    const companyA = await createTestCompany();
    const companyB = await createTestCompany();
    await createTestLandlord({ company: companyA });
    await createTestLandlord({ company: companyB });

    const userA = await createTestUser({ company: companyA });
    const { payload } = await callController(getLandlords, { user: userA });

    payload.data.forEach((l) => {
      expect(String(l.company._id || l.company)).toBe(String(companyA._id));
    });
  });
});

describe("updateLandlord", () => {
  it("updates landlord fields and propagates the new name/contact to linked properties", async () => {
    const company = await createTestCompany();
    const { landlord } = await createTestLandlord({ company, landlordName: "Old Name" });
    const { property } = await createTestProperty({ company, landlord });
    const user = await createTestUser({ company });

    const { statusCode, payload } = await callController(updateLandlord, {
      user,
      params: { id: String(landlord._id) },
      body: { landlordName: "New Name" },
    });

    expect(statusCode).toBe(200);
    expect(payload.data.landlordName).toBe("New Name");

    const Property = (await import("../../models/Property.js")).default;
    const refreshedProperty = await Property.findById(property._id).lean();
    const linkedEntry = refreshedProperty.landlords.find(
      (l) => String(l.landlordId) === String(landlord._id)
    );
    expect(linkedEntry.name).toBe("New Name");
  });
});

describe("deleteLandlord", () => {
  it("blocks deletion of a landlord that still has linked properties", async () => {
    const company = await createTestCompany();
    const { landlord } = await createTestLandlord({ company });
    await createTestProperty({ company, landlord });
    const user = await createTestUser({ company });

    await expect(
      callController(deleteLandlord, { user, params: { id: String(landlord._id) } })
    ).rejects.toThrow(/existing properties/);
  });

  it("deletes a landlord with no linked properties", async () => {
    const company = await createTestCompany();
    const { landlord } = await createTestLandlord({ company });
    const user = await createTestUser({ company });

    const { statusCode, payload } = await callController(deleteLandlord, {
      user,
      params: { id: String(landlord._id) },
    });

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
  });
});
