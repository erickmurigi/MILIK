// System-wide duplicate-reference guard (paymentReferenceGuard.js), applied to TaxRemittance.paymentReference.
import { describe, it, expect } from "vitest";
import { callController } from "../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../test/factories.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import { remitVat, voidRemittance } from "./taxRemittance.js";
import PaymentReferenceLock from "../../models/PaymentReferenceLock.js";

const setup = async () => {
  const company = await createTestCompany({});
  const accounts = await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const cashbook = accounts.find((a) => /cash/i.test(a.name || "") && a.isPosting !== false) || accounts.find((a) => a.type === "asset");
  return { company, user, cashbookAccountId: String(cashbook._id) };
};

describe("remitVat — duplicate reference rejected", () => {
  it("rejects a second remittance reusing the same payment reference", async () => {
    const { company, user, cashbookAccountId } = await setup();

    const first = await callController(remitVat, {
      user,
      body: { year: 2026, month: 1, amountRemitted: 5000, paymentDate: new Date(2026, 1, 5), paymentReference: "KRA-VAT-01", cashbookAccountId },
    });
    expect(first.statusCode).toBe(201);

    await expect(
      callController(remitVat, {
        user,
        body: { year: 2026, month: 2, amountRemitted: 3000, paymentDate: new Date(2026, 2, 5), paymentReference: "kra-vat-01", cashbookAccountId },
      })
    ).rejects.toThrow(/already used/i);
  });

  it("frees the reference on void, allowing it to be reused", async () => {
    const { company, user, cashbookAccountId } = await setup();

    const first = await callController(remitVat, {
      user,
      body: { year: 2026, month: 3, amountRemitted: 2000, paymentDate: new Date(2026, 3, 5), paymentReference: "KRA-VOID-ME", cashbookAccountId },
    });
    expect(first.statusCode).toBe(201);

    const voided = await callController(voidRemittance, { user, params: { id: String(first.payload._id) } });
    expect(voided.statusCode).toBe(200);

    const lock = await PaymentReferenceLock.findOne({ business: company._id, referenceKey: "kra-void-me" }).lean();
    expect(lock).toBeNull();

    const second = await callController(remitVat, {
      user,
      body: { year: 2026, month: 4, amountRemitted: 1000, paymentDate: new Date(2026, 4, 5), paymentReference: "KRA-VOID-ME", cashbookAccountId },
    });
    expect(second.statusCode).toBe(201);
  });
});
