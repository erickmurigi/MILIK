// System-wide duplicate-reference guard (paymentReferenceGuard.js), applied to ClientPayment.paymentReference.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import Client from "../models/Client.js";
import { createInvoice, sendInvoice, recordPayment, reversePayment } from "./invoicesController.js";
import PaymentReferenceLock from "../../../models/PaymentReferenceLock.js";

const setup = async () => {
  const company = await createTestCompany({ modules: { clients: true } });
  await createTestChartOfAccounts(company._id);
  const user = { _id: (await createTestUser({ company })).id, company: String(company._id) };
  const client = await Client.create({ business: company._id, name: "Acme Corp", clientCode: `CLT-${Date.now()}` });
  const cashbook = await ChartOfAccount.findOne({ business: company._id, code: "1110" }).lean();

  const makeSentInvoice = async (amount) => {
    const created = await callController(createInvoice, {
      user,
      body: { client: String(client._id), dueDate: "2026-10-01", lineItems: [{ description: "Item", quantity: 1, unitPrice: amount, taxable: false }], vatRate: 0 },
    });
    await callController(sendInvoice, { user, params: { id: created.payload.invoice._id } });
    return created.payload.invoice;
  };

  return { company, user, client, cashbook, makeSentInvoice };
};

describe("recordPayment (ClientPayment) — duplicate reference rejected", () => {
  it("rejects a second payment (on a different invoice) reusing the same reference", async () => {
    const { user, cashbook, makeSentInvoice } = await setup();
    const invoice1 = await makeSentInvoice(5000);
    const invoice2 = await makeSentInvoice(5000);

    const first = await callController(recordPayment, {
      user, params: { id: invoice1._id },
      body: { amount: 5000, paymentMethod: "bank_transfer", paymentReference: "CP-DUP-01", cashbookAccountId: String(cashbook._id) },
    });
    expect(first.statusCode).toBe(200);

    await expect(
      callController(recordPayment, {
        user, params: { id: invoice2._id },
        body: { amount: 5000, paymentMethod: "bank_transfer", paymentReference: "cp-dup-01", cashbookAccountId: String(cashbook._id) },
      })
    ).rejects.toThrow(/already used/i);
  });

  it("frees the reference on reversal, allowing it to be reused", async () => {
    const { company, user, cashbook, makeSentInvoice } = await setup();
    const invoice1 = await makeSentInvoice(5000);
    const invoice2 = await makeSentInvoice(5000);

    const first = await callController(recordPayment, {
      user, params: { id: invoice1._id },
      body: { amount: 5000, paymentMethod: "cash", paymentReference: "CP-REUSE", cashbookAccountId: String(cashbook._id) },
    });
    expect(first.statusCode).toBe(200);

    const reversed = await callController(reversePayment, {
      user, params: { id: invoice1._id, paymentId: String(first.payload.payment._id) },
      body: { reason: "test reversal" },
    });
    expect(reversed.statusCode).toBe(200);

    const lock = await PaymentReferenceLock.findOne({ business: company._id, referenceKey: "cp-reuse" }).lean();
    expect(lock).toBeNull();

    const second = await callController(recordPayment, {
      user, params: { id: invoice2._id },
      body: { amount: 5000, paymentMethod: "cash", paymentReference: "CP-REUSE", cashbookAccountId: String(cashbook._id) },
    });
    expect(second.statusCode).toBe(200);
  });
});
