// Client receipts (multi-invoice), unapplied credit, refunds, WHT
// certificates and M-Pesa matching. Business rules and GL live in
// services/clientReceiptService.js; this layer validates scope, audits and
// broadcasts.
import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import { logAuditEvent } from "../../../utils/auditLogger.js";
import { emitToCompany } from "../../../utils/socketManager.js";
import { round2 } from "../../../utils/math.js";
import MpesaCollection from "../../../models/MpesaCollection.js";
import Client from "../models/Client.js";
import ClientReceipt, { RECEIPT_METHODS } from "../models/ClientReceipt.js";
import ClientInteraction from "../models/ClientInteraction.js";
import Company from "../../../models/Company.js";
import { sendClientReceiptEmail } from "../services/clientEmailService.js";
import ClientCreditRefund from "../models/ClientCreditRefund.js";
import ClientWhtCertificate, { WHT_CERT_STATUSES, WHT_CERT_TYPES } from "../models/ClientWhtCertificate.js";
import { resolveActiveBusinessId, currentUserId, escapeRegex } from "../services/businessScope.js";
import {
  createClientReceipt,
  suggestAllocations,
  applyClientCredit,
  reverseCreditApplication,
  refundClientCredit,
  reverseClientCreditRefund,
  reverseClientReceipt,
} from "../services/clientReceiptService.js";
import { matchMpesaCollectionToClient, resolveClientFromReference } from "../services/clientMpesaMatchService.js";

const isId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const paging = (query) => {
  const limit = Math.min(Math.max(Number(query.limit || 25), 1), 200);
  const page = Math.max(Number(query.page || 1), 1);
  return { limit, page, skip: (page - 1) * limit };
};
const pageInfo = (page, limit, total) => ({ page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) });

// Cash + WHT: the amount of debt the receipt settles.
const withSettlementTotal = (r) => ({ ...r, settlementTotal: round2(Number(r.amount || 0) + Number(r.whtIncomeTax?.amount || 0) + Number(r.whtVat?.amount || 0)) });

const audit = (req, business, action, target, message, metadata = {}, severity = "important") =>
  logAuditEvent({ req, company: business, action, category: "finance", severity, targetType: target?.type || "ClientReceipt", targetId: target?.id, targetName: target?.name || "", message, metadata });

// ─── Receipts ────────────────────────────────────────────────────────────────

export const listReceipts = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };
    if (isId(req.query.clientId)) filter.client = req.query.clientId;
    // Reversed receipts are audit-trail noise in the default list.
    if (req.query.status === "reversed" || req.query.status === "posted") filter.status = req.query.status;
    else if (req.query.includeReversed !== "true") filter.status = "posted";
    if (RECEIPT_METHODS.includes(req.query.method)) filter.method = req.query.method;
    if (req.query.unappliedOnly === "true") filter.unappliedAmount = { $gt: 0 };
    if (req.query.dateFrom || req.query.dateTo) {
      filter.receiptDate = {};
      if (req.query.dateFrom) filter.receiptDate.$gte = new Date(req.query.dateFrom);
      if (req.query.dateTo) filter.receiptDate.$lte = new Date(`${String(req.query.dateTo).slice(0, 10)}T23:59:59.999`);
    }
    if (req.query.search) {
      const pattern = new RegExp(escapeRegex(String(req.query.search).trim()), "i");
      filter.$or = [{ receiptNumber: pattern }, { reference: pattern }, { "allocations.invoiceNumber": pattern }];
    }
    const { limit, page, skip } = paging(req.query);
    const [rows, total, totals] = await Promise.all([
      ClientReceipt.find(filter)
        .select("-ledgerEntries -allocations.ledgerEntries")
        .populate("client", "name clientCode")
        .populate("cashbookAccountId", "code name")
        .sort({ receiptDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ClientReceipt.countDocuments(filter),
      ClientReceipt.aggregate([
        { $match: { ...filter, business: new mongoose.Types.ObjectId(String(business)), ...(filter.client ? { client: new mongoose.Types.ObjectId(String(filter.client)) } : {}) } },
        { $group: { _id: null, amount: { $sum: "$amount" }, whtIncomeTax: { $sum: "$whtIncomeTax.amount" }, whtVat: { $sum: "$whtVat.amount" }, unapplied: { $sum: "$unappliedAmount" } } },
      ]),
    ]);
    const receipts = rows.map(withSettlementTotal);
    const sum = totals[0] || { amount: 0, whtIncomeTax: 0, whtVat: 0, unapplied: 0 };
    const pagination = pageInfo(page, limit, total);
    res.status(200).json({
      success: true,
      data: { receipts, pagination, totals: { amount: round2(sum.amount), whtIncomeTax: round2(sum.whtIncomeTax), whtVat: round2(sum.whtVat), unapplied: round2(sum.unapplied) } },
      receipts,
      pagination,
    });
  } catch (error) {
    next(error);
  }
};

// Emails the receipt to the client's address and logs it on the client timeline (which is also what
// drives the "Email" sent tag on lists)
export const emailReceipt = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const [receipt, company] = await Promise.all([
      ClientReceipt.findOne({ _id: req.params.id, business })
        .select("-ledgerEntries")
        .populate("client", "name email")
        .populate("allocations.invoice", "invoiceNumber")
        .lean(),
      Company.findById(business).lean(),
    ]);
    if (!receipt) return next(createError(404, "Receipt not found"));
    if (receipt.status === "reversed") return next(createError(400, "A reversed receipt cannot be emailed"));

    const result = await sendClientReceiptEmail(receipt, receipt.client, company);
    await ClientInteraction.create({
      business,
      client: receipt.client?._id,
      type: "email",
      subject: `Receipt ${receipt.receiptNumber} sent`,
      body: result.success ? `Receipt ${receipt.receiptNumber} emailed to ${receipt.client?.email}.` : `Receipt email failed: ${result.reason}`,
      emailStatus: result.success ? "sent" : "failed",
      createdBy: currentUserId(req),
    });
    if (!result.success) {
      const reasons = {
        client_email_missing: "This client has no email address.",
        smtp_not_configured: "Email is not set up for this company.",
        email_globally_disabled: "Email sending is disabled.",
      };
      return next(createError(400, reasons[result.reason] || `Email could not be sent: ${result.reason}`));
    }
    res.status(200).json({ success: true, message: `Receipt emailed to ${receipt.client?.email}` });
  } catch (error) {
    next(error);
  }
};

export const getReceipt = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const receipt = await ClientReceipt.findOne({ _id: req.params.id, business })
      .populate("client", "name clientCode email phone taxPin")
      .populate("cashbookAccountId", "code name")
      .lean();
    if (!receipt) return next(createError(404, "Receipt not found"));
    const [refunds, certificates] = await Promise.all([
      ClientCreditRefund.find({ business, receipt: receipt._id }).select("-ledgerEntries").sort({ refundDate: -1 }).lean(),
      ClientWhtCertificate.find({ business, receipt: receipt._id }).lean(),
    ]);
    Object.assign(receipt, withSettlementTotal(receipt));
    res.status(200).json({ success: true, data: { receipt, refunds, certificates }, receipt, refunds, certificates });
  } catch (error) {
    next(error);
  }
};

// Open invoices oldest-first with suggested amounts (cash + expected WHT).
export const getAllocationSuggestions = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    if (!isId(req.query.clientId)) return next(createError(400, "clientId is required"));
    const data = await suggestAllocations({ business, clientId: req.query.clientId, amount: req.query.amount ?? null });
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const createReceipt = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const receipt = await createClientReceipt({ business, userId, input: req.body || {}, source: "manual" });
    audit(req, business, "client.receipt.created", { id: receipt._id, name: receipt.receiptNumber }, `Client receipt ${receipt.receiptNumber} of ${receipt.amount} posted`, {
      client: String(receipt.client),
      amount: receipt.amount,
      whtIncomeTax: receipt.whtIncomeTax?.amount || 0,
      whtVat: receipt.whtVat?.amount || 0,
      unapplied: receipt.unappliedAmount,
      allocations: receipt.allocations.map((a) => ({ invoice: a.invoiceNumber, amount: a.amount })),
    });
    emitToCompany(business, "clientReceipt:created", { _id: receipt._id, client: receipt.client, receiptNumber: receipt.receiptNumber });
    res.status(201).json({ success: true, data: receipt, receipt, message: `Receipt ${receipt.receiptNumber} posted` });
  } catch (error) {
    next(error);
  }
};

// Applies the client's unapplied credit to invoices (FIFO across receipts,
// or only the receipt in the URL).
export const applyCredit = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    let clientId = req.body?.clientId;
    const receiptId = req.params.id || (isId(req.body?.receiptId) ? req.body.receiptId : null);
    if (req.params.id) {
      const receipt = await ClientReceipt.findOne({ _id: req.params.id, business }).select("client").lean();
      if (!receipt) return next(createError(404, "Receipt not found"));
      clientId = receipt.client;
    }
    if (!isId(clientId)) return next(createError(400, "clientId is required"));
    const result = await applyClientCredit({ business, userId, clientId: String(clientId), receiptId, allocations: req.body?.allocations, date: req.body?.date });
    audit(req, business, "client.receipt.credit_applied", { id: receiptId || clientId, name: result.receipts.map((r) => r.receiptNumber).join(", ") }, `Client credit of ${result.applied} applied to invoices`, {
      client: String(clientId),
      allocations: req.body?.allocations,
    });
    emitToCompany(business, "clientReceipt:updated", { client: clientId });
    res.status(200).json({ success: true, data: result, message: `Applied ${result.applied} of credit` });
  } catch (error) {
    next(error);
  }
};

export const reverseAllocation = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const receipt = await reverseCreditApplication({ business, userId, receiptId: req.params.id, allocationId: req.params.allocationId, reason: String(req.body?.reason || "").trim() });
    audit(req, business, "client.receipt.credit_application_reversed", { id: receipt._id, name: receipt.receiptNumber }, `Credit application on ${receipt.receiptNumber} reversed`, { allocationId: req.params.allocationId, reason: req.body?.reason || "" });
    emitToCompany(business, "clientReceipt:updated", { _id: receipt._id });
    res.status(200).json({ success: true, data: receipt, receipt, message: "Credit application reversed" });
  } catch (error) {
    next(error);
  }
};

export const reverseReceipt = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const receipt = await reverseClientReceipt({ business, userId, receiptId: req.params.id, reason: req.body?.reason });
    audit(req, business, "client.receipt.reversed", { id: receipt._id, name: receipt.receiptNumber }, `Client receipt ${receipt.receiptNumber} reversed: ${receipt.reversalReason}`, { amount: receipt.amount }, "critical");
    emitToCompany(business, "clientReceipt:reversed", { _id: receipt._id });
    res.status(200).json({ success: true, data: receipt, receipt, message: "Receipt reversed" });
  } catch (error) {
    next(error);
  }
};

// Cheques: "cleared" just records it; "bounced" reverses the receipt (the
// money never arrived) and re-opens the invoices.
export const updateChequeStatus = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const status = String(req.body?.status || "");
    if (!["cleared", "bounced"].includes(status)) return next(createError(400, "status must be cleared or bounced"));
    const receipt = await ClientReceipt.findOne({ _id: req.params.id, business }).lean();
    if (!receipt) return next(createError(404, "Receipt not found"));
    if (receipt.method !== "cheque") return next(createError(400, "Not a cheque receipt"));
    if (receipt.status !== "posted") return next(createError(400, "Receipt is already reversed"));

    let updated;
    if (status === "bounced") {
      const reason = `Cheque ${receipt.chequeNumber} bounced${req.body?.reason ? `: ${String(req.body.reason).trim()}` : ""}`;
      updated = await reverseClientReceipt({ business, userId, receiptId: receipt._id, reason });
      await ClientReceipt.updateOne({ _id: receipt._id }, { $set: { chequeStatus: "bounced" } });
      updated.chequeStatus = "bounced";
    } else {
      const clearedOn = req.body?.date ? new Date(req.body.date) : new Date();
      if (Number.isNaN(clearedOn.getTime())) return next(createError(400, "Invalid clearing date"));
      updated = await ClientReceipt.findOneAndUpdate({ _id: receipt._id, business }, { $set: { chequeStatus: "cleared", chequeClearingDate: clearedOn } }, { new: true }).lean();
    }
    audit(req, business, `client.receipt.cheque_${status}`, { id: receipt._id, name: receipt.receiptNumber }, `Cheque ${receipt.chequeNumber} on ${receipt.receiptNumber} marked ${status}`, {}, status === "bounced" ? "critical" : "important");
    emitToCompany(business, "clientReceipt:updated", { _id: receipt._id });
    res.status(200).json({ success: true, data: updated, receipt: updated, message: `Cheque marked ${status}` });
  } catch (error) {
    next(error);
  }
};

// ─── Refunds ─────────────────────────────────────────────────────────────────

export const refundCredit = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const refund = await refundClientCredit({ business, userId, receiptId: req.params.id, input: req.body || {} });
    audit(req, business, "client.credit.refunded", { type: "ClientCreditRefund", id: refund._id, name: refund.refundNumber }, `Refund ${refund.refundNumber} of ${refund.amount} paid from client credit`, { receipt: String(refund.receipt), client: String(refund.client) }, "critical");
    emitToCompany(business, "clientReceipt:updated", { _id: refund.receipt });
    res.status(201).json({ success: true, data: refund, refund, message: `Refund ${refund.refundNumber} posted` });
  } catch (error) {
    next(error);
  }
};

export const listRefunds = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };
    if (isId(req.query.clientId)) filter.client = req.query.clientId;
    if (isId(req.query.receiptId)) filter.receipt = req.query.receiptId;
    if (req.query.includeReversed !== "true") filter.status = "posted";
    const { limit, page, skip } = paging(req.query);
    const [refunds, total] = await Promise.all([
      ClientCreditRefund.find(filter).select("-ledgerEntries").populate("client", "name clientCode").populate("cashbookAccountId", "code name").sort({ refundDate: -1 }).skip(skip).limit(limit).lean(),
      ClientCreditRefund.countDocuments(filter),
    ]);
    res.status(200).json({ success: true, data: { refunds, pagination: pageInfo(page, limit, total) }, refunds });
  } catch (error) {
    next(error);
  }
};

export const reverseRefund = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const refund = await reverseClientCreditRefund({ business, userId, refundId: req.params.refundId, reason: String(req.body?.reason || "").trim() });
    audit(req, business, "client.credit.refund_reversed", { type: "ClientCreditRefund", id: refund._id, name: refund.refundNumber }, `Refund ${refund.refundNumber} reversed`, { reason: refund.reversalReason }, "critical");
    emitToCompany(business, "clientReceipt:updated", { _id: refund.receipt });
    res.status(200).json({ success: true, data: refund, refund, message: "Refund reversed" });
  } catch (error) {
    next(error);
  }
};

// ─── WHT certificates ────────────────────────────────────────────────────────

export const listWhtCertificates = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };
    if (isId(req.query.clientId)) filter.client = req.query.clientId;
    if (WHT_CERT_STATUSES.includes(req.query.status)) filter.status = req.query.status;
    else if (req.query.status !== "all") filter.status = { $ne: "cancelled" };
    if (WHT_CERT_TYPES.includes(req.query.type)) filter.type = req.query.type;
    const { limit, page, skip } = paging(req.query);
    const [certificates, total] = await Promise.all([
      ClientWhtCertificate.find(filter).populate("client", "name clientCode taxPin").sort({ status: 1, withheldDate: 1 }).skip(skip).limit(limit).lean(),
      ClientWhtCertificate.countDocuments(filter),
    ]);
    res.status(200).json({ success: true, data: { certificates, pagination: pageInfo(page, limit, total) }, certificates });
  } catch (error) {
    next(error);
  }
};

// Record the certificate when it arrives (number, date, scanned file).
export const updateWhtCertificate = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const certificateNo = String(req.body?.certificateNo || "").trim();
    if (!certificateNo) return next(createError(400, "Certificate number is required"));
    const certificateDate = req.body?.certificateDate ? new Date(req.body.certificateDate) : null;
    if (certificateDate && Number.isNaN(certificateDate.getTime())) return next(createError(400, "Invalid certificate date"));

    const certificate = await ClientWhtCertificate.findOneAndUpdate(
      { _id: req.params.certId, business, status: { $ne: "cancelled" } },
      { $set: { certificateNo, certificateDate, fileUrl: String(req.body?.fileUrl || "").trim(), notes: String(req.body?.notes || "").trim(), status: "received", receivedAt: new Date(), receivedBy: userId } },
      { new: true }
    ).lean();
    if (!certificate) return next(createError(404, "Certificate not found or cancelled"));
    // Keep the receipt's copy of the certificate number in step for printing.
    await ClientReceipt.updateOne({ _id: certificate.receipt, business }, { $set: { [certificate.type === "vat" ? "whtVat.certificateNo" : "whtIncomeTax.certificateNo"]: certificateNo } });
    audit(req, business, "client.wht_certificate.received", { type: "ClientWhtCertificate", id: certificate._id, name: certificateNo }, `WHT certificate ${certificateNo} (${certificate.type}) recorded for ${certificate.receiptNumber}`, { amount: certificate.amount });
    res.status(200).json({ success: true, data: certificate, certificate, message: "Certificate recorded" });
  } catch (error) {
    next(error);
  }
};

// ─── M-Pesa matching ─────────────────────────────────────────────────────────

// Unmatched paybill payments with a suggested client where the account
// reference resolves (one lookup per distinct reference, not per row).
export const listUnmatchedMpesa = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { limit, page, skip } = paging(req.query);
    const filter = { business, matchingStatus: "unmatched", tenant: null };
    const [rows, total] = await Promise.all([
      MpesaCollection.find(filter).select("transactionCode transactionDate amount accountReference billRefNumber msisdn payerName shortCode metadata.clientMatchSkipReason").sort({ transactionDate: -1 }).skip(skip).limit(limit).lean(),
      MpesaCollection.countDocuments(filter),
    ]);
    const references = [...new Set(rows.map((r) => r.accountReference || r.billRefNumber).filter(Boolean))];
    const resolved = new Map(await Promise.all(references.map(async (ref) => [ref, await resolveClientFromReference({ business, reference: ref })])));
    const clientIds = [...new Set([...resolved.values()].filter(Boolean).map((r) => r.clientId))];
    const clients = new Map((await Client.find({ _id: { $in: clientIds }, business }).select("name clientCode").lean()).map((c) => [String(c._id), c]));
    const collections = rows.map((row) => {
      const match = resolved.get(row.accountReference || row.billRefNumber);
      return { ...row, suggestedClient: match ? { ...clients.get(match.clientId), matchedBy: match.matchedBy, invoiceId: match.invoiceId } : null };
    });
    res.status(200).json({ success: true, data: { collections, pagination: pageInfo(page, limit, total) }, collections });
  } catch (error) {
    next(error);
  }
};

export const matchMpesaCollection = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const clientId = isId(req.body?.clientId) ? req.body.clientId : null;
    if (clientId && !(await Client.exists({ _id: clientId, business }))) return next(createError(404, "Client not found"));
    const result = await matchMpesaCollectionToClient({
      business,
      collectionId: req.params.collectionId,
      clientId,
      invoiceId: isId(req.body?.invoiceId) ? req.body.invoiceId : null,
      cashbookAccountId: isId(req.body?.cashbookAccountId) ? req.body.cashbookAccountId : null,
      userId,
      source: "mpesa_manual",
      sendSms: req.body?.sendSms !== false,
    });
    if (!result.matched) return next(createError(400, result.reason || "Could not match this payment to a client"));
    if (!result.alreadyMatched) {
      audit(req, business, "client.receipt.mpesa_matched", { id: result.receipt._id, name: result.receipt.receiptNumber }, `M-Pesa ${result.receipt.reference} matched to client receipt ${result.receipt.receiptNumber}`, { collection: req.params.collectionId, matchedBy: result.matchedBy });
      emitToCompany(business, "clientReceipt:created", { _id: result.receipt._id, client: result.receipt.client, receiptNumber: result.receipt.receiptNumber });
    }
    res.status(200).json({ success: true, data: result, message: result.alreadyMatched ? "Already matched" : `Receipt ${result.receipt.receiptNumber} created` });
  } catch (error) {
    next(error);
  }
};
