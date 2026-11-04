// Billing run: the preview is exactly what the run posts; a second run raises nothing (each
// schedule period is invoiced once); cancelling an invoice makes its periods billable again.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import CompanySettings from "../../../models/CompanySettings.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import Client from "../models/Client.js";
import ClientInvoice from "../models/ClientInvoice.js";
import ClientBillingSchedule from "../models/ClientBillingSchedule.js";
import ClientBillingRun from "../models/ClientBillingRun.js";
import { createContract, submitContract } from "./contractsController.js";
import { previewBillingRun, executeBillingRun, getBillingRun } from "./billingController.js";
import { cancelInvoice } from "./invoicesController.js";
import { runBilling } from "../services/clientBillingService.js";

const setup = async (clientBilling = null) => {
  const company = await createTestCompany({ modules: { clients: true } });
  await createTestChartOfAccounts(company._id);
  if (clientBilling) await CompanySettings.create({ company: company._id, clientBilling });
  const user = { _id: (await createTestUser({ company })).id, company: String(company._id), adminAccess: true };
  const acme = await Client.create({ business: company._id, name: "Acme", clientCode: "CLT-00001" });
  const globex = await Client.create({ business: company._id, name: "Globex", clientCode: "CLT-00002" });

  const activeContract = async (client, body) => {
    const created = await callController(createContract, {
      user,
      body: { client: String(client._id), startDate: "2026-01-01", endDate: "2026-12-31", billingDay: 1, escalationPercent: 0, ...body },
    });
    await callController(submitContract, { user, params: { id: created.payload.contract._id } });
    return created.payload.contract;
  };
  return { company, user, acme, globex, activeContract };
};

const monthly = (itemName, unitPrice, extra = {}) => ({ itemName, quantity: 1, unitPrice, billingFrequency: "monthly", taxCodeKey: "vat_standard", ...extra });

describe("Client billing run", () => {
  it("posts exactly what the preview showed, grouped per client, and is idempotent", async () => {
    const { company, user, acme, globex, activeContract } = await setup();
    await activeContract(acme, { lines: [monthly("Support", 10000), { itemName: "Setup", quantity: 1, unitPrice: 5000, billingFrequency: "one_off", taxCodeKey: "vat_exempt" }] });
    await activeContract(acme, { lines: [monthly("Hosting", 2000, { billingTiming: "arrears" })] });
    await activeContract(globex, { lines: [monthly("Audit", 30000, { billingFrequency: "quarterly" })] });

    const preview = await callController(previewBillingRun, { user, query: { period: "2026-02", groupBy: "client" } });
    const p = preview.payload;
    // Acme: Support Jan+Feb (advance), Setup once, Hosting Jan+Feb (arrears, billed on the 31st/28th)
    // Globex: Audit Q1 (advance, Jan)
    expect(p.invoiceCount).toBe(2);
    expect(p.rowCount).toBe(6);
    const acmePlan = p.invoices.find((i) => String(i.client) === String(acme._id));
    expect(acmePlan.subtotal).toBe(10000 * 2 + 5000 + 2000 * 2);
    expect(acmePlan.taxAmount).toBe(Math.round((24000 * 0.16) * 100) / 100);

    const run = await callController(executeBillingRun, { user, body: { period: "2026-02", groupBy: "client" } });
    expect(run.statusCode).toBe(201);
    const r = run.payload.run;
    expect(r).toMatchObject({ status: "completed", invoiceCount: p.invoiceCount, rowCount: p.rowCount, subtotal: p.subtotal, taxAmount: p.taxAmount, total: p.total });

    const invoices = await ClientInvoice.find({ billingRun: r._id }).lean();
    expect(invoices).toHaveLength(2);
    expect(invoices.every((i) => i.status === "posted" && i.taxCalculation === "line")).toBe(true);
    const acmeInvoice = invoices.find((i) => String(i.client) === String(acme._id));
    expect(acmeInvoice.total).toBe(acmePlan.total);
    expect(acmeInvoice.lineItems.every((l) => l.scheduleKey && l.servicePeriodStart)).toBe(true);

    // Balanced journal per invoice.
    for (const inv of invoices) {
      const entries = await FinancialLedgerEntry.find({ business: company._id, sourceTransactionId: String(inv._id) }).lean();
      const dr = entries.filter((e) => e.direction === "debit").reduce((s, e) => s + e.amount, 0);
      const cr = entries.filter((e) => e.direction === "credit").reduce((s, e) => s + e.amount, 0);
      expect(Math.round(dr * 100)).toBe(Math.round(cr * 100));
      expect(Math.round(dr * 100)).toBe(Math.round(inv.total * 100));
    }

    // Second run for the same period raises nothing; the rows are already invoiced.
    const again = await callController(executeBillingRun, { user, body: { period: "2026-02" } });
    expect(again.payload.run.invoiceCount).toBe(0);
    expect(await ClientInvoice.countDocuments({ business: company._id })).toBe(2);
    expect(await ClientBillingSchedule.countDocuments({ business: company._id, status: "invoiced" })).toBe(6);

    const detail = await callController(getBillingRun, { user, params: { id: String(r._id) } });
    expect(detail.payload.run.invoices).toHaveLength(2);
  }, 120000);

  it("two overlapping runs never invoice the same period twice", async () => {
    const { company, user, acme, activeContract } = await setup();
    await activeContract(acme, { lines: [monthly("Support", 10000)] });
    await Promise.all([
      runBilling({ business: company._id, period: "2026-03", userId: user._id }),
      runBilling({ business: company._id, period: "2026-03", userId: user._id }),
    ]);
    const invoices = await ClientInvoice.find({ business: company._id, status: { $ne: "cancelled" } }).lean();
    const keys = invoices.flatMap((i) => i.lineItems.map((l) => l.scheduleKey));
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
  }, 120000);

  it("groups per contract on request, can raise drafts, and cancelling an invoice frees its periods", async () => {
    const { company, user, acme, activeContract } = await setup({ billingRunPostsAsDraft: true });
    await activeContract(acme, { lines: [monthly("Support", 10000)] });
    await activeContract(acme, { lines: [monthly("Hosting", 2000)] });

    const run = await callController(executeBillingRun, { user, body: { period: "2026-01", groupBy: "contract" } });
    expect(run.payload.run.invoiceCount).toBe(2);
    const drafts = await ClientInvoice.find({ billingRun: run.payload.run._id }).lean();
    expect(drafts.every((i) => i.status === "draft")).toBe(true);
    expect(await FinancialLedgerEntry.countDocuments({ business: company._id })).toBe(0);

    await callController(cancelInvoice, { user, params: { id: String(drafts[0]._id) }, body: { reason: "Wrong PO" } });
    const freed = await ClientBillingSchedule.find({ business: company._id, status: "scheduled", billingDate: { $lte: new Date("2026-01-31") } }).lean();
    expect(freed).toHaveLength(1);

    const rerun = await callController(executeBillingRun, { user, body: { period: "2026-01", postAsDraft: false } });
    expect(rerun.payload.run.invoiceCount).toBe(1);
    const reissued = await ClientInvoice.findOne({ billingRun: rerun.payload.run._id }).lean();
    expect(reissued.status).toBe("posted");
    expect(await ClientBillingRun.countDocuments({ business: company._id })).toBe(2);
  }, 120000);

  it("skips clients blocked by credit control and flags them on the run", async () => {
    const { company, user, acme, globex, activeContract } = await setup();
    await activeContract(acme, { lines: [monthly("Support", 10000)] });
    await activeContract(globex, { lines: [monthly("Support", 5000)] });
    await Client.updateOne({ _id: globex._id }, { $set: { creditHold: true, creditHoldReason: "Disputed balance" } });

    const preview = await callController(previewBillingRun, { user, query: { period: "2026-01" } });
    expect(preview.payload.invoices.find((i) => String(i.client) === String(globex._id)).creditCheck.level).toBe("block");

    const run = await callController(executeBillingRun, { user, body: { period: "2026-01" } });
    expect(run.payload.run.invoiceCount).toBe(1);
    expect(run.payload.run.status).toBe("completed");
    expect(run.payload.run.failures).toEqual([expect.objectContaining({ kind: "credit_block" })]);
    expect(await ClientBillingSchedule.countDocuments({ business: company._id, client: globex._id, status: "scheduled" })).toBeGreaterThan(0);
  }, 120000);
});
