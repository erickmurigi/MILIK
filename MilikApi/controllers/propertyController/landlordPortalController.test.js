// Covers the one new authorization surface the Landlord Portal introduces: a statement
// belongs to exactly one landlord, and the portal must never let landlord B see or fetch
// landlord A's statement by id, even though both share the same company/business.
import { describe, it, expect } from "vitest";
import { callController } from "../../test/callController.js";
import { createTestCompany, createTestLandlord, createTestProperty } from "../../test/factories.js";
import LandlordStatement from "../../models/LandlordStatement.js";
import { listMyStatements, downloadMyStatementPdf, getMyLiveStatement, downloadMyLiveStatementPdf } from "./landlordPortalController.js";

const createTestStatement = async ({ business, property, landlord, ...overrides }) =>
  LandlordStatement.create({
    business,
    property,
    landlord,
    periodStart: new Date("2026-01-01"),
    periodEnd: new Date("2026-01-31"),
    statementNumber: `STMT-${Math.random().toString(36).slice(2, 8)}`,
    status: "approved",
    ...overrides,
  });

describe("landlordPortalController — statement scoping", () => {
  it("listMyStatements only returns the authenticated landlord's own statements", async () => {
    const { landlord: landlordA, company } = await createTestLandlord();
    const { landlord: landlordB } = await createTestLandlord({ company });
    const { property } = await createTestProperty({ company, landlord: landlordA });

    const statementA = await createTestStatement({ business: company._id, property: property._id, landlord: landlordA._id });
    await createTestStatement({ business: company._id, property: property._id, landlord: landlordB._id });

    const { statusCode, payload } = await callController(listMyStatements, {
      landlordPortal: { landlordId: String(landlordA._id), companyId: String(company._id) },
    });

    expect(statusCode).toBe(200);
    expect(payload.data.statements).toHaveLength(1);
    expect(payload.data.statements[0].statementNumber).toBe(statementA.statementNumber);
  });

  it("never shows draft/reviewed statements to the landlord", async () => {
    const { landlord, company } = await createTestLandlord();
    const { property } = await createTestProperty({ company, landlord });
    await createTestStatement({ business: company._id, property: property._id, landlord: landlord._id, status: "draft" });

    const { payload } = await callController(listMyStatements, {
      landlordPortal: { landlordId: String(landlord._id), companyId: String(company._id) },
    });

    expect(payload.data.statements).toHaveLength(0);
  });

  it("downloadMyStatementPdf 404s when the statement belongs to a different landlord", async () => {
    const { landlord: landlordA, company } = await createTestLandlord();
    const { landlord: landlordB } = await createTestLandlord({ company });
    const { property } = await createTestProperty({ company, landlord: landlordA });

    const statement = await createTestStatement({ business: company._id, property: property._id, landlord: landlordA._id });

    await expect(
      callController(downloadMyStatementPdf, {
        params: { statementId: String(statement._id) },
        landlordPortal: { landlordId: String(landlordB._id), companyId: String(company._id) },
      })
    ).rejects.toThrow(/not found|access denied/i);
  });
});

describe("landlordPortalController — live statement", () => {
  it("computes a live, unsaved snapshot for the landlord's own property", async () => {
    const { landlord, company } = await createTestLandlord();
    const { property } = await createTestProperty({ company, landlord });

    const { statusCode, payload } = await callController(getMyLiveStatement, {
      query: { propertyId: String(property._id), period: "this_month" },
      landlordPortal: { landlordId: String(landlord._id), companyId: String(company._id) },
    });

    expect(statusCode).toBe(200);
    expect(payload.data.property._id).toBeTruthy();
    expect(payload.data.currency).toBe("KES");
    expect(typeof payload.data.periodNet).toBe("number");
    expect(typeof payload.data.closingBalance).toBe("number");
    // The live endpoint must never persist anything — it only reuses the pure
    // computation layer (generateLandlordStatement), never the persisting wrapper.
    const LandlordStatementModel = (await import("../../models/LandlordStatement.js")).default;
    const count = await LandlordStatementModel.countDocuments({ property: property._id });
    expect(count).toBe(0);
  });

  it("404s when the property doesn't belong to the authenticated landlord", async () => {
    const { landlord: landlordA, company } = await createTestLandlord();
    const { landlord: landlordB } = await createTestLandlord({ company });
    const { property } = await createTestProperty({ company, landlord: landlordA });

    await expect(
      callController(getMyLiveStatement, {
        query: { propertyId: String(property._id) },
        landlordPortal: { landlordId: String(landlordB._id), companyId: String(company._id) },
      })
    ).rejects.toThrow(/not found|access denied/i);
  });

  it("downloadMyLiveStatementPdf 404s when the property doesn't belong to the landlord (never reaches the PDF renderer)", async () => {
    const { landlord: landlordA, company } = await createTestLandlord();
    const { landlord: landlordB } = await createTestLandlord({ company });
    const { property } = await createTestProperty({ company, landlord: landlordA });

    await expect(
      callController(downloadMyLiveStatementPdf, {
        query: { propertyId: String(property._id) },
        landlordPortal: { landlordId: String(landlordB._id), companyId: String(company._id) },
      })
    ).rejects.toThrow(/not found|access denied/i);
  });
});
