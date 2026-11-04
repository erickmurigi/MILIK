import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import { round2 } from "../../../utils/math.js";
import { logAuditEvent } from "../../../utils/auditLogger.js";
import { emitToCompany } from "../../../utils/socketManager.js";
import ClientInvoice, { CLIENT_INVOICE_STATUSES, CLIENT_INVOICE_OPEN_STATUSES } from "../models/ClientInvoice.js";
import ClientInteraction from "../models/ClientInteraction.js";
import ClientPayment from "../models/ClientPayment.js";
import ClientContract from "../models/ClientContract.js";
import ClientCreditNote from "../models/ClientCreditNote.js";
import ClientRevenueSchedule from "../models/ClientRevenueSchedule.js";
import ClientReceipt from "../models/ClientReceipt.js";
import Client from "../models/Client.js";
import Company from "../../../models/Company.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import { resolveActiveBusinessId, currentUserId, escapeRegex } from "../services/businessScope.js";
import { nextInvoiceNumberForSeries } from "../services/clientSequenceService.js";
import { sendInvoiceEmail, sendReceiptEmail } from "../services/clientEmailService.js";
import { postClientPaymentLedger, reverseClientLedgerEntries } from "../services/clientAccountingService.js";
import { postReversal } from "../../../services/ledgerPostingService.js";
import { claimPaymentReference, releasePaymentReference } from "../../../services/paymentReferenceGuard.js";
import { getClientTaxContext } from "../services/clientTaxService.js";
import { buildInvoiceLines, postClientInvoice } from "../services/clientInvoicePostingService.js";
import { getClientBillingSettings } from "../services/clientContractService.js";
import { computeClientInvoiceOutstanding } from "../services/clientInvoiceBalanceService.js";
import { releaseScheduleRowsForInvoice } from "../services/clientScheduleService.js";
import { cancelRevenueSchedulesForInvoice } from "../services/clientRevenueService.js";
import { TAX_MODES } from "../services/clientLineMath.js";


// ─── Sanitizers ──────────────────────────────────────────────────────────────

const ALLOWED_STATUSES = CLIENT_INVOICE_STATUSES;

const sanitizeInvoicePayload = (body = {}) => ({
  client:           String(body.client || "").trim(),
  contract:         String(body.contract || "").trim() || null,
  issueDate:        body.issueDate ? new Date(body.issueDate) : new Date(),
  dueDate:          body.dueDate   ? new Date(body.dueDate)   : null,
  periodStart:      body.periodStart ? new Date(body.periodStart) : null,
  periodEnd:        body.periodEnd   ? new Date(body.periodEnd)   : null,
  vatRate:          Math.min(100, Math.max(0, Number(body.vatRate ?? 16))),
  taxMode:          TAX_MODES.includes(body.taxMode) ? body.taxMode : "exclusive",
  poNumber:         String(body.poNumber || "").trim(),
  currency:         String(body.currency || "KES").trim().toUpperCase() || "KES",
  notes:            String(body.notes || "").trim(),
});

// Validates the payload and builds the per-line-taxed line items shared by create and update.
const prepareInvoice = async ({ business, body }) => {
  const payload = sanitizeInvoicePayload(body);
  if (!payload.client) throw createError(400, "Client is required");
  if (!payload.dueDate || Number.isNaN(payload.dueDate.getTime())) throw createError(400, "Valid dueDate is required");
  if (Number.isNaN(payload.issueDate.getTime())) throw createError(400, "Invalid issueDate");

  const [clientExists, contract, taxCtx, settings] = await Promise.all([
    Client.exists({ _id: payload.client, business }),
    payload.contract && mongoose.Types.ObjectId.isValid(payload.contract)
      ? ClientContract.findOne({ _id: payload.contract, business }).select("_id client version currency").lean()
      : Promise.resolve(null),
    getClientTaxContext(business),
    getClientBillingSettings(business),
  ]);
  if (!clientExists) throw createError(404, "Client not found");
  if (payload.contract && (!contract || String(contract.client) !== String(payload.client))) {
    throw createError(400, "Contract not found for this client");
  }

  const lineItems = await buildInvoiceLines({ business, items: body.lineItems, taxCtx, legacyVatRate: body.vatRate });
  if (!lineItems.length) throw createError(400, "At least one line item is required");

  return {
    ...payload,
    contractVersion: contract?.version || null,
    lineItems,
    taxCalculation: "line",
    terms: body.terms !== undefined ? String(body.terms || "").trim() : settings.invoiceTerms || "",
    settings,
  };
};

const withOutstanding = (invoice) => ({ ...invoice, outstanding: computeClientInvoiceOutstanding(invoice) });

const auditInvoice = (req, invoice, action, message, metadata = {}) =>
  logAuditEvent({
    req,
    company: invoice.business,
    action: `client_invoice.${action}`,
    category: "finance",
    targetType: "ClientInvoice",
    targetId: invoice._id,
    targetName: invoice.invoiceNumber,
    message,
    metadata,
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
    // Overdue is derived (due date passed, still owing), not only the cron-set status.
    if (req.query.overdue === "true") {
      filter.status = { $in: CLIENT_INVOICE_OPEN_STATUSES };
      filter.dueDate = { $lt: new Date() };
    }
    if (req.query.search) {
      const s = escapeRegex(String(req.query.search).trim());
      filter.$or = [{ invoiceNumber: new RegExp(s, "i") }, { poNumber: new RegExp(s, "i") }];
    }
    if (req.query.dateFrom || req.query.dateTo) {
      filter.issueDate = {};
      if (req.query.dateFrom) filter.issueDate.$gte = new Date(req.query.dateFrom);
      if (req.query.dateTo)   filter.issueDate.$lte = new Date(req.query.dateTo);
    }

    const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 200);
    const page  = Math.max(Number(req.query.page || 1), 1);
    const skip  = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      ClientInvoice.find(filter)
        .populate("client", "name clientCode email phone")
        .sort({ issueDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ClientInvoice.countDocuments(filter),
    ]);
    const now = new Date();
    const invoices = rows.map((inv) => {
      const outstanding = computeClientInvoiceOutstanding(inv);
      return { ...inv, outstanding, isOverdue: CLIENT_INVOICE_OPEN_STATUSES.includes(inv.status) && outstanding > 0.005 && inv.dueDate && new Date(inv.dueDate) < now };
    });

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
      .populate("client", "name clientCode email phone address taxPin")
      .populate("contract", "contractNumber description")
      .lean();
    if (!invoice) return next(createError(404, "Invoice not found"));
    const [notes, revenueSchedules] = await Promise.all([
      ClientCreditNote.find({ business, invoice: invoice._id }).sort({ noteDate: 1 }).lean(),
      ClientRevenueSchedule.find({ business, invoice: invoice._id }).lean(),
    ]);
    const data = { ...invoice, outstanding: computeClientInvoiceOutstanding(invoice, notes), notes, revenueSchedules };
    res.status(200).json({ success: true, data, invoice: data });
  } catch (error) {
    next(error);
  }
};

export const createInvoice = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const { settings, ...payload } = await prepareInvoice({ business, body: req.body || {} });

    const series = String(req.body?.series || settings.invoicePrefix || "CINV").trim().toUpperCase();
    const invoiceNumber = await nextInvoiceNumberForSeries(business, series);

    // No GL posting here — this creates a draft, and updateInvoice explicitly
    // allows edits while status is "draft" (line amounts, VAT, everything can
    // still change). Posting happens in postInvoice()/sendInvoice(), the moment
    // the invoice becomes a real, binding claim and can no longer be edited — so
    // posted entries can never go stale from a subsequent draft edit.
    const invoice = await ClientInvoice.create({
      ...payload,
      invoiceNumber,
      series,
      business,
      createdBy: userId,
    });

    await auditInvoice(req, invoice, "created", `Draft invoice ${invoiceNumber} created (${invoice.total})`);
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
      return next(createError(400, `Invoice cannot be edited in '${existing.status}' status. Only draft invoices can be updated — use a credit or debit note.`));
    }

    const { settings, ...payload } = await prepareInvoice({ business, body: req.body || {} });

    // Apply changes and trigger pre-save hook by using .save()
    Object.assign(existing, payload);
    await existing.save();

    await auditInvoice(req, existing, "updated", `Draft invoice ${existing.invoiceNumber} updated (${existing.total})`);
    res.status(200).json({ success: true, data: existing, invoice: existing, message: "Invoice updated" });
  } catch (error) {
    next(error);
  }
};

// Posts a draft to the ledger without emailing it (billing-run drafts, invoices sent by hand).
export const postInvoice = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const invoice = await ClientInvoice.findOne({ _id: req.params.id, business });
    if (!invoice) return next(createError(404, "Invoice not found"));
    if (invoice.status !== "draft") return next(createError(400, `Invoice is already ${invoice.status}`));

    await postClientInvoice({ invoice, userId, targetStatus: "posted" });
    await auditInvoice(req, invoice, "posted", `Invoice ${invoice.invoiceNumber} posted to the ledger (${invoice.total})`, { journalGroupId: invoice.journalGroupId });
    emitToCompany(String(business), "clients:invoice:updated", { invoiceId: String(invoice._id), status: invoice.status });
    res.status(200).json({ success: true, data: invoice, invoice, message: "Invoice posted" });
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
      await claimPaymentReference({ business, reference: paymentReference, sourceModel: "ClientPayment", sourceId: payment._id });
    } catch (refErr) {
      await ClientPayment.deleteOne({ _id: payment._id }).catch(() => {});
      return next(refErr);
    }

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
        releasePaymentReference({ business, reference: paymentReference, sourceModel: "ClientPayment", sourceId: payment._id }).catch(() => {}),
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
    await releasePaymentReference({ business, reference: payment.paymentReference, sourceModel: "ClientPayment", sourceId: payment._id }).catch(() => {});

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
    // it stays in "draft" so it can be retried. postClientInvoice commits the
    // journal and the status change in one transaction, and a resend of an
    // already-posted invoice never posts again.
    const wasDraft = invoice.status === "draft";
    if (wasDraft) {
      await postClientInvoice({ invoice, userId, targetStatus: "sent" });
    }

    const emailResult = await sendInvoiceEmail(invoice.toObject(), client, company);

    invoice.sentAt = new Date();
    if (invoice.status === "posted") invoice.status = "sent";
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

    await auditInvoice(req, invoice, wasDraft ? "posted_and_sent" : "sent", `Invoice ${invoice.invoiceNumber} ${wasDraft ? "posted and " : ""}sent`, { emailDelivered: Boolean(emailResult.success) });
    emitToCompany(String(business), "clients:invoice:updated", { invoiceId: String(invoice._id), status: invoice.status });
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

    if (["paid", "partial", "partially_paid", "cancelled", "credited"].includes(invoice.status) || Number(invoice.paidAmount || 0) > 0) {
      return next(createError(
        400,
        invoice.status === "cancelled"
          ? "Invoice is already cancelled"
          : `Invoice has recorded payment or credit activity (status '${invoice.status}') and cannot be cancelled directly. Reverse the payment(s) or use a credit note.`
      ));
    }
    if (await ClientReceipt.exists({ business, "allocations.invoice": invoice._id, "allocations.status": "active", status: "posted" })) {
      return next(createError(400, "Receipts are allocated to this invoice — reverse or reallocate them before cancelling"));
    }
    if (await ClientCreditNote.exists({ business, invoice: invoice._id, status: "posted" })) {
      return next(createError(400, "This invoice has credit/debit notes — reverse them first, or credit the remaining balance instead of cancelling"));
    }
    // Refuses if any deferred revenue was already recognised (credit note territory).
    await cancelRevenueSchedulesForInvoice({ business, invoiceId: invoice._id });

    // Reverse any GL entries posted when this invoice was posted/sent (a still-draft
    // invoice never posted anything, so this is a no-op for those). A failed
    // reversal throws and aborts the cancel — see reversePayment for why this
    // must not be swallowed.
    if (invoice.ledgerEntries?.length) {
      await reverseClientLedgerEntries({ business, entryIds: invoice.ledgerEntries, reason, userId });
    }

    invoice.status = "cancelled";
    invoice.cancelledAt = new Date();
    invoice.cancelledBy = userId;
    invoice.cancellationReason = reason;
    await invoice.save();

    // Contract periods this invoice billed become billable again.
    const released = await releaseScheduleRowsForInvoice(invoice._id);

    await auditInvoice(req, invoice, "cancelled", `Invoice ${invoice.invoiceNumber} cancelled: ${reason}`, { releasedSchedulePeriods: released.modifiedCount });
    emitToCompany(String(business), "clients:invoice:updated", { invoiceId: String(invoice._id), status: invoice.status });
    res.status(200).json({ success: true, data: invoice, invoice, message: "Invoice cancelled" });
  } catch (error) {
    next(error);
  }
};
