// Collections: dunning settings/preview/log, invoice disputes,
// promises-to-pay, credit control and late-interest preview.
import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import { logAuditEvent } from "../../../utils/auditLogger.js";
import { emitToCompany } from "../../../utils/socketManager.js";
import { round2 } from "../../../utils/math.js";
import Client from "../models/Client.js";
import ClientInvoice from "../models/ClientInvoice.js";
import ClientInteraction from "../models/ClientInteraction.js";
import ClientCollectionSettings from "../models/ClientCollectionSettings.js";
import ClientDunningLog from "../models/ClientDunningLog.js";
import ClientInvoiceFlag from "../models/ClientInvoiceFlag.js";
import ClientPromiseToPay from "../models/ClientPromiseToPay.js";
import { resolveActiveBusinessId, currentUserId } from "../services/businessScope.js";
import { getCollectionSettings, assertClientCreditOk } from "../services/clientCreditControlService.js";
import { processClientDunning } from "../services/dunningService.js";
import { computeLateInterest, buildLateInterestDebitNotePayloads } from "../services/lateInterestService.js";

const isId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const paging = (query) => {
  const limit = Math.min(Math.max(Number(query.limit || 25), 1), 200);
  const page = Math.max(Number(query.page || 1), 1);
  return { limit, page, skip: (page - 1) * limit };
};
const pageInfo = (page, limit, total) => ({ page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) });
const audit = (req, business, action, targetType, targetId, targetName, message, metadata = {}) =>
  logAuditEvent({ req, company: business, action, category: "finance", targetType, targetId, targetName, message, metadata });

// ─── Settings ────────────────────────────────────────────────────────────────

export const getSettings = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const settings = await getCollectionSettings(business);
    res.status(200).json({ success: true, data: settings, settings });
  } catch (error) {
    next(error);
  }
};

const sanitizeSteps = (steps) => {
  if (!Array.isArray(steps)) throw createError(400, "steps must be an array");
  const seen = new Set();
  return steps.map((step) => {
    const key = String(step?.key || "").trim();
    const offsetDays = Number(step?.offsetDays);
    if (!key) throw createError(400, "Each dunning step needs a key");
    if (seen.has(key)) throw createError(400, `Duplicate dunning step key "${key}"`);
    seen.add(key);
    if (!Number.isInteger(offsetDays) || offsetDays < -60 || offsetDays > 365) throw createError(400, `Step "${key}": offsetDays must be a whole number between -60 and 365`);
    const channels = [...new Set((Array.isArray(step?.channels) ? step.channels : []).filter((c) => ["sms", "email"].includes(c)))];
    return {
      key,
      offsetDays,
      channels,
      smsTemplate: String(step?.smsTemplate || ""),
      emailSubject: String(step?.emailSubject || ""),
      emailTemplate: String(step?.emailTemplate || ""),
      active: step?.active !== false,
    };
  });
};

export const updateSettings = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const body = req.body || {};
    const $set = { updatedBy: userId };
    if (body.dunningEnabled !== undefined) $set.dunningEnabled = Boolean(body.dunningEnabled);
    if (body.steps !== undefined) $set.steps = sanitizeSteps(body.steps);
    if (body.payInstructions !== undefined) $set.payInstructions = String(body.payInstructions || "").trim().slice(0, 500);
    if (body.minimumAmount !== undefined) $set.minimumAmount = Math.max(0, Number(body.minimumAmount) || 0);
    if (body.creditLimitAction !== undefined) {
      if (!["warn", "block"].includes(body.creditLimitAction)) return next(createError(400, "creditLimitAction must be warn or block"));
      $set.creditLimitAction = body.creditLimitAction;
    }
    if (body.creditWarnPercent !== undefined) $set.creditWarnPercent = Math.min(100, Math.max(1, Number(body.creditWarnPercent) || 90));
    await getCollectionSettings(business);
    const settings = await ClientCollectionSettings.findOneAndUpdate({ business }, { $set }, { new: true, runValidators: true }).lean();
    audit(req, business, "client.collections.settings_updated", "ClientCollectionSettings", settings._id, "Collections settings", "Client collections settings updated", { fields: Object.keys($set).filter((k) => k !== "updatedBy") });
    res.status(200).json({ success: true, data: settings, settings, message: "Collections settings saved" });
  } catch (error) {
    next(error);
  }
};

// ─── Dunning ─────────────────────────────────────────────────────────────────

// What today's run would send (works even while dunning is switched off).
export const previewDunning = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const summary = await processClientDunning({ businessId: business, dryRun: true });
    const result = summary.results[0] || { actions: [], skipped: [] };
    res.status(200).json({ success: true, data: { actions: result.actions || [], skipped: result.skipped || [] } });
  } catch (error) {
    next(error);
  }
};

export const runDunningNow = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const settings = await getCollectionSettings(business);
    if (!settings.dunningEnabled) return next(createError(400, "Automated reminders are switched off for this company"));
    const summary = await processClientDunning({ businessId: business });
    const result = summary.results[0] || { sent: 0, failed: 0 };
    audit(req, business, "client.collections.dunning_run", "ClientCollectionSettings", settings._id, "Dunning run", `Manual dunning run: ${result.sent || 0} sent, ${result.failed || 0} failed`);
    res.status(200).json({ success: true, data: result, message: `${result.sent || 0} reminder(s) sent` });
  } catch (error) {
    next(error);
  }
};

export const listDunningLog = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };
    if (isId(req.query.clientId)) filter.client = req.query.clientId;
    if (isId(req.query.invoiceId)) filter.invoice = req.query.invoiceId;
    if (["sent", "failed", "skipped"].includes(req.query.status)) filter.status = req.query.status;
    const { limit, page, skip } = paging(req.query);
    const [logs, total] = await Promise.all([
      ClientDunningLog.find(filter).populate("client", "name clientCode").sort({ sentAt: -1 }).skip(skip).limit(limit).lean(),
      ClientDunningLog.countDocuments(filter),
    ]);
    res.status(200).json({ success: true, data: { logs, pagination: pageInfo(page, limit, total) }, logs });
  } catch (error) {
    next(error);
  }
};

// ─── Disputes ────────────────────────────────────────────────────────────────

const loadInvoice = async (business, invoiceId) => {
  if (!isId(invoiceId)) throw createError(400, "Invalid invoice id");
  const invoice = await ClientInvoice.findOne({ _id: invoiceId, business }).select("client invoiceNumber status").lean();
  if (!invoice) throw createError(404, "Invoice not found");
  return invoice;
};

// Company-wide disputes (open by default; ?status=resolved|all), with the invoice and its outstanding
export const listDisputes = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const status = String(req.query.status || "open");
    const filter = { business };
    if (status === "open") filter.disputed = true;
    else if (status === "resolved") { filter.disputed = false; filter.disputeResolvedAt = { $ne: null }; }
    else filter.$or = [{ disputed: true }, { disputeResolvedAt: { $ne: null } }];
    if (req.query.clientId && mongoose.Types.ObjectId.isValid(String(req.query.clientId))) filter.client = req.query.clientId;

    const flags = await ClientInvoiceFlag.find(filter)
      .sort({ disputedAt: -1 })
      .limit(500)
      .populate("client", "name clientCode")
      .populate("invoice", "invoiceNumber issueDate dueDate total paidAmount creditedAmount debitedAmount status")
      .populate("disputedBy", "surname otherNames email")
      .lean();
    const disputes = flags.map((flag) => ({
      ...flag,
      outstanding: flag.invoice
        ? round2(Math.max(0, Number(flag.invoice.total || 0) + Number(flag.invoice.debitedAmount || 0) - Number(flag.invoice.paidAmount || 0) - Number(flag.invoice.creditedAmount || 0)))
        : 0,
    }));
    res.status(200).json({ success: true, data: { disputes, total: round2(disputes.reduce((sum, d) => sum + d.outstanding, 0)) } });
  } catch (error) {
    next(error);
  }
};

export const getInvoiceFlag = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    await loadInvoice(business, req.params.invoiceId);
    const flag = await ClientInvoiceFlag.findOne({ business, invoice: req.params.invoiceId }).lean();
    res.status(200).json({ success: true, data: flag || { disputed: false }, flag });
  } catch (error) {
    next(error);
  }
};

// Disputed invoices are skipped by dunning and late interest until resolved.
export const setInvoiceDispute = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const invoice = await loadInvoice(business, req.params.invoiceId);
    const disputed = req.body?.disputed !== false;
    const reason = String(req.body?.reason || req.body?.resolution || "").trim();
    if (disputed && !reason) return next(createError(400, "A dispute reason is required"));
    const $set = disputed
      ? { disputed: true, disputeReason: reason, disputedAt: new Date(), disputedBy: userId, disputeResolvedAt: null, disputeResolution: "" }
      : { disputed: false, disputeResolvedAt: new Date(), disputeResolution: reason };
    const flag = await ClientInvoiceFlag.findOneAndUpdate(
      { business, invoice: invoice._id },
      { $set, $setOnInsert: { client: invoice.client } },
      { upsert: true, new: true }
    ).lean();
    await ClientInteraction.create({
      business,
      client: invoice.client,
      type: "note",
      subject: `${disputed ? "Dispute raised" : "Dispute resolved"} — ${invoice.invoiceNumber}`,
      body: reason,
      relatedInvoice: invoice._id,
      emailStatus: "sent",
      createdBy: userId,
    });
    audit(req, business, disputed ? "client.invoice.disputed" : "client.invoice.dispute_resolved", "ClientInvoice", invoice._id, invoice.invoiceNumber, `Invoice ${invoice.invoiceNumber} ${disputed ? "disputed" : "dispute resolved"}`, { reason });
    emitToCompany(business, "clientInvoice:flagged", { _id: invoice._id, disputed });
    res.status(200).json({ success: true, data: flag, flag, message: disputed ? "Invoice marked as disputed" : "Dispute resolved" });
  } catch (error) {
    next(error);
  }
};

// ─── Promises to pay ─────────────────────────────────────────────────────────

export const listPromises = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };
    if (isId(req.query.clientId)) filter.client = req.query.clientId;
    if (["open", "kept", "broken", "cancelled"].includes(req.query.status)) filter.status = req.query.status;
    const { limit, page, skip } = paging(req.query);
    const [promises, total] = await Promise.all([
      ClientPromiseToPay.find(filter).populate("client", "name clientCode").populate("invoices", "invoiceNumber total paidAmount dueDate").sort({ promiseDate: 1 }).skip(skip).limit(limit).lean(),
      ClientPromiseToPay.countDocuments(filter),
    ]);
    res.status(200).json({ success: true, data: { promises, pagination: pageInfo(page, limit, total) }, promises });
  } catch (error) {
    next(error);
  }
};

export const createPromise = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const body = req.body || {};
    if (!isId(body.clientId)) return next(createError(400, "clientId is required"));
    const client = await Client.findOne({ _id: body.clientId, business }).select("name").lean();
    if (!client) return next(createError(404, "Client not found"));
    const promiseDate = new Date(body.promiseDate);
    if (Number.isNaN(promiseDate.getTime())) return next(createError(400, "A valid promise date is required"));
    const invoiceIds = (Array.isArray(body.invoices) ? body.invoices : []).filter(isId);
    if (invoiceIds.length) {
      const found = await ClientInvoice.countDocuments({ _id: { $in: invoiceIds }, business, client: client._id });
      if (found !== invoiceIds.length) return next(createError(400, "Every invoice must belong to this client"));
    }
    const promise = await ClientPromiseToPay.create({
      business,
      client: client._id,
      invoices: invoiceIds,
      promiseDate,
      promisedAmount: round2(Math.max(0, Number(body.promisedAmount) || 0)),
      contactName: String(body.contactName || "").trim(),
      notes: String(body.notes || "").trim(),
      createdBy: userId,
    });
    await ClientInteraction.create({
      business,
      client: client._id,
      type: "note",
      subject: `Promise to pay by ${promiseDate.toISOString().slice(0, 10)}`,
      body: `${promise.promisedAmount ? `Amount: ${promise.promisedAmount}. ` : ""}${promise.notes}`.trim(),
      relatedInvoice: invoiceIds[0] || null,
      emailStatus: "sent",
      createdBy: userId,
    });
    audit(req, business, "client.promise_to_pay.created", "ClientPromiseToPay", promise._id, client.name, `Promise to pay recorded for ${client.name}`, { promiseDate, promisedAmount: promise.promisedAmount, invoices: invoiceIds });
    res.status(201).json({ success: true, data: promise, promise, message: "Promise to pay recorded" });
  } catch (error) {
    next(error);
  }
};

export const updatePromise = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const $set = {};
    if (req.body?.status !== undefined) {
      if (!["kept", "broken", "cancelled"].includes(req.body.status)) return next(createError(400, "status must be kept, broken or cancelled"));
      $set.status = req.body.status;
      $set.resolvedAt = new Date();
    }
    if (req.body?.promiseDate !== undefined) {
      const date = new Date(req.body.promiseDate);
      if (Number.isNaN(date.getTime())) return next(createError(400, "Invalid promise date"));
      $set.promiseDate = date;
    }
    if (req.body?.notes !== undefined) $set.notes = String(req.body.notes || "").trim();
    const promise = await ClientPromiseToPay.findOneAndUpdate({ _id: req.params.id, business, status: "open" }, { $set }, { new: true }).lean();
    if (!promise) return next(createError(404, "Open promise not found"));
    audit(req, business, "client.promise_to_pay.updated", "ClientPromiseToPay", promise._id, String(promise.client), "Promise to pay updated", $set);
    res.status(200).json({ success: true, data: promise, promise, message: "Promise updated" });
  } catch (error) {
    next(error);
  }
};

// ─── Credit control ──────────────────────────────────────────────────────────

export const creditCheck = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    if (!isId(req.params.clientId)) return next(createError(400, "Invalid client id"));
    const result = await assertClientCreditOk(req.params.clientId, { business, additionalAmount: Number(req.query.amount || 0) });
    if (result.reasons?.[0] === "Client not found") return next(createError(404, "Client not found"));
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

export const setCreditHold = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const hold = Boolean(req.body?.hold);
    const reason = String(req.body?.reason || "").trim();
    if (hold && !reason) return next(createError(400, "A reason is required to put a client on credit hold"));
    const client = await Client.findOneAndUpdate(
      { _id: req.params.clientId, business },
      { $set: { creditHold: hold, creditHoldReason: hold ? reason : "", updatedBy: userId } },
      { new: true }
    ).select("name clientCode creditHold creditHoldReason").lean();
    if (!client) return next(createError(404, "Client not found"));
    audit(req, business, hold ? "client.credit_hold.on" : "client.credit_hold.off", "Client", client._id, client.name, `${client.name} ${hold ? "put on" : "released from"} credit hold`, { reason });
    emitToCompany(business, "client:updated", { _id: client._id });
    res.status(200).json({ success: true, data: client, client, message: hold ? "Client on credit hold" : "Credit hold released" });
  } catch (error) {
    next(error);
  }
};

// ─── Late-payment interest ───────────────────────────────────────────────────

export const previewLateInterest = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const asOf = req.query.asOf ? new Date(req.query.asOf) : new Date();
    if (Number.isNaN(asOf.getTime())) return next(createError(400, "Invalid asOf date"));
    const clientId = isId(req.query.clientId) ? req.query.clientId : null;
    const [rows, debitNotes] = await Promise.all([
      computeLateInterest({ business, asOf, clientId }),
      buildLateInterestDebitNotePayloads({ business, asOf, clientId }),
    ]);
    res.status(200).json({ success: true, data: { asOf, rows, debitNotes, total: round2(rows.reduce((s, r) => s + r.amount, 0)) } });
  } catch (error) {
    next(error);
  }
};
