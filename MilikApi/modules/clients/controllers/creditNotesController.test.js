// Credit/debit notes on client invoices (GL + outstanding + status) and deferred revenue:
// straight-line lines bill into 2165, the monthly recognition run releases them once per month,
// and credit notes take the unrecognised part out of deferred revenue first.
import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import Client from "../models/Client.js";
import ClientInvoice from "../models/ClientInvoice.js";
import ClientCreditNote from "../models/ClientCreditNote.js";
import ClientRevenueSchedule from "../models/ClientRevenueSchedule.js";
import { createInvoice, postInvoice, cancelInvoice } from "./invoicesController.js";
import { createCreditNote, createDebitNote, reverseNote, raiseLateInterest } from "./creditNotesController.js";
import ClientContract from "../models/ClientContract.js";
import {
  previewRecognition,
  runRecognition,
  recognizeMilestoneHandler,
  deferredBalanceReport,
  waterfallReport,
  billedVsRecognisedReport,
} from "./revenueController.js";
import { computeClientInvoiceOutstanding } from "../services/clientInvoiceBalanceService.js";

const setup = async () => {
  const company = await createTestCompany({ modules: { clients: true } });
  await createTestChartOfAccounts(company._id);
  const user = { _id: (await createTestUser({ company })).id, company: String(company._id), adminAccess: true };
  const client = await Client.create({ business: company._id, name: "Initech", clientCode: "CLT-00042" });
  const codes = Object.fromEntries((await ChartOfAccount.find({ business: company._id }).select("_id code").lean()).map((a) => [String(a._id), a.code]));

  const postedInvoice = async (lineItems) => {
    const created = await callController(createInvoice, { user, body: { client: String(client._id), dueDate: "2026-12-31", issueDate: "2026-01-01", lineItems } });
    await callController(postInvoice, { user, params: { id: created.payload.invoice._id } });
    return ClientInvoice.findById(created.payload.invoice._id).lean();
  };

  // Net movement per account code for one document (credit positive), live + reversal entries.
  const movement = async (sourceId) => {
    const entries = await FinancialLedgerEntry.find({ business: company._id, sourceTransactionId: String(sourceId) }).lean();
    const out = {};
    let dr = 0;
    let cr = 0;
    for (const e of entries) {
      const code = codes[String(e.accountId)];
      out[code] = Math.round(((out[code] || 0) + (e.direction === "credit" ? e.amount : -e.amount)) * 100) / 100;
      if (e.direction === "debit") dr += e.amount; else cr += e.amount;
    }
    return { byCode: out, balanced: Math.round(dr * 100) === Math.round(cr * 100) };
  };

  const accountBalance = async (code) => {
    const account = await ChartOfAccount.findOne({ business: company._id, code }).select("_id").lean();
    const rows = await FinancialLedgerEntry.aggregate([
      { $match: { business: new mongoose.Types.ObjectId(String(company._id)), accountId: account._id } },
      { $group: { _id: "$direction", total: { $sum: "$amount" } } },
    ]);
    const get = (d) => rows.find((r) => r._id === d)?.total || 0;
    return Math.round((get("credit") - get("debit")) * 100) / 100;
  };

  return { company, user, client, postedInvoice, movement, accountBalance };
};

describe("Client credit and debit notes", () => {
  it("adjust the GL, the invoice's outstanding and status, and reverse cleanly", async () => {
    const { user, postedInvoice, movement } = await setup();
    const invoice = await postedInvoice([{ description: "Consulting", quantity: 10, unitPrice: 1000, taxCodeKey: "vat_standard" }]);
    expect(invoice.total).toBe(11600);

    await expect(callController(createCreditNote, { user, params: { id: String(invoice._id) }, body: { lines: [{ invoiceLineIndex: 0, amount: 100 }] } }))
      .rejects.toMatchObject({ status: 400 }); // reason required

    const partial = await callController(createCreditNote, {
      user, params: { id: String(invoice._id) }, body: { reason: "Hours over-billed", lines: [{ invoiceLineIndex: 0, amount: 2500 }] },
    });
    const cn = partial.payload.note;
    expect(cn.noteNumber).toMatch(/^CN-/);
    expect(cn).toMatchObject({ subtotal: 2500, taxAmount: 400, total: 2900 });
    const cnMove = await movement(cn._id);
    expect(cnMove.balanced).toBe(true);
    expect(cnMove.byCode).toMatchObject({ 1260: 2900, 4520: -2500, 2190: -400 });
    expect(partial.payload.invoice.creditedAmount).toBe(2900);
    expect(computeClientInvoiceOutstanding(partial.payload.invoice)).toBe(8700);
    expect(partial.payload.invoice.adjustedTotal).toBe(8700);

    // Can't credit more than is left on the line.
    await expect(callController(createCreditNote, {
      user, params: { id: String(invoice._id) }, body: { reason: "x", lines: [{ invoiceLineIndex: 0, amount: 8000 }] },
    })).rejects.toMatchObject({ status: 400 });

    const debit = await callController(createDebitNote, {
      user, params: { id: String(invoice._id) }, body: { reason: "Extra site visit", lines: [{ description: "Site visit", amount: 1000, taxCodeKey: "vat_standard" }] },
    });
    const dn = debit.payload.note;
    expect(dn.noteNumber).toMatch(/^DN-/);
    expect(dn.total).toBe(1160);
    expect((await movement(dn._id)).byCode).toMatchObject({ 1260: -1160, 4520: 1000, 2190: 160 });
    expect(computeClientInvoiceOutstanding(debit.payload.invoice)).toBe(9860);

    // Cancelling an invoice with live notes is refused — notes must be reversed first.
    await expect(callController(cancelInvoice, { user, params: { id: String(invoice._id) } })).rejects.toMatchObject({ status: 400 });

    // Full credit of the remainder, then remove the debit note -> nothing owed -> "credited".
    const full = await callController(createCreditNote, { user, params: { id: String(invoice._id) }, body: { reason: "Engagement cancelled", full: true } });
    expect(full.payload.note).toMatchObject({ subtotal: 7500, taxAmount: 1200, total: 8700, isFullCredit: true });
    const reversedDebit = await callController(reverseNote, { user, params: { id: String(dn._id) }, body: { reason: "Visit not done" } });
    expect(reversedDebit.payload.invoice.status).toBe("credited");
    expect(computeClientInvoiceOutstanding(reversedDebit.payload.invoice)).toBe(0);
    expect((await movement(dn._id)).byCode).toMatchObject({ 1260: 0, 4520: 0, 2190: 0 });

    // Reversing the partial credit note puts 2,900 back on the invoice.
    const back = await callController(reverseNote, { user, params: { id: String(cn._id) }, body: { reason: "Entered in error" } });
    expect(back.payload.invoice.creditedAmount).toBe(8700);
    expect(computeClientInvoiceOutstanding(back.payload.invoice)).toBe(2900);
    expect(back.payload.invoice.status).toBe("posted");
    await expect(callController(reverseNote, { user, params: { id: String(cn._id) }, body: { reason: "again" } })).rejects.toMatchObject({ status: 400 });

    const notes = await ClientCreditNote.find({ invoice: invoice._id }).lean();
    const fresh = await ClientInvoice.findById(invoice._id).lean();
    expect(computeClientInvoiceOutstanding(fresh, notes)).toBe(computeClientInvoiceOutstanding(fresh));
  }, 120000);
});

describe("Deferred revenue", () => {
  const straightLine = { description: "Annual support plan", quantity: 1, unitPrice: 12000, taxCodeKey: "vat_standard", revenueRecognition: "straight_line", servicePeriodStart: "2026-01-01", servicePeriodEnd: "2026-12-31" };

  it("bills straight-line lines into 2165 and recognises each month exactly once", async () => {
    const { user, company, postedInvoice, movement, accountBalance } = await setup();
    const invoice = await postedInvoice([straightLine, { description: "Setup", quantity: 1, unitPrice: 3000, taxCodeKey: "vat_standard" }]);
    expect(invoice.deferredAmount).toBe(12000);
    const inv = await movement(invoice._id);
    expect(inv.balanced).toBe(true);
    expect(inv.byCode).toMatchObject({ 1260: -17400, 2165: 12000, 4520: 3000, 2190: 2400 });

    const [schedule] = await ClientRevenueSchedule.find({ invoice: invoice._id }).lean();
    expect(schedule.entries).toHaveLength(12);
    expect(Math.round(schedule.entries.reduce((s, e) => s + e.amount, 0) * 100) / 100).toBe(12000);

    const preview = await callController(previewRecognition, { user, query: { throughMonth: "2026-03" } });
    expect(preview.payload.count).toBe(3);
    const run = await callController(runRecognition, { user, body: { throughMonth: "2026-03" } });
    expect(run.payload.recognized).toBe(3);
    expect(run.payload.total).toBe(preview.payload.total);
    const rerun = await callController(runRecognition, { user, body: { throughMonth: "2026-03" } });
    expect(rerun.payload.recognized).toBe(0);
    expect(await accountBalance("2165")).toBe(Math.round((12000 - preview.payload.total) * 100) / 100);

    // Recognition journals are dated at each month end.
    const recognitionEntries = await FinancialLedgerEntry.find({ business: company._id, "metadata.clientDocumentType": "revenue_recognition" }).lean();
    expect(recognitionEntries).toHaveLength(6);
    expect(new Set(recognitionEntries.map((e) => e.transactionDate.toISOString().slice(0, 10)))).toEqual(new Set(["2026-01-31", "2026-02-28", "2026-03-31"]));

    // Reports.
    const balance = await callController(deferredBalanceReport, { user, query: { groupBy: "client" } });
    expect(balance.payload.total).toBe(await accountBalance("2165"));
    const waterfall = await callController(waterfallReport, { user, query: { fromMonth: "2026-04", months: 12 } });
    expect(waterfall.payload.total).toBe(balance.payload.total);
    const bvr = await callController(billedVsRecognisedReport, { user, query: { fromMonth: "2026-01", toMonth: "2026-03" } });
    expect(bvr.payload.totals.billed).toBe(15000);
    expect(bvr.payload.totals.recognized).toBe(Math.round((3000 + preview.payload.total) * 100) / 100);

    // Cancelling is refused once revenue has been recognised.
    await expect(callController(cancelInvoice, { user, params: { id: String(invoice._id) } })).rejects.toMatchObject({ status: 400 });
  }, 120000);

  it("a credit note releases the unrecognised part from deferred revenue first, and its reversal restores it", async () => {
    const { user, postedInvoice, movement, accountBalance } = await setup();
    const invoice = await postedInvoice([straightLine]);
    const run = await callController(runRecognition, { user, body: { throughMonth: "2026-02" } });
    const recognised = run.payload.total;

    const credit = await callController(createCreditNote, { user, params: { id: String(invoice._id) }, body: { reason: "Plan cancelled", full: true } });
    const note = credit.payload.note;
    expect(note.lines[0].deferredPortion).toBe(Math.round((12000 - recognised) * 100) / 100);
    const move = await movement(note._id);
    expect(move.balanced).toBe(true);
    expect(move.byCode).toMatchObject({ 1260: 13920, 2165: -(12000 - recognised), 4520: -recognised, 2190: -1920 });
    expect(await accountBalance("2165")).toBe(0);

    const afterCredit = await ClientRevenueSchedule.findOne({ invoice: invoice._id }).lean();
    expect(afterCredit.status).toBe("completed");
    expect(afterCredit.entries.filter((e) => e.status === "pending")).toHaveLength(0);
    expect((await callController(previewRecognition, { user, query: { throughMonth: "2026-12" } })).payload.count).toBe(0);

    await callController(reverseNote, { user, params: { id: String(note._id) }, body: { reason: "Client stayed" } });
    const restored = await ClientRevenueSchedule.findOne({ invoice: invoice._id }).lean();
    expect(restored.status).toBe("active");
    expect(restored.entries.filter((e) => e.status === "pending")).toHaveLength(10);
    expect(await accountBalance("2165")).toBe(Math.round((12000 - recognised) * 100) / 100);
  }, 120000);

  it("milestone lines are recognised by hand, capped at what is deferred", async () => {
    const { user, postedInvoice, accountBalance } = await setup();
    const invoice = await postedInvoice([{ description: "Implementation project", quantity: 1, unitPrice: 50000, taxCodeKey: "vat_standard", revenueRecognition: "milestone" }]);
    const [schedule] = await ClientRevenueSchedule.find({ invoice: invoice._id }).lean();
    expect(schedule.entries).toHaveLength(0);
    expect(await accountBalance("2165")).toBe(50000);

    await callController(recognizeMilestoneHandler, { user, params: { id: String(schedule._id) }, body: { amount: 20000, date: "2026-03-15", description: "Phase 1 go-live" } });
    expect(await accountBalance("2165")).toBe(30000);
    await expect(callController(recognizeMilestoneHandler, { user, params: { id: String(schedule._id) }, body: { amount: 40000 } })).rejects.toMatchObject({ status: 400 });
  }, 120000);
});

describe("Late payment interest", () => {
  it("raises exempt interest debit notes once per period", async () => {
    const { company, user, client, movement } = await setup();
    const contract = await ClientContract.create({
      business: company._id, client: client._id, contractNumber: "CTR-LI-1", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"),
      status: "active", latePaymentInterestPercent: 2, latePaymentInterestBasis: "monthly",
      lines: [{ lineKey: "a", itemName: "Support", quantity: 1, unitPrice: 10000 }],
    });
    const created = await callController(createInvoice, {
      user, body: { client: String(client._id), contract: String(contract._id), issueDate: "2026-01-01", dueDate: "2026-01-31", lineItems: [{ description: "Support", quantity: 1, unitPrice: 10000, taxCodeKey: "no_tax" }] },
    });
    await callController(postInvoice, { user, params: { id: created.payload.invoice._id } });

    const first = await callController(raiseLateInterest, { user, body: { asOf: "2026-03-02" } });
    expect(first.payload.raised).toHaveLength(1);
    const note = await ClientCreditNote.findById(first.payload.raised[0].noteId).lean();
    expect(note).toMatchObject({ noteType: "DEBIT_NOTE", taxAmount: 0 });
    expect(note.lines[0].taxCodeKey).toBe("vat_exempt");
    expect((await movement(note._id)).balanced).toBe(true);

    const again = await callController(raiseLateInterest, { user, body: { asOf: "2026-03-02" } });
    expect(again.payload.raised).toHaveLength(0);
  }, 120000);
});
