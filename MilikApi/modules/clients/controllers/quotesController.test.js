// Quotes / proformas: totals from contract-shaped lines, status flow, and conversion to a draft
// contract or a draft invoice (each only once).
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import Client from "../models/Client.js";
import ClientContract from "../models/ClientContract.js";
import ClientInvoice from "../models/ClientInvoice.js";
import {
  createQuote,
  updateQuote,
  sendQuote,
  declineQuote,
  acceptQuote,
  convertQuoteToContract,
  convertQuoteToInvoice,
} from "./quotesController.js";

const setup = async () => {
  const company = await createTestCompany({ modules: { clients: true } });
  await createTestChartOfAccounts(company._id);
  const user = { _id: (await createTestUser({ company })).id, company: String(company._id), adminAccess: true };
  const client = await Client.create({ business: company._id, name: "Umbrella", clientCode: "CLT-00077" });
  return { user, client };
};

const lines = [
  { itemName: "Managed IT", quantity: 1, unitPrice: 20000, billingFrequency: "monthly", taxCodeKey: "vat_standard" },
  { itemName: "Onboarding", quantity: 1, unitPrice: 15000, discountPercent: 20, billingFrequency: "one_off", taxCodeKey: "vat_standard" },
];

describe("Client quotes", () => {
  it("prices the quote and converts an accepted quote into a draft contract once", async () => {
    const { user, client } = await setup();
    const created = await callController(createQuote, { user, body: { client: String(client._id), title: "IT support proposal", validUntil: "2099-12-31", lines } });
    const quote = created.payload.quote;
    expect(quote.quoteNumber).toMatch(/^QUO-/);
    expect(quote).toMatchObject({ status: "draft", subtotal: 32000, discountTotal: 3000, taxAmount: 5120, total: 37120, recurringMonthly: 20000 });

    const updated = await callController(updateQuote, { user, params: { id: quote._id }, body: { lines: [lines[0]] } });
    expect(updated.payload.quote.total).toBe(23200);
    await callController(updateQuote, { user, params: { id: quote._id }, body: { lines } });

    await callController(sendQuote, { user, params: { id: quote._id } });
    await callController(acceptQuote, { user, params: { id: quote._id } });
    await expect(callController(updateQuote, { user, params: { id: quote._id }, body: { title: "late edit" } })).rejects.toMatchObject({ status: 400 });

    const converted = await callController(convertQuoteToContract, { user, params: { id: quote._id }, body: { startDate: "2026-01-01", endDate: "2026-12-31", contractType: "subscription" } });
    const contract = converted.payload.contract;
    expect(contract).toMatchObject({ status: "draft", contractType: "subscription", mrr: 20000, tcv: 20000 * 12 + 12000 });
    expect(contract.lines.map((l) => l.itemName)).toEqual(["Managed IT", "Onboarding"]);
    expect(String((await ClientContract.findById(contract._id).lean()).sourceQuote)).toBe(String(quote._id));

    await expect(callController(convertQuoteToContract, { user, params: { id: quote._id }, body: { startDate: "2026-01-01", endDate: "2026-12-31" } }))
      .rejects.toMatchObject({ status: 409 });
  }, 90000);

  it("converts a proforma into a draft invoice with the same tax, and declined quotes can't convert", async () => {
    const { user, client } = await setup();
    const created = await callController(createQuote, { user, body: { client: String(client._id), kind: "proforma", validUntil: "2099-12-31", lines } });
    const converted = await callController(convertQuoteToInvoice, { user, params: { id: created.payload.quote._id }, body: { issueDate: "2026-02-01" } });
    const invoice = await ClientInvoice.findById(converted.payload.invoice._id).lean();
    expect(invoice).toMatchObject({ status: "draft", taxCalculation: "line", subtotal: 32000, vatAmount: 5120, total: 37120 });
    expect(converted.payload.quote.status).toBe("accepted");

    const other = await callController(createQuote, { user, body: { client: String(client._id), validUntil: "2099-12-31", lines } });
    await expect(callController(declineQuote, { user, params: { id: other.payload.quote._id }, body: {} })).rejects.toMatchObject({ status: 400 });
    await callController(declineQuote, { user, params: { id: other.payload.quote._id }, body: { reason: "Went with a competitor" } });
    await expect(callController(convertQuoteToInvoice, { user, params: { id: other.payload.quote._id } })).rejects.toMatchObject({ status: 400 });
  }, 90000);
});
