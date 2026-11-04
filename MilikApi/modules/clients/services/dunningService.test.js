// Dunning schedule selection and the daily run, with sends mocked.
import { describe, it, expect } from "vitest";
import Client from "../models/Client.js";
import ClientCollectionSettings from "../models/ClientCollectionSettings.js";
import ClientDunningLog from "../models/ClientDunningLog.js";
import ClientInteraction from "../models/ClientInteraction.js";
import ClientInvoiceFlag from "../models/ClientInvoiceFlag.js";
import ClientPromiseToPay from "../models/ClientPromiseToPay.js";
import { processClientDunning, pickStep, renderTemplate, daysFromDue } from "./dunningService.js";
import { DEFAULT_DUNNING_STEPS } from "../models/ClientCollectionSettings.js";
import { setupClientsCompany, createPostedInvoice } from "../test/clientsTestKit.js";

const DAY = 86400000;
const due = (offset) => new Date(Date.now() + offset * DAY);

const mockSenders = () => {
  const calls = [];
  return {
    calls,
    senders: {
      sms: async (args) => { calls.push({ channel: "sms", ...args }); return { messageId: "x" }; },
      email: async (args) => { calls.push({ channel: "email", ...args }); return { success: true }; },
    },
  };
};

describe("client dunning", () => {
  it("picks the most advanced step reached and renders merge fields", () => {
    expect(pickStep(DEFAULT_DUNNING_STEPS, -5)).toBeNull();
    expect(pickStep(DEFAULT_DUNNING_STEPS, -3).key).toBe("before_3");
    expect(pickStep(DEFAULT_DUNNING_STEPS, 0).key).toBe("due_0");
    expect(pickStep(DEFAULT_DUNNING_STEPS, 20).key).toBe("overdue_14");
    expect(pickStep(DEFAULT_DUNNING_STEPS, 400).key).toBe("overdue_30");
    expect(daysFromDue(due(-10))).toBe(10);
    expect(renderTemplate("Hi {{clientName}}, {{invoiceNumber}} is {{daysOverdue}} days late", { clientName: "Acme", invoiceNumber: "CINV-1", daysOverdue: "7" }))
      .toBe("Hi Acme, CINV-1 is 7 days late");
  });

  it("sends the right step per invoice, skips disputed/opted-out/promised, logs everything and is idempotent", async () => {
    const { business, userId, client } = await setupClientsCompany();
    await ClientCollectionSettings.create({ business, dunningEnabled: true, payInstructions: "Paybill 600100, account {{invoiceNumber}}" });

    const soon = await createPostedInvoice({ business, client, userId, amount: 100, dueDate: due(3) });
    const today = await createPostedInvoice({ business, client, userId, amount: 200, dueDate: due(0) });
    const late = await createPostedInvoice({ business, client, userId, amount: 300, dueDate: due(-10) });
    const disputed = await createPostedInvoice({ business, client, userId, amount: 400, dueDate: due(-20) });
    const promised = await createPostedInvoice({ business, client, userId, amount: 500, dueDate: due(-40) });
    await createPostedInvoice({ business, client, userId, amount: 600, dueDate: due(10) }); // not yet in any window

    const optedOut = await Client.create({ business, name: "Quiet Co", clientCode: "CLT-OPT01", phone: "0700111222", email: "quiet@co.test", dunningOptOut: true });
    await createPostedInvoice({ business, client: optedOut, userId, amount: 700, dueDate: due(-15) });

    await ClientInvoiceFlag.create({ business, client: client._id, invoice: disputed._id, disputed: true, disputeReason: "Service not delivered" });
    await ClientPromiseToPay.create({ business, client: client._id, invoices: [promised._id], promiseDate: due(5), promisedAmount: 500 });

    const { calls, senders } = mockSenders();
    const summary = await processClientDunning({ businessId: business, senders });
    const result = summary.results[0];

    const sentFor = (invoice) => calls.filter((c) => String(c.invoice._id) === String(invoice._id)).map((c) => c.channel).sort();
    expect(sentFor(soon)).toEqual(["email"]); // before_3 is email-only by default
    expect(sentFor(today)).toEqual(["email", "sms"]);
    expect(sentFor(late)).toEqual(["email", "sms"]);
    expect(sentFor(disputed)).toEqual([]);
    expect(sentFor(promised)).toEqual([]);
    expect(calls.some((c) => String(c.client._id) === String(optedOut._id))).toBe(false);

    expect(result.skipped.map((s) => s.reason).sort()).toEqual(["disputed", "opted_out", "promise_to_pay"]);
    const lateSms = calls.find((c) => String(c.invoice._id) === String(late._id) && c.channel === "sms");
    expect(lateSms.body).toContain(late.invoiceNumber);
    expect(lateSms.body).toContain("10 days overdue");
    expect(lateSms.to).toBe("0712345678");

    expect(await ClientDunningLog.countDocuments({ business })).toBe(5);
    expect(await ClientInteraction.countDocuments({ business, relatedInvoice: late._id })).toBe(2);

    // Same day again: nothing new goes out.
    const second = mockSenders();
    await processClientDunning({ businessId: business, senders: second.senders });
    expect(second.calls).toHaveLength(0);

    // Five days later the late invoice has reached +14, and the promise is past due.
    const later = mockSenders();
    await processClientDunning({ businessId: business, senders: later.senders, now: new Date(Date.now() + 6 * DAY) });
    const lateSteps = await ClientDunningLog.find({ invoice: late._id }).distinct("stepKey");
    expect(lateSteps.sort()).toEqual(["overdue_14", "overdue_7"]);
    expect((await ClientPromiseToPay.findOne({ business }).lean()).status).toBe("broken");
    expect(later.calls.some((c) => String(c.invoice._id) === String(promised._id))).toBe(true);
  });

  it("does nothing for companies that have not switched dunning on, but previews what would be sent", async () => {
    const { business, userId, client } = await setupClientsCompany();
    await createPostedInvoice({ business, client, userId, amount: 100, dueDate: due(-8) });
    const { calls, senders } = mockSenders();
    const cron = await processClientDunning({ senders });
    expect(cron.results.find((r) => r.business === business)).toBeUndefined();
    expect(calls).toHaveLength(0);

    await ClientCollectionSettings.create({ business, dunningEnabled: false });
    const preview = await processClientDunning({ businessId: business, dryRun: true, senders });
    expect(preview.results[0].actions[0].stepKey).toBe("overdue_7");
    expect(calls).toHaveLength(0);
    expect(await ClientDunningLog.countDocuments({ business })).toBe(0);
  });
});
