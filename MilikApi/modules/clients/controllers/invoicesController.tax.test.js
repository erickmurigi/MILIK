// Phase 0: client invoices use per-line tax codes (exclusive / inclusive / zero-rated / exempt),
// post balanced journals with output VAT on 2190 (which the VAT return reads), and are immutable
// once posted.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import Client from "../models/Client.js";
import ClientInvoice from "../models/ClientInvoice.js";
import { createInvoice, updateInvoice, postInvoice, sendInvoice } from "./invoicesController.js";
import { getVatReturnSummary } from "../../../controllers/propertyController/taxRemittance.js";

const setup = async () => {
  const company = await createTestCompany({ modules: { clients: true } });
  await createTestChartOfAccounts(company._id);
  const user = { _id: (await createTestUser({ company })).id, company: String(company._id), adminAccess: true };
  const client = await Client.create({ business: company._id, name: "Acme Ltd", clientCode: "CLT-00001", taxPin: "P051234567X" });
  return { company, user, client };
};

const accountCode = async (id) => (await ChartOfAccount.findById(id).select("code").lean())?.code;

const journalFor = async (business, invoiceId) => {
  const entries = await FinancialLedgerEntry.find({ business, sourceTransactionId: String(invoiceId), status: "approved" }).lean();
  const debit = entries.filter((e) => e.direction === "debit").reduce((s, e) => s + e.amount, 0);
  const credit = entries.filter((e) => e.direction === "credit").reduce((s, e) => s + e.amount, 0);
  const byCode = {};
  for (const e of entries) {
    const code = await accountCode(e.accountId);
    byCode[code] = Math.round(((byCode[code] || 0) + (e.direction === "credit" ? e.amount : -e.amount)) * 100) / 100;
  }
  return { entries, debit: Math.round(debit * 100) / 100, credit: Math.round(credit * 100) / 100, byCode };
};

describe("Client invoice tax codes", () => {
  it("prices mixed exclusive lines per tax code and posts a balanced journal with VAT on 2190", async () => {
    const { company, user, client } = await setup();
    const created = await callController(createInvoice, {
      user,
      body: {
        client: String(client._id),
        dueDate: "2026-12-01",
        lineItems: [
          { description: "Consulting", quantity: 10, unitPrice: 1000, discountPercent: 10, taxCodeKey: "vat_standard" },
          { description: "Export service", quantity: 1, unitPrice: 5000, taxCodeKey: "vat_zero" },
          { description: "Training (exempt)", quantity: 1, unitPrice: 2000, taxCodeKey: "vat_exempt" },
        ],
      },
    });
    const invoice = created.payload.invoice;
    expect(invoice.taxCalculation).toBe("line");
    expect(invoice.subtotal).toBe(16000); // 9,000 + 5,000 + 2,000
    expect(invoice.vatAmount).toBe(1440); // 16% of 9,000 only
    expect(invoice.total).toBe(17440);
    expect(invoice.lineItems.map((l) => l.taxType)).toEqual(["vat", "zero_rated", "exempt"]);

    await callController(postInvoice, { user, params: { id: invoice._id } });
    const journal = await journalFor(company._id, invoice._id);
    expect(journal.debit).toBe(17440);
    expect(journal.credit).toBe(17440);
    expect(journal.byCode).toMatchObject({ 1260: -17440, 4520: 16000, 2190: 1440 });

    // The VAT return picks up the client VAT (2190 is read next to the configured output account).
    const now = new Date();
    const summary = await callController(getVatReturnSummary, { user, query: { year: now.getFullYear(), month: now.getMonth() + 1 } });
    const row2190 = summary.payload.breakdown.find((b) => b.accountCode === "2190");
    expect(row2190.vatCollected).toBe(1440);
  }, 60000);

  it("inclusive pricing backs VAT out of the price", async () => {
    const { company, user, client } = await setup();
    const created = await callController(createInvoice, {
      user,
      body: {
        client: String(client._id),
        dueDate: "2026-12-01",
        taxMode: "inclusive",
        lineItems: [{ description: "Monthly package", quantity: 1, unitPrice: 11600, taxCodeKey: "vat_standard" }],
      },
    });
    const invoice = created.payload.invoice;
    expect(invoice).toMatchObject({ subtotal: 10000, vatAmount: 1600, total: 11600 });
    await callController(postInvoice, { user, params: { id: invoice._id } });
    const journal = await journalFor(company._id, invoice._id);
    expect(journal.byCode).toMatchObject({ 1260: -11600, 4520: 10000, 2190: 1600 });
  }, 60000);

  it("an all-exempt invoice posts no VAT leg", async () => {
    const { company, user, client } = await setup();
    const created = await callController(createInvoice, {
      user,
      body: { client: String(client._id), dueDate: "2026-12-01", lineItems: [{ description: "Exempt", quantity: 1, unitPrice: 750, taxCodeKey: "vat_exempt" }] },
    });
    await callController(postInvoice, { user, params: { id: created.payload.invoice._id } });
    const journal = await journalFor(company._id, created.payload.invoice._id);
    expect(journal.entries).toHaveLength(2);
    expect(journal.byCode[2190]).toBeUndefined();
  }, 60000);

  it("rejects an unknown tax code", async () => {
    const { user, client } = await setup();
    await expect(callController(createInvoice, {
      user,
      body: { client: String(client._id), dueDate: "2026-12-01", lineItems: [{ description: "X", quantity: 1, unitPrice: 1, taxCodeKey: "made_up" }] },
    })).rejects.toMatchObject({ status: 400 });
  });
});

describe("Posted client invoices are immutable", () => {
  it("drafts are editable; posted invoices refuse edits through the API, save() and update queries", async () => {
    const { user, client } = await setup();
    const created = await callController(createInvoice, {
      user,
      body: { client: String(client._id), dueDate: "2026-12-01", lineItems: [{ description: "Draft line", quantity: 1, unitPrice: 100 }] },
    });
    const id = created.payload.invoice._id;

    const edited = await callController(updateInvoice, {
      user,
      params: { id },
      body: { client: String(client._id), dueDate: "2026-12-01", lineItems: [{ description: "Edited", quantity: 2, unitPrice: 100, taxCodeKey: "no_tax" }] },
    });
    expect(edited.payload.invoice.total).toBe(200);

    await callController(sendInvoice, { user, params: { id } });

    await expect(callController(updateInvoice, {
      user,
      params: { id },
      body: { client: String(client._id), dueDate: "2026-12-01", lineItems: [{ description: "Sneaky", quantity: 1, unitPrice: 1 }] },
    })).rejects.toMatchObject({ status: 400 });

    const doc = await ClientInvoice.findById(id);
    doc.lineItems[0].unitPrice = 1;
    await expect(doc.save()).rejects.toMatchObject({ status: 400 });

    await expect(ClientInvoice.updateOne({ _id: id }, { $set: { total: 1 } })).rejects.toMatchObject({ status: 400 });

    // Receipts' fields stay writable.
    await ClientInvoice.updateOne({ _id: id }, { $set: { paidAmount: 50, status: "partial" } });
    const after = await ClientInvoice.findById(id).lean();
    expect(after.total).toBe(200);
    expect(after.paidAmount).toBe(50);
  }, 60000);

  it("legacy flat-rate invoices (no tax code) still compute and post as before", async () => {
    const { company, user, client } = await setup();
    const legacy = await ClientInvoice.create({
      business: company._id,
      client: client._id,
      invoiceNumber: "CINV-LEGACY-1",
      dueDate: new Date("2026-12-01"),
      vatRate: 16,
      lineItems: [{ description: "Old style", quantity: 2, unitPrice: 500, taxable: true }],
    });
    expect(legacy.taxCalculation).toBe("flat");
    expect(legacy.total).toBe(1160);
    await callController(postInvoice, { user, params: { id: legacy._id } });
    const journal = await journalFor(company._id, legacy._id);
    expect(journal.byCode).toMatchObject({ 1260: -1160, 4520: 1000, 2190: 160 });
  }, 60000);
});
