/**
 * Automated payment reminders (dunning) for client invoices.
 *
 * Each company has a schedule of steps keyed by days relative to the due date
 * (default −3, 0, +7, +14, +30). On every daily run an open invoice gets the
 * single most-advanced step it has reached and not yet received — so an
 * invoice first seen at +20 days gets the +14 notice, not a burst of three.
 * ClientDunningLog's unique (invoice, step, channel) index makes the run
 * idempotent across re-runs and overlapping workers.
 *
 * Never reminded: disputed invoices, opted-out clients, and invoices covered
 * by an open promise-to-pay that hasn't fallen due.
 */
import mongoose from "mongoose";
import { round2 } from "../../../utils/math.js";
import Company from "../../../models/Company.js";
import { sendAdHocSms, sendAdHocEmail } from "../../../services/communicationService.js";
import Client from "../models/Client.js";
import ClientInvoice from "../models/ClientInvoice.js";
import ClientInteraction from "../models/ClientInteraction.js";
import ClientCollectionSettings from "../models/ClientCollectionSettings.js";
import ClientDunningLog from "../models/ClientDunningLog.js";
import ClientInvoiceFlag from "../models/ClientInvoiceFlag.js";
import ClientPromiseToPay from "../models/ClientPromiseToPay.js";
import ClientReceipt from "../models/ClientReceipt.js";
import { OPEN_INVOICE_STATUSES, OUTSTANDING_FIELDS, invoiceOutstanding } from "./clientReceiptService.js";
import { formatCurrency, formatDate } from "./clientEmailService.js";

const DAY_MS = 86400000;

const startOfDay = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

export const daysFromDue = (dueDate, now = new Date()) =>
  Math.round((startOfDay(now) - startOfDay(dueDate)) / DAY_MS);

export const renderTemplate = (template, fields) =>
  String(template || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => (fields[key] ?? "").toString()).replace(/[ \t]+$/gm, "").trim();

// Most advanced active step the invoice has reached.
export const pickStep = (steps, days) => {
  let chosen = null;
  for (const step of steps) {
    if (!step.active || step.offsetDays > days) continue;
    if (!chosen || step.offsetDays > chosen.offsetDays) chosen = step;
  }
  return chosen;
};

const promiseCovers = (promise, invoice) =>
  !promise.invoices?.length || promise.invoices.some((id) => String(id) === String(invoice._id));

/**
 * Pure selection: given already-loaded data, decide what to send. Exported
 * for the preview endpoint and tests.
 */
export const selectDunningActions = ({ invoices, steps, now = new Date(), clientsById, disputedInvoiceIds, openPromises = [], sentKeys = new Set(), minimumAmount = 0 }) => {
  const actions = [];
  const skipped = [];
  const today = startOfDay(now);
  for (const invoice of invoices) {
    const outstanding = invoiceOutstanding(invoice);
    if (outstanding <= 0 || outstanding < minimumAmount) continue;
    const days = daysFromDue(invoice.dueDate, now);
    const step = pickStep(steps, days);
    if (!step) continue;
    const client = clientsById.get(String(invoice.client));
    const skip = (reason) => skipped.push({ invoice: invoice._id, invoiceNumber: invoice.invoiceNumber, stepKey: step.key, reason });
    if (!client) { skip("client_missing"); continue; }
    if (client.dunningOptOut) { skip("opted_out"); continue; }
    if (disputedInvoiceIds.has(String(invoice._id))) { skip("disputed"); continue; }
    const promise = openPromises.find((p) => String(p.client) === String(invoice.client) && startOfDay(p.promiseDate) >= today && promiseCovers(p, invoice));
    if (promise) { skip("promise_to_pay"); continue; }
    const channels = (step.channels || []).filter((channel) => !sentKeys.has(`${invoice._id}:${step.key}:${channel}`));
    if (!channels.length) continue;
    actions.push({ invoice, client, step, channels, outstanding, daysOverdue: Math.max(0, days) });
  }
  return { actions, skipped };
};

const emailRecipients = (client) => {
  const list = [];
  if (client.email) list.push(client.email);
  for (const contact of client.contactPersons || []) {
    if (["to", "cc"].includes(contact.receivesInvoices) && contact.email) list.push(contact.email);
  }
  return [...new Set(list.map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
};

const smsRecipient = (client) =>
  client.phone || (client.contactPersons || []).find((c) => c.isPrimary && c.phone)?.phone || (client.contactPersons || []).find((c) => c.phone)?.phone || "";

const defaultSenders = {
  sms: ({ business, to, body, client }) => sendAdHocSms({ businessId: business, phone: to, body, templateKey: "client_dunning", recipientName: client.name }),
  email: ({ business, to, subject, body }) => sendAdHocEmail({ businessId: business, to, subject, bodyText: body }),
};

const loadCompanyContext = async (business, settings, now) => {
  const steps = (settings.steps || []).filter((s) => s.active);
  if (!steps.length) return null;
  const maxLead = Math.max(0, ...steps.map((s) => -s.offsetDays));
  const horizon = new Date(startOfDay(now).getTime() + (maxLead + 1) * DAY_MS);

  const invoices = await ClientInvoice.find({ business, status: { $in: OPEN_INVOICE_STATUSES }, dueDate: { $lt: horizon } })
    .select(`client invoiceNumber currency ${OUTSTANDING_FIELDS}`)
    .lean();
  if (!invoices.length) return { steps, invoices, clientsById: new Map(), disputedInvoiceIds: new Set(), openPromises: [], sentKeys: new Set() };

  const invoiceIds = invoices.map((i) => i._id);
  const clientIds = [...new Set(invoices.map((i) => String(i.client)))];
  const [clients, flags, promises, logs] = await Promise.all([
    Client.find({ _id: { $in: clientIds }, business }).select("name email phone contactPersons dunningOptOut status terms").lean(),
    ClientInvoiceFlag.find({ business, invoice: { $in: invoiceIds }, disputed: true }).select("invoice").lean(),
    ClientPromiseToPay.find({ business, client: { $in: clientIds }, status: "open" }).select("client invoices promiseDate").lean(),
    ClientDunningLog.find({ business, invoice: { $in: invoiceIds } }).select("invoice stepKey channel").lean(),
  ]);
  return {
    steps,
    invoices,
    clientsById: new Map(clients.map((c) => [String(c._id), c])),
    disputedInvoiceIds: new Set(flags.map((f) => String(f.invoice))),
    openPromises: promises,
    sentKeys: new Set(logs.map((l) => `${l.invoice}:${l.stepKey}:${l.channel}`)),
  };
};

// Closes promises whose date has passed: kept if receipts since the promise
// cover the promised amount, broken otherwise. One aggregation per company.
export const resolveDuePromises = async ({ business, now = new Date() }) => {
  const due = await ClientPromiseToPay.find({ business, status: "open", promiseDate: { $lt: startOfDay(now) } }).lean();
  if (!due.length) return { kept: 0, broken: 0 };
  const earliest = due.reduce((min, p) => (p.madeAt < min ? p.madeAt : min), due[0].madeAt);
  const receipts = await ClientReceipt.find({
    business,
    client: { $in: [...new Set(due.map((p) => String(p.client)))] },
    status: "posted",
    receiptDate: { $gte: startOfDay(earliest) },
  }).select("client receiptDate amount whtIncomeTax whtVat").lean();

  const ops = due.map((promise) => {
    const paid = receipts
      .filter((r) => String(r.client) === String(promise.client) && r.receiptDate >= startOfDay(promise.madeAt) && r.receiptDate < new Date(startOfDay(promise.promiseDate).getTime() + DAY_MS))
      .reduce((sum, r) => sum + r.amount + (r.whtIncomeTax?.amount || 0) + (r.whtVat?.amount || 0), 0);
    const kept = round2(paid) >= round2(promise.promisedAmount || 0.01);
    return { updateOne: { filter: { _id: promise._id, status: "open" }, update: { $set: { status: kept ? "kept" : "broken", resolvedAt: now } } }, kept };
  });
  await ClientPromiseToPay.bulkWrite(ops.map((o) => o.updateOne && { updateOne: o.updateOne }));
  const kept = ops.filter((o) => o.kept).length;
  return { kept, broken: ops.length - kept };
};

const runCompany = async ({ settings, now, dryRun, senders }) => {
  const business = settings.business;
  const result = { business: String(business), sent: 0, failed: 0, skipped: [], actions: [] };
  if (!dryRun) await resolveDuePromises({ business, now });

  const context = await loadCompanyContext(business, settings, now);
  if (!context) return result;
  const { actions, skipped } = selectDunningActions({ ...context, now, minimumAmount: Number(settings.minimumAmount || 0) });
  result.skipped = skipped;
  if (!actions.length) return result;

  const company = await Company.findById(business).select("companyName baseCurrency").lean();
  const interactions = [];

  for (const action of actions) {
    const { invoice, client, step, channels, outstanding, daysOverdue } = action;
    const currency = invoice.currency || client.terms?.currency || company?.baseCurrency || "KES";
    const fields = {
      clientName: client.name,
      invoiceNumber: invoice.invoiceNumber,
      amount: formatCurrency(invoice.total, currency),
      outstanding: formatCurrency(outstanding, currency),
      dueDate: formatDate(invoice.dueDate),
      daysOverdue: String(daysOverdue),
      payInstructions: settings.payInstructions || "",
      companyName: company?.companyName || "",
    };
    const planned = { invoice: invoice._id, invoiceNumber: invoice.invoiceNumber, client: client._id, clientName: client.name, stepKey: step.key, offsetDays: step.offsetDays, outstanding, sends: [] };

    for (const channel of channels) {
      const to = channel === "sms" ? smsRecipient(client) : emailRecipients(client).join(",");
      const body = renderTemplate(channel === "sms" ? step.smsTemplate : step.emailTemplate, fields);
      const subject = channel === "email" ? renderTemplate(step.emailSubject, fields) : "";
      planned.sends.push({ channel, to, subject, body });
      if (dryRun) continue;

      let status = "sent";
      let error = "";
      if (!to) {
        status = "skipped";
        error = `No ${channel === "sms" ? "phone number" : "email address"} on file`;
      } else {
        try {
          const outcome = await senders[channel]({ business, to, subject, body, client, invoice });
          if (channel === "sms" && !(outcome?.messageId || outcome?.status)) { status = "failed"; error = "SMS dispatch could not be confirmed"; }
          if (channel === "email" && outcome?.success === false) { status = "failed"; error = outcome?.skipped ? "Email disabled for this company" : "Email not sent"; }
        } catch (err) {
          status = "failed";
          error = String(err?.message || err).slice(0, 300);
        }
      }
      try {
        await ClientDunningLog.create({ business, client: client._id, invoice: invoice._id, invoiceNumber: invoice.invoiceNumber, stepKey: step.key, offsetDays: step.offsetDays, channel, to, subject, body, outstanding, status, error, sentAt: now });
      } catch (logErr) {
        if (logErr?.code === 11000) continue; // a parallel run already logged this send
        throw logErr;
      }
      if (status === "sent") result.sent += 1;
      else if (status === "failed") result.failed += 1;
      if (status !== "skipped") {
        interactions.push({
          business,
          client: client._id,
          type: channel,
          subject: channel === "email" ? subject : `Payment reminder (${step.key}) — ${invoice.invoiceNumber}`,
          body,
          relatedInvoice: invoice._id,
          emailStatus: status === "sent" ? "sent" : "failed",
        });
      }
    }
    result.actions.push(planned);
  }

  if (interactions.length) await ClientInteraction.insertMany(interactions, { ordered: false }).catch((err) => console.error("[Dunning] interaction log failed:", err?.message));
  return result;
};

/**
 * Daily cron entry point. Processes every company with dunning enabled (or
 * just `businessId`). `dryRun` returns what would be sent without sending or
 * logging (powers the preview endpoint).
 */
export const processClientDunning = async ({ now = new Date(), businessId = null, dryRun = false, senders = defaultSenders } = {}) => {
  const filter = businessId ? { business: new mongoose.Types.ObjectId(String(businessId)) } : { dunningEnabled: true };
  if (businessId && !dryRun) filter.dunningEnabled = true;
  const companies = await ClientCollectionSettings.find(filter).lean();
  const summary = { companies: 0, sent: 0, failed: 0, results: [] };
  for (const settings of companies) {
    try {
      const result = await runCompany({ settings, now, dryRun, senders: { ...defaultSenders, ...senders } });
      summary.companies += 1;
      summary.sent += result.sent;
      summary.failed += result.failed;
      summary.results.push(result);
    } catch (err) {
      console.error("[Dunning] company=%s failed: %s", settings.business, err?.message || err);
      summary.results.push({ business: String(settings.business), error: err?.message || String(err) });
    }
  }
  if (!dryRun && summary.companies) console.log(`[Dunning] ${summary.sent} sent, ${summary.failed} failed across ${summary.companies} compan${summary.companies === 1 ? "y" : "ies"}`);
  return summary;
};
