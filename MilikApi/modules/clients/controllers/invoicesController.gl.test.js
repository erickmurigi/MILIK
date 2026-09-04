// Regression test for Client Management's GL integration — the structural gap
// identified in the module audit: client invoices never touched the shared
// ledger, so revenue/receivables were invisible in Trial Balance/Income
// Statement/Balance Sheet. Covers the full lifecycle: draft (no GL) -> send
// (posts AR debit / revenue+VAT credit) -> partial payment -> full payment ->
// payment reversal -> invoice cancellation (with and without GL to reverse).
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import Client from "../models/Client.js";
import ClientInvoice from "../models/ClientInvoice.js";
import ClientPayment from "../models/ClientPayment.js";
import {
  createInvoice,
  sendInvoice,
  recordPayment,
  reversePayment,
  cancelInvoice,
} from "./invoicesController.js";

const setup = async () => {
  const company = await createTestCompany({ modules: { clients: true } });
  await createTestChartOfAccounts(company._id);
  const user = { _id: (await createTestUser({ company })).id, company: String(company._id) };
  const client = await Client.create({ business: company._id, name: "Acme Corp", clientCode: "CLT-00001" });
  const cashbook = await ChartOfAccount.findOne({ business: company._id, code: "1110" }).lean();
  return { company, user, client, cashbook };
};

const ledgerEntriesFor = (business, sourceTransactionType, sourceTransactionId) =>
  FinancialLedgerEntry.find({ business, sourceTransactionType, sourceTransactionId: String(sourceTransactionId) }).lean();

describe("Client invoice GL integration", () => {
  it("posts no GL entries on draft creation, then posts AR/revenue/VAT on send", async () => {
    const { company, user, client } = await setup();

    const created = await callController(createInvoice, {
      user,
      body: {
        client: String(client._id),
        dueDate: "2026-10-01",
        lineItems: [{ description: "Consulting", quantity: 10, unitPrice: 1000, taxable: true }],
        vatRate: 16,
      },
    });
    expect(created.statusCode).toBe(201);
    const invoice = created.payload.invoice;
    expect(invoice.status).toBe("draft");
    expect(invoice.total).toBe(11600); // 10,000 subtotal + 16% VAT

    const draftEntries = await ledgerEntriesFor(company._id, "client_invoice", invoice._id);
    expect(draftEntries.length).toBe(0); // draft must not touch the ledger

    const sent = await callController(sendInvoice, { user, params: { id: invoice._id } });
    expect(sent.statusCode).toBe(200);
    expect(sent.payload.invoice.status).toBe("sent");

    const entries = await ledgerEntriesFor(company._id, "client_invoice", invoice._id);
    expect(entries.length).toBe(3); // AR debit, revenue credit, VAT credit

    const debit = entries.find((e) => e.direction === "debit");
    expect(debit.debit).toBe(11600);
    const revenueCredit = entries.find((e) => e.metadata?.postingRole === "client_service_income");
    expect(revenueCredit.credit).toBe(10000);
    const vatCredit = entries.find((e) => e.metadata?.postingRole === "client_output_vat");
    expect(vatCredit.credit).toBe(1600);

    // Resending an already-sent invoice must not double-post.
    await callController(sendInvoice, { user, params: { id: invoice._id } });
    const afterResend = await ledgerEntriesFor(company._id, "client_invoice", invoice._id);
    expect(afterResend.length).toBe(3);
  }, 30000);

  it("records payments as their own audit trail, posts cash/AR legs, and rejects overpayment", async () => {
    const { company, user, client, cashbook } = await setup();

    const created = await callController(createInvoice, {
      user,
      body: {
        client: String(client._id),
        dueDate: "2026-10-01",
        lineItems: [{ description: "Retainer", quantity: 1, unitPrice: 5000, taxable: false }],
        vatRate: 0,
      },
    });
    const invoice = created.payload.invoice;
    await callController(sendInvoice, { user, params: { id: invoice._id } });

    // Draft/unsent invoices cannot take a payment.
    const draftInvoice2 = await callController(createInvoice, {
      user,
      body: { client: String(client._id), dueDate: "2026-10-01", lineItems: [{ description: "X", quantity: 1, unitPrice: 100 }] },
    });
    await expect(
      callController(recordPayment, {
        user,
        params: { id: draftInvoice2.payload.invoice._id },
        body: { amount: 50, paymentMethod: "cash", cashbookAccountId: String(cashbook._id) },
      })
    ).rejects.toBeTruthy();

    // Overpayment rejected.
    await expect(
      callController(recordPayment, {
        user,
        params: { id: invoice._id },
        body: { amount: 999999, paymentMethod: "bank_transfer", cashbookAccountId: String(cashbook._id) },
      })
    ).rejects.toBeTruthy();

    // Partial payment.
    const partial = await callController(recordPayment, {
      user,
      params: { id: invoice._id },
      body: { amount: 2000, paymentMethod: "bank_transfer", paymentReference: "REF-1", cashbookAccountId: String(cashbook._id) },
    });
    expect(partial.statusCode).toBe(200);
    expect(partial.payload.invoice.status).toBe("partial");
    expect(partial.payload.invoice.paidAmount).toBe(2000);

    const payment1Entries = await ledgerEntriesFor(company._id, "client_payment", partial.payload.payment._id);
    expect(payment1Entries.length).toBe(2);
    expect(payment1Entries.find((e) => e.direction === "debit").debit).toBe(2000);
    expect(payment1Entries.find((e) => e.direction === "credit").credit).toBe(2000);

    // Second (final) payment — reference REF-1 from the first payment must
    // still be intact (the old markPaid overwrote it; this must not).
    const final = await callController(recordPayment, {
      user,
      params: { id: invoice._id },
      body: { amount: 3000, paymentMethod: "mobile_money", paymentReference: "REF-2", cashbookAccountId: String(cashbook._id) },
    });
    expect(final.payload.invoice.status).toBe("paid");
    expect(final.payload.invoice.paidAmount).toBe(5000);

    const payments = await ClientPayment.find({ invoice: invoice._id }).sort({ createdAt: 1 }).lean();
    expect(payments.length).toBe(2);
    expect(payments[0].paymentReference).toBe("REF-1"); // proves no overwrite
    expect(payments[1].paymentReference).toBe("REF-2");

    // Reverse the second payment — GL reversed, invoice drops back to partial.
    const reversed = await callController(reversePayment, {
      user,
      params: { id: invoice._id, paymentId: String(payments[1]._id) },
      body: { reason: "Duplicate entry" },
    });
    expect(reversed.statusCode).toBe(200);
    expect(reversed.payload.invoice.status).toBe("partial");
    expect(reversed.payload.invoice.paidAmount).toBe(2000);

    // The reversed payment's own original entries must now show as reversed.
    // `payments` was read before the reverse call, so refetch its ledgerEntries.
    const paymentDoc2 = await ClientPayment.findById(payments[1]._id).lean();
    const settledEntries = await FinancialLedgerEntry.find({ _id: { $in: paymentDoc2.ledgerEntries } }).lean();
    expect(settledEntries.every((e) => e.status === "reversed")).toBe(true);
  }, 30000);

  it("blocks cancelling a partially-paid invoice, and reverses GL when cancelling a sent-but-unpaid one", async () => {
    const { company, user, client, cashbook } = await setup();

    const created = await callController(createInvoice, {
      user,
      body: { client: String(client._id), dueDate: "2026-10-01", lineItems: [{ description: "Setup fee", quantity: 1, unitPrice: 1000 }] },
    });
    const invoice = created.payload.invoice;
    await callController(sendInvoice, { user, params: { id: invoice._id } });

    await callController(recordPayment, {
      user,
      params: { id: invoice._id },
      body: { amount: 100, paymentMethod: "cash", cashbookAccountId: String(cashbook._id) },
    });

    await expect(callController(cancelInvoice, { user, params: { id: invoice._id } })).rejects.toBeTruthy();

    // A second, sent-but-never-paid invoice CAN be cancelled, and its GL entries reverse.
    const created2 = await callController(createInvoice, {
      user,
      body: { client: String(client._id), dueDate: "2026-10-01", lineItems: [{ description: "Setup fee 2", quantity: 1, unitPrice: 500 }] },
    });
    const invoice2 = created2.payload.invoice;
    await callController(sendInvoice, { user, params: { id: invoice2._id } });

    const beforeCancel = await ledgerEntriesFor(company._id, "client_invoice", invoice2._id);
    expect(beforeCancel.every((e) => e.status !== "reversed")).toBe(true);

    const cancelled = await callController(cancelInvoice, { user, params: { id: invoice2._id }, body: { reason: "Client cancelled order" } });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.payload.invoice.status).toBe("cancelled");

    // postReversal copies sourceTransactionType/sourceTransactionId onto the
    // offsetting reversal entries it creates, so this query now also returns
    // those 3 new entries alongside the original 3 — only the originals should
    // be "reversed"; the reversal entries themselves stay "approved".
    const afterCancel = await ledgerEntriesFor(company._id, "client_invoice", invoice2._id);
    expect(afterCancel.length).toBe(6);
    const originalIds = new Set(beforeCancel.map((e) => String(e._id)));
    const originalsAfter = afterCancel.filter((e) => originalIds.has(String(e._id)));
    expect(originalsAfter.length).toBe(3);
    expect(originalsAfter.every((e) => e.status === "reversed")).toBe(true);
  }, 30000);
});
