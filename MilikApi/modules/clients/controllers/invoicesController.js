import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import { round2 } from "../../../utils/math.js";
import ClientInvoice from "../models/ClientInvoice.js";
import ClientInteraction from "../models/ClientInteraction.js";
import ClientPayment from "../models/ClientPayment.js";
import Client from "../models/Client.js";
import Company from "../../../models/Company.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import { resolveActiveBusinessId, currentUserId, escapeRegex } from "../services/businessScope.js";
import { nextInvoiceNumber } from "../services/clientSequenceService.js";
import { sendInvoiceEmail, sendReceiptEmail } from "../services/clientEmailService.js";
import { postClientInvoiceLedger, postClientPaymentLedger } from "../services/clientAccountingService.js";
import { postReversal } from "../../../services/ledgerPostingService.js";


// ─── Sanitizers ──────────────────────────────────────────────────────────────

const ALLOWED_STATUSES = ["draft", "sent", "partial", "paid", "overdue", "cancelled"];

const sanitizeLineItem = (item) => {
  const quantity  = Math.max(0, Number(item.quantity  ?? 1));
  const unitPrice = Math.max(0, Number(item.unitPrice ?? 0));
  return {
    description: String(item.description || "").trim(),
    quantity,
    unitPrice,
    amount:  Math.round(quantity * unitPrice * 100) / 100,
    taxable: item.taxable !== false,
  };
};

const sanitizeLineItems = (items) => {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => item && String(item?.description || "").trim())
    .map(sanitizeLineItem);
};

const sanitizeInvoicePayload = (body = {}) => ({
  client:           String(body.client || "").trim(),
  contract:         String(body.contract || "").trim() || null,
  issueDate:        body.issueDate ? new Date(body.issueDate) : new Date(),
  dueDate:          body.dueDate   ? new Date(body.dueDate)   : null,
  periodStart:      body.periodStart ? new Date(body.periodStart) : null,
  periodEnd:        body.periodEnd   ? new Date(body.periodEnd)   : null,
  lineItems:        sanitizeLineItems(body.lineItems),
  vatRate:          Math.min(100, Math.max(0, Number(body.vatRate ?? 16))),
  notes:            String(body.notes || "").trim(),
});

// ─── Controllers ─────────────────────────────────────────────────────────────

export const listInvoices = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter   = { business };

    if (req.query.clientId) filter.client = String(req.query.clientId).trim();
    if (req.query.contractId) filter.contract = String(req.query.contractId).trim();
    if (req.query.status && ALLOWED_STATUSES.includes(req.query.status)) {
      filter.status = req.query.status;
    }
    if (req.query.search) {
      filter.invoiceNumber = new RegExp(escapeRegex(String(req.query.search).trim()), "i");
    }
    if (req.query.dateFrom || req.query.dateTo) {
      filter.issueDate = {};
      if (req.query.dateFrom) filter.issueDate.$gte = new Date(req.query.dateFrom);
      if (req.query.dateTo)   filter.issueDate.$lte = new Date(req.query.dateTo);
    }

    const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 200);
    const page  = Math.max(Number(req.query.page || 1), 1);
    const skip  = (page - 1) * limit;

    const [invoices, total] = await Promise.all([
      ClientInvoice.find(filter)
        .populate("client", "name clientCode email phone")
        .sort({ issueDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ClientInvoice.countDocuments(filter),
    ]);

    const pagination = { page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) };
    res.status(200).json({ success: true, data: { invoices, pagination }, invoices, pagination });
  } catch (error) {
    next(error);
  }
};

export const getInvoice = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const invoice = await ClientInvoice.findOne({ _id: req.params.id, business })
      .populate("client", "name clientCode email phone address")
      .populate("contract", "contractNumber description")
      .lean();
    if (!invoice) return next(createError(404, "Invoice not found"));
    res.status(200).json({ success: true, data: invoice, invoice });
  } catch (error) {
    next(error);
  }
};

export const createInvoice = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const payload  = sanitizeInvoicePayload(req.body);

    if (!payload.client) return next(createError(400, "Client is required"));
    if (!payload.dueDate || Number.isNaN(payload.dueDate.getTime())) {
      return next(createError(400, "Valid dueDate is required"));
    }
    if (payload.lineItems.length === 0) {
      return next(createError(400, "At least one line item is required"));
    }

    const clientExists = await Client.exists({ _id: payload.client, business });
    if (!clientExists) return next(createError(404, "Client not found"));

    const invoiceNumber = await nextInvoiceNumber(business);

    // No GL posting here — this creates a draft, and updateInvoice explicitly
    // allows edits while status is "draft" (line amounts, VAT, everything can
    // still change). Posting happens in sendInvoice(), the moment the invoice
    // becomes a real, binding claim and can no longer be edited — so posted
    // entries can never go stale from a subsequent draft edit.
    const invoice = await ClientInvoice.create({
      ...payload,
      invoiceNumber,
      business,
      createdBy: userId,
    });

    res.status(201).json({ success: true, data: invoice, invoice, message: "Invoice created" });
  } catch (error) {
    next(error);
  }
};

export const updateInvoice = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);

    const existing = await ClientInvoice.findOne({ _id: req.params.id, business });
    if (!existing) return next(createError(404, "Invoice not found"));

    if (existing.status !== "draft") {
      return next(createError(400, `Invoice cannot be edited in '${existing.status}' status. Only draft invoices can be updated.`));
    }

    const payload = sanitizeInvoicePayload(req.body);
    if (!payload.dueDate || Number.isNaN(payload.dueDate.getTime())) {
      return next(createError(400, "Valid dueDate is required"));
    }
    if (payload.lineItems.length === 0) {
      return next(createError(400, "At least one line item is required"));
    }

    // Apply changes and trigger pre-save hook by using .save()
    Object.assign(existing, payload);
    await existing.save();

    res.status(200).json({ success: true, data: existing, invoice: existing, message: "Invoice updated" });
  } catch (error) {
    next(error);
  }
};

const resolveClientCashbookAccount = async ({ businessId, cashbookAccountId }) => {
  if (!mongoose.Types.ObjectId.isValid(String(cashbookAccountId || ""))) return null;
  return ChartOfAccount.findOne({
    _id: cashbookAccountId,
    business: businessId,
    isPosting: { $ne: false },
    isHeader: { $ne: true },
    type: "asset",
  }).lean();
};

// Records one payment against an invoice as its own ClientPayment document
// (audit trail — see models/ClientPayment.js) and posts the matching GL entries,
// rather than overwriting a single paymentMethod/paymentReference field on the
// invoice each time, which silently lost every payment but the last.
export const recordPayment = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);

    const invoice = await ClientInvoice.findOne({
      _id: req.params.id,
      business,
      status: { $nin: ["paid", "cancelled", "draft"] },
    });
    if (!invoice) {
      return next(createError(404, "Invoice not found, is a draft (send it first), already paid, or is cancelled"));
    }

    const paymentAmount = round2(Number(req.body.amount ?? req.body.paidAmount));
    if (!paymentAmount || paymentAmount <= 0) {
      return next(createError(400, "Payment amount must be greater than zero"));
    }

    const remaining = round2(invoice.total - (invoice.paidAmount || 0));
    if (paymentAmount > remaining + 0.01) {
      return next(createError(400, `Payment amount (${paymentAmount}) exceeds the outstanding balance (${remaining})`));
    }

    const paymentMethod    = String(req.body.paymentMethod || "").trim();
    const paymentReference = String(req.body.paymentReference || "").trim();
    const paymentDate      = req.body.paymentDate ? new Date(req.body.paymentDate) : new Date();
    const notes            = String(req.body.notes || "").trim();

    const ALLOWED_METHODS = ["bank_transfer", "mobile_money", "cash", "check", "credit_card", "other"];
    if (!ALLOWED_METHODS.includes(paymentMethod)) {
      return next(createError(400, `paymentMethod must be one of: ${ALLOWED_METHODS.join(", ")}`));
    }

    const cashbookAccount = await resolveClientCashbookAccount({ businessId: business, cashbookAccountId: req.body.cashbookAccountId });
    if (!cashbookAccount?._id) {
      return next(createError(400, "A valid cashbook account is required to record this payment"));
    }

    const payment = await ClientPayment.create({
      business,
      client: invoice.client,
      invoice: invoice._id,
      amount: paymentAmount,
      paymentDate,
      paymentMethod,
      paymentReference,
      cashbookAccountId: cashbookAccount._id,
      cashbookAccountCode: cashbookAccount.code,
      notes,
      createdBy: userId,
    });

    try {
      const ledgerEntries = await postClientPaymentLedger({ payment, invoice, userId });
      payment.ledgerEntries = ledgerEntries.map((e) => e._id);
      await payment.save();
    } catch (glError) {
      await Promise.all([
        ClientPayment.deleteOne({ _id: payment._id }).catch(() => {}),
        FinancialLedgerEntry.deleteMany({
          sourceTransactionType: "client_payment",
          sourceTransactionId: String(payment._id),
        }).catch(() => {}),
      ]);
      throw glError;
    }

    const newPaidAmount = Math.min(invoice.total, round2((invoice.paidAmount || 0) + paymentAmount));
    invoice.paidAmount       = newPaidAmount;
    invoice.paidAt           = paymentDate;
    invoice.paymentMethod    = paymentMethod;
    invoice.paymentReference = paymentReference;
    invoice.status           = newPaidAmount >= invoice.total ? "paid" : "partial";
    await invoice.save();

    // Fire-and-forget receipt email — don't block the response
    Client.findOne({ _id: invoice.client, business }).lean()
      .then(async (cl) => {
        if (!cl?.email) return;
        const company = await Company.findById(business).lean();
        await sendReceiptEmail(invoice.toObject(), cl, company);
      })
      .catch((err) => console.error("[invoicesController] Receipt email error:", err.message));

    res.status(200).json({ success: true, data: { invoice, payment }, invoice, payment, message: "Payment recorded" });
  } catch (error) {
    next(error);
  }
};

// Payment history for one invoice — the audit trail markPaid's old single-field
// overwrite couldn't provide.
export const listPayments = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };
    if (req.params.id) filter.invoice = req.params.id;
    else if (req.query.clientId) filter.client = String(req.query.clientId).trim();
    else if (req.query.invoiceId) filter.invoice = String(req.query.invoiceId).trim();

    const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 200);
    const page  = Math.max(Number(req.query.page || 1), 1);
    const skip  = (page - 1) * limit;

    const [payments, total] = await Promise.all([
      ClientPayment.find(filter)
        .populate("cashbookAccountId", "code name")
        .sort({ paymentDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ClientPayment.countDocuments(filter),
    ]);

    const pagination = { page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) };
    res.status(200).json({ success: true, data: { payments, pagination }, payments, pagination });
  } catch (error) {
    next(error);
  }
};

// Reverses one payment: reverses its GL entries, marks it reversed, and rolls
// the invoice's cached paidAmount/status back — mirrors reverseStatement's
// shape (controllers/propertyController/processedStatements.js).
export const reversePayment = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const reason   = String(req.body?.reason || "Client payment reversed").trim();

    const payment = await ClientPayment.findOne({ _id: req.params.paymentId, business, invoice: req.params.id });
    if (!payment) return next(createError(404, "Payment not found"));
    if (payment.status === "reversed") return next(createError(400, "Payment is already reversed"));

    const invoice = await ClientInvoice.findOne({ _id: payment.invoice, business });
    if (!invoice) return next(createError(404, "Invoice not found"));

    if (payment.ledgerEntries?.length) {
      const originals = await FinancialLedgerEntry.find({
        _id: { $in: payment.ledgerEntries },
        status: { $ne: "reversed" },
      }).select("_id").lean();
      // Let a failed reversal throw and abort the whole operation — swallowing
      // it here would mark the payment "reversed" while its GL entries silently
      // stayed live, corrupting the books with no visible sign anything failed.
      await Promise.all(originals.map((entry) => postReversal({ entryId: entry._id, reason, userId })));
    }

    payment.status         = "reversed";
    payment.reversedBy     = userId;
    payment.reversedAt     = new Date();
    payment.reversalReason = reason;
    await payment.save();

    const newPaidAmount = Math.max(0, round2((invoice.paidAmount || 0) - payment.amount));
    invoice.paidAmount = newPaidAmount;
    invoice.status = newPaidAmount <= 0 ? "sent" : "partial";
    await invoice.save();

    res.status(200).json({ success: true, data: { invoice, payment }, invoice, payment, message: "Payment reversed" });
  } catch (error) {
    next(error);
  }
};

export const sendInvoice = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);

    const invoice = await ClientInvoice.findOne({
      _id: req.params.id,
      business,
      status: { $nin: ["cancelled"] },
    });
    if (!invoice) return next(createError(404, "Invoice not found or is cancelled"));

    const [client, company] = await Promise.all([
      Client.findOne({ _id: invoice.client, business }).lean(),
      Company.findById(business).lean(),
    ]);

    if (!client) return next(createError(404, "Client not found"));

    // GL posting happens here, on the draft → sent transition — this is the
    // moment the invoice becomes a real, binding claim against the client.
    // Required to succeed: unlike the email below (best-effort, logged either
    // way), a send that didn't reach the ledger must not be recorded as sent —
    // it stays in "draft" so it can be retried. postClientInvoiceLedger is
    // itself idempotent (guards on sourceTransactionId), so a resend of an
    // already-posted invoice is a safe no-op here.
    const wasDraft = invoice.status === "draft";
    if (wasDraft) {
      const ledgerEntries = await postClientInvoiceLedger({ invoice, userId });
      if (ledgerEntries.length) {
        invoice.ledgerEntries = ledgerEntries.map((e) => e._id);
      }
    }

    const emailResult = await sendInvoiceEmail(invoice.toObject(), client, company);

    const now = new Date();
    invoice.sentAt = now;
    if (wasDraft) invoice.status = "sent";
    await invoice.save();

    // Log the interaction
    await ClientInteraction.create({
      business,
      client:         invoice.client,
      type:           "email",
      subject:        `Invoice ${invoice.invoiceNumber} sent`,
      body:           emailResult.success
        ? `Invoice ${invoice.invoiceNumber} emailed to ${client.email}.`
        : `Invoice ${invoice.invoiceNumber} send attempted — ${emailResult.reason || "unknown error"}.`,
      relatedInvoice: invoice._id,
      emailStatus:    emailResult.success ? "sent" : "failed",
      createdBy:      userId,
    });

    res.status(200).json({
      success:     true,
      data:        invoice,
      invoice,
      emailResult,
      message:     emailResult.success ? "Invoice sent" : "Invoice marked as sent (email delivery issue noted)",
    });
  } catch (error) {
    next(error);
  }
};

export const cancelInvoice = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const reason   = String(req.body?.reason || "Client invoice cancelled").trim();

    const invoice = await ClientInvoice.findOne({ _id: req.params.id, business });
    if (!invoice) return next(createError(404, "Invoice not found"));

    if (["paid", "partial", "cancelled"].includes(invoice.status)) {
      return next(createError(
        400,
        invoice.status === "cancelled"
          ? "Invoice is already cancelled"
          : `Invoice has recorded payment activity (status '${invoice.status}') and cannot be cancelled directly. Reverse the payment(s) first.`
      ));
    }

    // Reverse any GL entries posted when this invoice was sent (a still-draft
    // invoice never posted anything, so this is a no-op for those). A failed
    // reversal throws and aborts the cancel — see reversePayment for why this
    // must not be swallowed.
    if (invoice.ledgerEntries?.length) {
      const originals = await FinancialLedgerEntry.find({
        _id: { $in: invoice.ledgerEntries },
        status: { $ne: "reversed" },
      }).select("_id").lean();
      await Promise.all(originals.map((entry) => postReversal({ entryId: entry._id, reason, userId })));
    }

    invoice.status = "cancelled";
    await invoice.save();

    res.status(200).json({ success: true, data: invoice, invoice, message: "Invoice cancelled" });
  } catch (error) {
    next(error);
  }
};
