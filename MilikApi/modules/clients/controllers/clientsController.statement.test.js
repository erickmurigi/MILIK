// Regression test for the new client statement endpoint (running-balance
// ledger of invoices + payments), added alongside the ClientStatement UI.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import Client from "../models/Client.js";
import { createInvoice, sendInvoice, recordPayment, cancelInvoice } from "./invoicesController.js";
import { getClientStatement, getClientSummary } from "./clientsController.js";

describe("getClientStatement", () => {
  it("returns a correctly-ordered running balance across multiple invoices and a payment", async () => {
    const company = await createTestCompany({ modules: { clients: true } });
    await createTestChartOfAccounts(company._id);
    const user = { _id: (await createTestUser({ company })).id, company: String(company._id) };
    const client = await Client.create({ business: company._id, name: "Statement Test Co", clientCode: "CLT-STMT-1" });
    const cashbook = await ChartOfAccount.findOne({ business: company._id, code: "1110" }).lean();

    // Invoice 1: 5,000 (no VAT), sent.
    const inv1 = (await callController(createInvoice, {
      user,
      body: { client: String(client._id), dueDate: "2026-10-01", vatRate: 0, lineItems: [{ description: "Retainer", quantity: 1, unitPrice: 5000 }] },
    })).payload.invoice;
    await callController(sendInvoice, { user, params: { id: inv1._id } });

    // Invoice 2: 3,000 (no VAT), sent.
    const inv2 = (await callController(createInvoice, {
      user,
      body: { client: String(client._id), dueDate: "2026-10-15", vatRate: 0, lineItems: [{ description: "Extra work", quantity: 1, unitPrice: 3000 }] },
    })).payload.invoice;
    await callController(sendInvoice, { user, params: { id: inv2._id } });

    // Partial payment of 2,000 against invoice 1.
    await callController(recordPayment, {
      user,
      params: { id: inv1._id },
      body: { amount: 2000, paymentMethod: "cash", cashbookAccountId: String(cashbook._id) },
    });

    const result = await callController(getClientStatement, { user, params: { id: String(client._id) } });
    expect(result.statusCode).toBe(200);

    const { transactions, totalCharges, totalPayments, currentBalance, operationalOutstanding } = result.payload.data;

    // 2 invoices + 1 payment = 3 transactions, chronologically ordered.
    expect(transactions.length).toBe(3);
    expect(transactions.map((t) => t.type)).toEqual(["CHARGE", "CHARGE", "PAYMENT"]);

    // Running balance: 5000 -> 8000 -> 6000.
    expect(transactions[0].balance).toBe(5000);
    expect(transactions[1].balance).toBe(8000);
    expect(transactions[2].balance).toBe(6000);

    expect(totalCharges).toBe(8000);
    expect(totalPayments).toBe(2000);
    expect(currentBalance).toBe(6000);
    expect(operationalOutstanding).toBe(6000);
  }, 30000);

  it("excludes both draft and cancelled invoices from the statement and summary", async () => {
    const company = await createTestCompany({ modules: { clients: true } });
    await createTestChartOfAccounts(company._id);
    const user = { _id: (await createTestUser({ company })).id, company: String(company._id) };
    const client = await Client.create({ business: company._id, name: "Draft/Cancelled Invoice Co", clientCode: "CLT-STMT-2" });

    const inv = (await callController(createInvoice, {
      user,
      body: { client: String(client._id), dueDate: "2026-10-01", vatRate: 0, lineItems: [{ description: "Setup", quantity: 1, unitPrice: 1000 }] },
    })).payload.invoice;

    // Still a draft — never posted to the GL, must not appear anywhere yet.
    const draftState = await callController(getClientStatement, { user, params: { id: String(client._id) } });
    expect(draftState.payload.data.transactions.length).toBe(0);
    const draftSummary = await callController(getClientSummary, { user, params: { id: String(client._id) } });
    expect(draftSummary.payload.data.summary.totalInvoiced).toBe(0);

    // Sent — now posted, must appear in both.
    await callController(sendInvoice, { user, params: { id: inv._id } });
    const sentState = await callController(getClientStatement, { user, params: { id: String(client._id) } });
    expect(sentState.payload.data.transactions.length).toBe(1);
    const sentSummary = await callController(getClientSummary, { user, params: { id: String(client._id) } });
    expect(sentSummary.payload.data.summary.totalInvoiced).toBe(1000);

    // Cancelled — GL reversed, must disappear from both again.
    await callController(cancelInvoice, { user, params: { id: inv._id } });
    const afterCancel = await callController(getClientStatement, { user, params: { id: String(client._id) } });
    expect(afterCancel.payload.data.transactions.length).toBe(0);
    const afterCancelSummary = await callController(getClientSummary, { user, params: { id: String(client._id) } });
    expect(afterCancelSummary.payload.data.summary.totalInvoiced).toBe(0);
  }, 30000);
});
