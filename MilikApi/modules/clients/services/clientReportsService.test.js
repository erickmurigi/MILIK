// AR aging buckets (live and historical), dashboard KPI sanity, statement
// with receipts/WHT/opening balance, sales VAT and billing forecast.
import { describe, it, expect } from "vitest";
import Client from "../models/Client.js";
import ClientContract from "../models/ClientContract.js";
import { createClientReceipt } from "./clientReceiptService.js";
import { getArAging, getDashboardKpis, buildClientStatement, getSalesVatReport, getBillingForecast, getWhtCertificatesReport } from "./clientReportsService.js";
import { setupClientsCompany, createPostedInvoice } from "../test/clientsTestKit.js";

const DAY = 86400000;
const at = (offset) => new Date(Date.now() + offset * DAY);

describe("client reports", () => {
  it("ages receivables into current / 1-30 / 31-60 / 61-90 / 90+ by client and by owner", async () => {
    const { business, userId, client, cashbook } = await setupClientsCompany();
    const other = await Client.create({ business, name: "Beta Ltd", clientCode: "CLT-B0001" });
    const ninetyPlus = await createPostedInvoice({ business, client, userId, amount: 500, issueDate: at(-150), dueDate: at(-120) });
    await createPostedInvoice({ business, client, userId, amount: 100, dueDate: at(5) });
    await createPostedInvoice({ business, client, userId, amount: 200, issueDate: at(-40), dueDate: at(-10) });
    await createPostedInvoice({ business, client, userId, amount: 300, issueDate: at(-75), dueDate: at(-45) });
    await createPostedInvoice({ business, client: other, userId, amount: 400, issueDate: at(-105), dueDate: at(-75) });
    // Part-pay the 90+ invoice today, plus 50 unapplied.
    await createClientReceipt({ business, userId, input: { client: client._id, amount: 250, method: "cash", cashbookAccountId: cashbook._id, allocations: [{ invoice: ninetyPlus._id, amount: 200 }] } });

    const aging = await getArAging({ business });
    const row = aging.rows.find((r) => r.clientCode === client.clientCode);
    expect(row).toMatchObject({ current: 100, d1_30: 200, d31_60: 300, d61_90: 0, d90_plus: 300, total: 900, unapplied: 50, net: 850, invoiceCount: 4 });
    expect(aging.rows.find((r) => r.clientCode === "CLT-B0001")).toMatchObject({ d61_90: 400, total: 400 });
    expect(aging.totals).toMatchObject({ total: 1300, d90_plus: 300, unapplied: 50 });

    const byOwner = await getArAging({ business, groupBy: "owner" });
    expect(byOwner.rows).toHaveLength(1);
    expect(byOwner.rows[0]).toMatchObject({ ownerName: "Unassigned", clientCount: 2, total: 1300 });

    // As at yesterday the receipt hadn't happened: the 90+ invoice was still 500.
    const historical = await getArAging({ business, asOf: at(-1) });
    expect(historical.historical).toBe(true);
    expect(historical.rows.find((r) => r.clientCode === client.clientCode).d90_plus).toBe(500);
  });

  it("builds a statement with receipts, allocations, WHT lines and an opening balance", async () => {
    const { business, userId, client, cashbook } = await setupClientsCompany();
    const first = await createPostedInvoice({ business, client, userId, amount: 1000, issueDate: at(-60), dueDate: at(-30) });
    const second = await createPostedInvoice({ business, client, userId, amount: 2000, issueDate: at(-5) });
    await createClientReceipt({ business, userId, input: { client: client._id, amount: 950, whtIncomeTax: { amount: 50 }, method: "bank_transfer", reference: "S-1", receiptDate: at(-2), cashbookAccountId: cashbook._id, allocations: [{ invoice: first._id, amount: 1000 }] } });

    const full = await buildClientStatement({ business, clientId: client._id });
    expect(full.transactions.map((t) => t.sourceKind)).toEqual(["invoice", "invoice", "client_receipt", "wht_income_tax"]);
    expect(full.transactions.find((t) => t.sourceKind === "client_receipt").allocations[0].invoiceNumber).toBe(first.invoiceNumber);
    expect(full.totalWht).toBe(50);
    expect(full.currentBalance).toBe(2000);

    const ranged = await buildClientStatement({ business, clientId: client._id, from: at(-10) });
    expect(ranged.openingBalance).toBe(1000);
    expect(ranged.transactions).toHaveLength(3);
    expect(ranged.transactions[0].balance).toBe(3000);
    expect(ranged.closingBalance).toBe(2000);
    expect(second.invoiceNumber).toBeTruthy();
  });

  it("produces sane dashboard KPIs, a sales VAT schedule, WHT outstanding and a billing forecast", async () => {
    const { business, userId, client, cashbook } = await setupClientsCompany({ clientOverrides: { taxPin: "P051234567Z" } });
    const overdue = await createPostedInvoice({ business, client, userId, amount: 1000, vatRate: 16, issueDate: at(-1), dueDate: at(-1) });
    await createPostedInvoice({ business, client, userId, amount: 500, vatRate: 0 });
    await ClientContract.create({ business, client: client._id, contractNumber: "CTR-K1", startDate: at(-1), openEnded: true, baseValue: 3000, billingCycle: "monthly", status: "active" });
    await createClientReceipt({ business, userId, input: { client: client._id, amount: 300, whtVat: { amount: 20 }, method: "mobile_money", reference: "QK1", cashbookAccountId: cashbook._id, allocations: [{ invoice: overdue._id, amount: 320 }] } });

    const kpis = await getDashboardKpis({ business, from: at(-2), to: at(1) });
    expect(kpis.mrr).toBe(3000);
    expect(kpis.arr).toBe(36000);
    expect(kpis.activeContracts).toBe(1);
    expect(kpis.billed).toMatchObject({ total: 1660, net: 1500, vat: 160, invoices: 2 });
    expect(kpis.collected).toMatchObject({ cash: 300, whtVat: 20, total: 320 });
    expect(kpis.receivables).toBe(1340);
    expect(kpis.overdue.total).toBe(840);
    expect(kpis.dso).toBeGreaterThan(0);
    expect(kpis.topClientsByRevenue[0]).toMatchObject({ clientName: client.name, revenue: 1500 });
    expect(kpis.topClientsByOverdue[0].overdue).toBe(840);

    const vat = await getSalesVatReport({ business, from: at(-2), to: at(1) });
    expect(vat.totals).toMatchObject({ standardRated: 1000, zeroOrExempt: 500, vat: 160, total: 1660, missingPin: 0 });
    expect(vat.rows[0].clientPin).toBe("P051234567Z");

    const wht = await getWhtCertificatesReport({ business });
    expect(wht.totals).toMatchObject({ vat: 20, incomeTax: 0, count: 1 });
    expect(wht.byClient[0].total).toBe(20);

    const forecast = await getBillingForecast({ business, months: 12 });
    expect(forecast.months).toHaveLength(12);
    expect(forecast.months.slice(1).every((m) => m.amount === 3000)).toBe(true);
  });
});
