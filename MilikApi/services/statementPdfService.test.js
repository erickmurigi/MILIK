// Regression test for the printed/downloaded landlord statement PDF's "Payments
// Collected Directly by Landlord" table showing "-" for Unit, Tenant, and Reference
// on every row. Root cause: sanitizePrintableSections() ran every section (additions,
// expenses, direct-to-landlord, advance recoveries, early payouts) through one generic
// normalizePrintableRow() that only keeps date/description/amount/category/sourceId —
// silently dropping the unit/tenantName/receiptRef fields the print template
// (statementPdfService.js's "Payments Collected Directly by Landlord" table) actually
// reads, even though generateLandlordStatement() supplies them correctly upstream (the
// same data the on-screen Workspace view renders without issue).
import { describe, it, expect } from "vitest";
import { sanitizePrintableSections } from "./statementPdfService.js";

describe("sanitizePrintableSections", () => {
  it("preserves unit, tenantName, receiptRef and typeLabel on direct-to-landlord rows", () => {
    const rawDirectToLandlordRows = [
      {
        date: new Date("2026-09-05"),
        description: "MICHAEL WAWERU — Rent (Direct)",
        amount: 36000,
        category: "direct_to_landlord",
        sourceId: "rp1",
        tenantName: "MICHAEL WAWERU",
        unit: "601",
        paymentType: "rent",
        typeLabel: "Rent",
        receiptRef: "UH5KS3WUMA",
      },
      {
        date: new Date("2026-09-05"),
        description: "FRIDA NGENDO MWANGI — Rent (Direct)",
        amount: 36000,
        category: "direct_to_landlord",
        sourceId: "rp2",
        tenantName: "FRIDA NGENDO MWANGI",
        unit: "602",
        paymentType: "rent",
        typeLabel: "Rent",
        receiptRef: "UHTCY4RRZN",
      },
    ];

    const { directToLandlordRows } = sanitizePrintableSections({ directToLandlordRows: rawDirectToLandlordRows });

    expect(directToLandlordRows).toHaveLength(2);
    expect(directToLandlordRows[0]).toMatchObject({
      unit: "601",
      tenantName: "MICHAEL WAWERU",
      typeLabel: "Rent",
      receiptRef: "UH5KS3WUMA",
      amount: 36000,
    });
    expect(directToLandlordRows[1]).toMatchObject({
      unit: "602",
      tenantName: "FRIDA NGENDO MWANGI",
      typeLabel: "Rent",
      receiptRef: "UHTCY4RRZN",
      amount: 36000,
    });
  });

  it("still filters out zero/negative-amount direct-to-landlord rows", () => {
    const { directToLandlordRows } = sanitizePrintableSections({
      directToLandlordRows: [
        { amount: 0, unit: "1", tenantName: "Zero Row", receiptRef: "R1" },
        { amount: 5000, unit: "2", tenantName: "Real Row", receiptRef: "R2" },
      ],
    });

    expect(directToLandlordRows).toHaveLength(1);
    expect(directToLandlordRows[0].tenantName).toBe("Real Row");
  });

  it("leaves the other sections' shape unchanged (date/description/amount/category/sourceId only)", () => {
    const { expenseRows } = sanitizePrintableSections({
      expenseRows: [
        { date: new Date("2026-09-01"), description: "Plumbing repair", amount: 4500, category: "maintenance", sourceId: "exp1", unit: "should-not-appear" },
      ],
    });

    expect(expenseRows).toHaveLength(1);
    expect(expenseRows[0]).toEqual({
      date: expect.any(Date),
      description: "Plumbing repair",
      amount: 4500,
      category: "maintenance",
      sourceId: "exp1",
    });
    expect(expenseRows[0].unit).toBeUndefined();
  });
});
