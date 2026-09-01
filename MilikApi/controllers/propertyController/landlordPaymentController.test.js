// Integration tests for recording landlord payments against processed statements.
import { describe, it, expect } from "vitest";
import { callController } from "../../test/callController.js";
import {
  createTestCompany,
  createTestLandlord,
  createTestProperty,
  createTestUser,
} from "../../test/factories.js";
import { createTestProcessedStatement } from "../../test/factories.landlord.js";
import { payLandlord } from "./landlordPaymentController.js";
import { getProperty } from "./property.js";

describe("payLandlord", () => {
  it("reduces the statement balance and the landlord's PCTRL/remittable balance by the payment amount", async () => {
    // This test performs two full GL-posting payment cycles (chart-of-accounts bootstrap,
    // ledger entries, balance aggregation) — comfortably exceeds the default 30s test timeout.
    const company = await createTestCompany();
    const { landlord } = await createTestLandlord({ company });
    const { property } = await createTestProperty({ company, landlord });
    const { statement } = await createTestProcessedStatement({
      company,
      landlord,
      property,
      netAmountDue: 5000,
    });
    const user = await createTestUser({ company });

    const { statusCode, payload } = await callController(payLandlord, {
      user,
      body: {
        statementId: String(statement._id),
        amount: 2000,
        paymentMethod: "bank_transfer",
        referenceNumber: "PAY-001",
      },
    });

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.statement.amountPaid).toBe(2000);
    expect(payload.data.statement.balanceDue).toBe(3000);
    expect(payload.data.statement.status).toBe("part_paid");

    // The property's PCTRL (landlord remittance payable, account 2110) balance must
    // reflect the payable created (5000) minus the payment just recorded (2000) = 3000.
    const propView = await callController(getProperty, {
      user,
      params: { id: String(property._id) },
    });
    expect(propView.payload.data.pctrlBalance).toBe(3000);

    // Paying off the remaining balance should zero out both the statement and PCTRL.
    const second = await callController(payLandlord, {
      user,
      body: {
        statementId: String(statement._id),
        amount: 3000,
        paymentMethod: "bank_transfer",
        referenceNumber: "PAY-002",
      },
    });
    expect(second.payload.data.statement.balanceDue).toBe(0);
    expect(second.payload.data.statement.status).toBe("paid");

    const propViewAfterFull = await callController(getProperty, {
      user,
      params: { id: String(property._id) },
    });
    expect(propViewAfterFull.payload.data.pctrlBalance).toBe(0);
  }, 60000);

  it("rejects a payment amount exceeding the outstanding balance", async () => {
    const company = await createTestCompany();
    const { landlord } = await createTestLandlord({ company });
    const { property } = await createTestProperty({ company, landlord });
    const { statement } = await createTestProcessedStatement({
      company,
      landlord,
      property,
      netAmountDue: 1000,
    });
    const user = await createTestUser({ company });

    await expect(
      callController(payLandlord, {
        user,
        body: { statementId: String(statement._id), amount: 5000, paymentMethod: "cash" },
      })
    ).rejects.toThrow(/cannot exceed outstanding balance/);
  });

  it("rejects payment against a negative (recovery) statement", async () => {
    const company = await createTestCompany();
    const { landlord } = await createTestLandlord({ company });
    const { property } = await createTestProperty({ company, landlord });
    const { statement } = await createTestProcessedStatement({
      company,
      landlord,
      property,
      netAmountDue: 0,
      isNegativeStatement: true,
      amountPayableByLandlordToManager: 1500,
    });
    const user = await createTestUser({ company });

    await expect(
      callController(payLandlord, {
        user,
        body: { statementId: String(statement._id), amount: 500, paymentMethod: "cash" },
      })
    ).rejects.toThrow(/negative/);
  });
});
