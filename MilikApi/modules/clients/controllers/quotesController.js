import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import { logAuditEvent } from "../../../utils/auditLogger.js";
import { emitToCompany } from "../../../utils/socketManager.js";
import ClientQuote, { QUOTE_STATUSES } from "../models/ClientQuote.js";
import ClientContract from "../models/ClientContract.js";
import ClientInvoice from "../models/ClientInvoice.js";
import Client from "../models/Client.js";
import { resolveActiveBusinessId, currentUserId, escapeRegex } from "../services/businessScope.js";
import { nextContractNumber, nextInvoiceNumberForSeries, nextQuoteNumber } from "../services/clientSequenceService.js";
import { getClientBillingSettings, sanitizeContractLines } from "../services/clientContractService.js";
import { calculateLineAmounts, computeContractMetrics, summarizeLines, toUTCDate, addDaysUTC } from "../services/clientLineMath.js";
import { generateQuotePdf, sendPdf } from "../services/clientDocumentPdfService.js";

const EDITABLE = ["draft", "sent"];
const CONVERTIBLE = ["draft", "sent", "accepted"];

const auditQuote = (req, quote, action, message, metadata = {}) =>
  logAuditEvent({
    req, company: quote.business, action: `client_quote.${action}`, category: "finance",
    targetType: "ClientQuote", targetId: quote._id, targetName: quote.quoteNumber, message, metadata,
  });

const applyTotals = (quote) => {
  const priced = quote.lines.map((l) => calculateLineAmounts({ ...(l.toObject ? l.toObject() : l), taxMode: quote.taxMode }));
  const totals = summarizeLines(priced);
  quote.subtotal = totals.subtotal;
  quote.discountTotal = totals.discountTotal;
  quote.taxAmount = totals.taxAmount;
  quote.total = totals.total;
  quote.recurringMonthly = computeContractMetrics({ lines: quote.lines.map((l) => (l.toObject ? l.toObject() : l)), taxMode: quote.taxMode, startDate: new Date(), openEnded: true }).mrr;
};

const readQuoteFields = (body = {}) => {
  const issueDate = body.issueDate ? new Date(body.issueDate) : new Date();
  const validUntil = body.validUntil ? new Date(body.validUntil) : addDaysUTC(toUTCDate(issueDate), 30);
  if (Number.isNaN(issueDate.getTime()) || Number.isNaN(validUntil.getTime())) throw createError(400, "Invalid issueDate/validUntil");
  if (validUntil < toUTCDate(issueDate)) throw createError(400, "validUntil cannot be before the quote date");
  return {
    kind: body.kind === "proforma" ? "proforma" : "quote",
    title: String(body.title || "").trim(),
    issueDate,
    validUntil,
    currency: String(body.currency || "KES").trim().toUpperCase() || "KES",
    taxMode: body.taxMode === "inclusive" ? "inclusive" : "exclusive",
    notes: String(body.notes || "").trim(),
    terms: String(body.terms || "").trim(),
  };
};

const loadQuote = async (req) => {
  const business = resolveActiveBusinessId(req);
  const quote = await ClientQuote.findOne({ _id: req.params.id, business });
  if (!quote) throw createError(404, "Quote not found");
  return { business, quote };
};

export const listQuotes = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };
    if (req.query.clientId) filter.client = String(req.query.clientId);
    if (QUOTE_STATUSES.includes(req.query.status)) filter.status = req.query.status;
    if (req.query.search) {
      const s = escapeRegex(String(req.query.search).trim());
      filter.$or = [{ quoteNumber: new RegExp(s, "i") }, { title: new RegExp(s, "i") }];
    }
    const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 200);
    const page = Math.max(Number(req.query.page || 1), 1);
    const [quotes, total] = await Promise.all([
      ClientQuote.find(filter).populate("client", "name clientCode").sort({ issueDate: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      ClientQuote.countDocuments(filter),
    ]);
    const pagination = { page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) };
    res.status(200).json({ success: true, data: { quotes, pagination }, quotes, pagination });
  } catch (error) {
    next(error);
  }
};

export const getQuote = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const quote = await ClientQuote.findOne({ _id: req.params.id, business }).populate("client", "name clientCode email phone").lean();
    if (!quote) return next(createError(404, "Quote not found"));
    res.status(200).json({ success: true, data: quote, quote });
  } catch (error) {
    next(error);
  }
};

export const createQuote = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const clientId = String(req.body?.client || "").trim();
    if (!mongoose.Types.ObjectId.isValid(clientId) || !(await Client.exists({ _id: clientId, business }))) {
      return next(createError(404, "Client not found"));
    }
    const lines = await sanitizeContractLines({ business, lines: req.body?.lines });
    if (!lines.length) return next(createError(400, "A quote needs at least one line"));
    const settings = await getClientBillingSettings(business);

    const quote = new ClientQuote({
      ...readQuoteFields(req.body),
      business,
      client: clientId,
      lines,
      terms: req.body?.terms !== undefined ? String(req.body.terms || "").trim() : settings.invoiceTerms || "",
      quoteNumber: await nextQuoteNumber(business, settings.quotePrefix),
      createdBy: userId,
      updatedBy: userId,
    });
    applyTotals(quote);
    await quote.save();
    await auditQuote(req, quote, "created", `Quote ${quote.quoteNumber} created (${quote.total})`);
    res.status(201).json({ success: true, data: quote, quote });
  } catch (error) {
    next(error);
  }
};

export const updateQuote = async (req, res, next) => {
  try {
    const { business, quote } = await loadQuote(req);
    if (!EDITABLE.includes(quote.status)) return next(createError(400, `A ${quote.status} quote can no longer be edited`));
    Object.assign(quote, readQuoteFields({ ...quote.toObject(), ...req.body }));
    if (Array.isArray(req.body?.lines)) {
      quote.lines = await sanitizeContractLines({ business, lines: req.body.lines, existingLines: quote.lines });
      if (!quote.lines.length) return next(createError(400, "A quote needs at least one line"));
    }
    quote.updatedBy = currentUserId(req);
    applyTotals(quote);
    await quote.save();
    await auditQuote(req, quote, "updated", `Quote ${quote.quoteNumber} updated (${quote.total})`);
    res.status(200).json({ success: true, data: quote, quote });
  } catch (error) {
    next(error);
  }
};

const transition = ({ from, to, action, needsReason = false }) => async (req, res, next) => {
  try {
    const { quote } = await loadQuote(req);
    if (!from.includes(quote.status)) return next(createError(400, `A ${quote.status} quote cannot be ${action}`));
    const reason = String(req.body?.reason || "").trim();
    if (needsReason && !reason) return next(createError(400, "A reason is required"));
    if (to === "accepted" && toUTCDate(quote.validUntil) < toUTCDate(new Date())) {
      return next(createError(400, "This quote has expired — update its validity date first"));
    }
    quote.status = to;
    if (to === "sent") quote.sentAt = new Date();
    if (to === "accepted") quote.acceptedAt = new Date();
    if (to === "declined") { quote.declinedAt = new Date(); quote.declineReason = reason; }
    quote.updatedBy = currentUserId(req);
    await quote.save();
    await auditQuote(req, quote, to, `Quote ${quote.quoteNumber} ${action}${reason ? `: ${reason}` : ""}`);
    res.status(200).json({ success: true, data: quote, quote });
  } catch (error) {
    next(error);
  }
};
export const sendQuote = transition({ from: ["draft", "sent"], to: "sent", action: "sent" });
export const acceptQuote = transition({ from: ["draft", "sent"], to: "accepted", action: "accepted" });
export const declineQuote = transition({ from: ["draft", "sent"], to: "declined", action: "declined", needsReason: true });

// Accepted (or still open) quote -> draft contract with the same lines. The contract still goes
// through submit/approval like any other.
export const convertQuoteToContract = async (req, res, next) => {
  try {
    const { business, quote } = await loadQuote(req);
    const userId = currentUserId(req);
    if (!CONVERTIBLE.includes(quote.status)) return next(createError(400, `A ${quote.status} quote cannot be converted`));
    if (quote.convertedContract) return next(createError(409, "This quote was already converted to a contract"));

    const body = req.body || {};
    const startDate = toUTCDate(body.startDate || new Date());
    const openEnded = body.openEnded === true || body.openEnded === "true";
    const endDate = openEnded ? null : toUTCDate(body.endDate);
    if (!startDate) return next(createError(400, "Valid startDate is required"));
    if (!openEnded && (!endDate || endDate <= startDate)) return next(createError(400, "A valid endDate after startDate is required (or openEnded)"));

    const contract = await ClientContract.create({
      business,
      client: quote.client,
      contractNumber: await nextContractNumber(business),
      description: quote.title || `From quote ${quote.quoteNumber}`,
      contractType: body.contractType || "retainer",
      startDate,
      endDate,
      openEnded,
      currency: quote.currency,
      taxMode: quote.taxMode,
      lines: quote.lines.map((l) => (l.toObject ? l.toObject() : l)),
      terms: quote.terms,
      paymentTermsDays: Number.isFinite(Number(body.paymentTermsDays)) ? Number(body.paymentTermsDays) : 30,
      sourceQuote: quote._id,
      owner: userId,
      status: "draft",
      createdBy: userId,
      updatedBy: userId,
    });
    quote.status = "accepted";
    quote.acceptedAt = quote.acceptedAt || new Date();
    quote.convertedContract = contract._id;
    await quote.save();
    await auditQuote(req, quote, "converted_contract", `Quote ${quote.quoteNumber} converted to contract ${contract.contractNumber}`, { contractId: String(contract._id) });
    emitToCompany(String(business), "clients:contract:updated", { contractId: String(contract._id), status: contract.status });
    res.status(201).json({ success: true, data: { quote, contract }, quote, contract });
  } catch (error) {
    next(error);
  }
};

// Quote -> draft invoice billing each line once (a proforma becoming the real invoice).
export const convertQuoteToInvoice = async (req, res, next) => {
  try {
    const { business, quote } = await loadQuote(req);
    const userId = currentUserId(req);
    if (!CONVERTIBLE.includes(quote.status)) return next(createError(400, `A ${quote.status} quote cannot be converted`));
    if (quote.convertedInvoice) return next(createError(409, "This quote was already converted to an invoice"));

    const settings = await getClientBillingSettings(business);
    const issueDate = toUTCDate(req.body?.issueDate || new Date());
    const terms = Number.isFinite(Number(req.body?.paymentTermsDays)) ? Number(req.body.paymentTermsDays) : Number(settings.defaultPaymentTermsDays ?? 30);
    const invoice = await ClientInvoice.create({
      business,
      client: quote.client,
      invoiceNumber: await nextInvoiceNumberForSeries(business, settings.invoicePrefix),
      series: String(settings.invoicePrefix || "CINV").toUpperCase(),
      currency: quote.currency,
      taxCalculation: "line",
      taxMode: quote.taxMode,
      issueDate,
      dueDate: addDaysUTC(issueDate, terms),
      lineItems: quote.lines.map((l) => ({
        itemName: l.itemName,
        description: l.description ? `${l.itemName} — ${l.description}` : l.itemName,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent,
        taxCodeKey: l.taxCodeKey,
        taxCodeName: l.taxCodeName,
        taxType: l.taxType,
        taxRate: l.taxRate,
        taxable: l.taxType === "vat",
        incomeAccount: l.incomeAccount || null,
      })),
      notes: `From ${quote.kind === "proforma" ? "proforma" : "quote"} ${quote.quoteNumber}`,
      terms: quote.terms || settings.invoiceTerms || "",
      createdBy: userId,
    });
    quote.status = "accepted";
    quote.acceptedAt = quote.acceptedAt || new Date();
    quote.convertedInvoice = invoice._id;
    await quote.save();
    await auditQuote(req, quote, "converted_invoice", `Quote ${quote.quoteNumber} converted to draft invoice ${invoice.invoiceNumber}`, { invoiceId: String(invoice._id) });
    res.status(201).json({ success: true, data: { quote, invoice }, quote, invoice });
  } catch (error) {
    next(error);
  }
};

export const getQuotePdf = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const buffer = await generateQuotePdf(req.params.id, business);
    sendPdf(res, buffer, `Quote-${req.params.id}.pdf`, req.query?.preview === "true");
  } catch (error) {
    next(error);
  }
};
