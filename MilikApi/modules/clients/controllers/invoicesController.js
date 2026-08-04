import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import ClientInvoice from "../models/ClientInvoice.js";
import ClientInteraction from "../models/ClientInteraction.js";
import Client from "../models/Client.js";
import Company from "../../../models/Company.js";
import { resolveActiveBusinessId, currentUserId, escapeRegex } from "../services/businessScope.js";
import { nextInvoiceNumber } from "../services/clientSequenceService.js";
import { sendInvoiceEmail, sendReceiptEmail } from "../services/clientEmailService.js";

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

export const markPaid = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);

    const invoice = await ClientInvoice.findOne({
      _id: req.params.id,
      business,
      status: { $nin: ["paid", "cancelled"] },
    });
    if (!invoice) return next(createError(404, "Invoice not found, already paid, or is cancelled"));

    const paymentAmount = Number(req.body.paidAmount);
    if (!paymentAmount || paymentAmount <= 0) {
      return next(createError(400, "Payment amount must be greater than zero"));
    }

    const paidAt           = req.body.paidAt ? new Date(req.body.paidAt) : new Date();
    const paymentMethod    = String(req.body.paymentMethod    || "").trim();
    const paymentReference = String(req.body.paymentReference || "").trim();

    // Accumulate — cap at invoice total so overpayment doesn't inflate paidAmount
    const newPaidAmount = Math.min(invoice.total, (invoice.paidAmount || 0) + paymentAmount);

    invoice.paidAmount       = newPaidAmount;
    invoice.paidAt           = paidAt;
    invoice.paymentMethod    = paymentMethod;
    invoice.paymentReference = paymentReference;

    if (newPaidAmount >= invoice.total) {
      invoice.status = "paid";
    } else if (newPaidAmount > 0) {
      invoice.status = "partial";
    }

    await invoice.save();

    // Fire-and-forget receipt email — don't block the response
    Client.findOne({ _id: invoice.client, business }).lean()
      .then(async (cl) => {
        if (!cl?.email) return;
        const company = await Company.findById(business).lean();
        await sendReceiptEmail(invoice.toObject(), cl, company);
      })
      .catch((err) => console.error("[invoicesController] Receipt email error:", err.message));

    res.status(200).json({ success: true, data: invoice, invoice, message: "Payment recorded" });
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

    const emailResult = await sendInvoiceEmail(invoice.toObject(), client, company);

    const now = new Date();
    invoice.sentAt = now;
    if (invoice.status === "draft") invoice.status = "sent";
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

    const invoice = await ClientInvoice.findOneAndUpdate(
      { _id: req.params.id, business, status: { $nin: ["paid", "cancelled"] } },
      { status: "cancelled" },
      { new: true }
    );

    if (!invoice) {
      const existing = await ClientInvoice.findOne({ _id: req.params.id, business }).lean();
      if (!existing) return next(createError(404, "Invoice not found"));
      return next(createError(400, `Invoice cannot be cancelled in '${existing.status}' status`));
    }

    res.status(200).json({ success: true, data: invoice, invoice, message: "Invoice cancelled" });
  } catch (error) {
    next(error);
  }
};
