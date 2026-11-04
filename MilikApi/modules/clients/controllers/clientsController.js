import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import { logAuditEvent } from "../../../utils/auditLogger.js";
import { emitToCompany } from "../../../utils/socketManager.js";
import { round2 } from "../../../utils/math.js";
import Client, { CLIENT_TYPES, CLIENT_STATUSES, INVOICE_RECIPIENT_MODES } from "../models/Client.js";
import ClientContract from "../models/ClientContract.js";
import ClientInvoice from "../models/ClientInvoice.js";
import ClientInteraction from "../models/ClientInteraction.js";
import ClientPayment from "../models/ClientPayment.js";
import ClientReceipt from "../models/ClientReceipt.js";
import ClientWhtCertificate from "../models/ClientWhtCertificate.js";
import { resolveActiveBusinessId, currentUserId, escapeRegex } from "../services/businessScope.js";
import { nextClientCode } from "../services/clientSequenceService.js";
import { sendAdHocSms } from "../../../services/communicationService.js";
import { validateKraPin, normalizeClientPhone, isPlaceholder, findDuplicateClients } from "../services/clientValidation.js";
import { buildClientStatement, contractMrr } from "../services/clientReportsService.js";
import { getOpenBalancesByClient, assertClientCreditOk } from "../services/clientCreditControlService.js";
import { getClientUnappliedCredit } from "../services/clientReceiptService.js";

// ─── Sanitizers ──────────────────────────────────────────────────────────────

const ALLOWED_CATEGORIES = ["enterprise", "sme", "individual"];
const ALLOWED_STATUSES   = CLIENT_STATUSES;
const ALLOWED_SOURCES    = ["referral", "direct", "online", "other"];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const badRequest = (message) => createError(400, message);

const sanitizeAddress = (raw = {}) => ({
  line1:   String(raw?.line1 || "").trim(),
  city:    String(raw?.city  || "").trim(),
  country: String(raw?.country || "Kenya").trim() || "Kenya",
});

const sanitizeBillingAddress = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const normalized = {
    line1:   String(raw?.line1 || "").trim(),
    city:    String(raw?.city  || "").trim(),
    country: String(raw?.country || "").trim(),
  };
  // Return null if all fields are empty
  if (!normalized.line1 && !normalized.city && !normalized.country) return null;
  return normalized;
};

const sanitizeEmail = (raw, label) => {
  if (isPlaceholder(raw)) return "";
  const email = String(raw).trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw badRequest(`${label}: enter a valid email address, or - for none`);
  return email;
};

const sanitizePhone = (raw, label) => {
  const { value, error } = normalizeClientPhone(raw);
  if (error) throw badRequest(`${label}: ${error}`);
  return value;
};

const sanitizeContactPersons = (persons) => {
  if (!Array.isArray(persons)) return [];
  return persons
    .filter((p) => p && String(p?.name || "").trim())
    .map((p) => {
      const name = String(p?.name || "").trim();
      return {
        name,
        role:      String(p?.role  || "").trim(),
        email:     sanitizeEmail(p?.email, `Contact ${name}`),
        phone:     sanitizePhone(p?.phone, `Contact ${name}`),
        isPrimary: Boolean(p?.isPrimary),
        receivesInvoices: INVOICE_RECIPIENT_MODES.includes(p?.receivesInvoices) ? p.receivesInvoices : "none",
      };
    });
};

// Same shape as tenant documents (controllers/propertyController/tenants.js).
const sanitizeDocuments = (documents) => {
  if (!Array.isArray(documents)) return [];
  return documents
    .filter((doc) => doc && String(doc?.url || "").trim())
    .map((doc) => ({
      name: String(doc?.name || "").trim(),
      url: String(doc?.url || "").trim(),
      uploadedAt: doc?.uploadedAt ? new Date(doc.uploadedAt) : new Date(),
    }));
};

const sanitizeTaxBehaviour = (raw = {}) => {
  const rate = Number(raw?.incomeTaxWhtRate ?? 5);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw badRequest("Income tax WHT rate must be between 0 and 100");
  const expiry = raw?.exemptionExpiry ? new Date(raw.exemptionExpiry) : null;
  if (expiry && Number.isNaN(expiry.getTime())) throw badRequest("Invalid exemption expiry date");
  return {
    vatWithholdingAgent:    Boolean(raw?.vatWithholdingAgent),
    incomeTaxWhtAgent:      Boolean(raw?.incomeTaxWhtAgent),
    incomeTaxWhtRate:       rate,
    taxExempt:              Boolean(raw?.taxExempt),
    exemptionCertificateNo: String(raw?.exemptionCertificateNo || "").trim(),
    exemptionExpiry:        expiry,
  };
};

const sanitizeTerms = (raw = {}) => {
  const days = Number(raw?.paymentTermsDays ?? 30);
  const limit = Number(raw?.creditLimit ?? 0);
  if (!Number.isFinite(days) || days < 0) throw badRequest("Payment terms must be zero or more days");
  if (!Number.isFinite(limit) || limit < 0) throw badRequest("Credit limit cannot be negative");
  return {
    currency:               String(raw?.currency || "KES").trim().toUpperCase() || "KES",
    paymentTermsDays:       Math.round(days),
    creditLimit:            round2(limit),
    preferredPaymentMethod: String(raw?.preferredPaymentMethod || "").trim(),
  };
};

// Fields added with the richer client master are only written when the
// request carries them, so an older form that doesn't know about them can
// still save a client without wiping its tax/terms/collections settings.
const sanitizeClientPayload = (body = {}) => {
  const clientType = CLIENT_TYPES.includes(body.clientType) ? body.clientType : undefined;
  const pin = validateKraPin(body.taxPin, clientType || "company");
  if (pin.error) throw badRequest(pin.error);

  const payload = {
    name:                String(body.name || "").trim(),
    companyRegistration: String(body.companyRegistration || "").trim(),
    taxPin:              pin.value,
    email:               sanitizeEmail(body.email, "Email"),
    phone:               sanitizePhone(body.phone, "Phone"),
    address:             sanitizeAddress(body.address),
    billingAddress:      sanitizeBillingAddress(body.billingAddress),
    category:            ALLOWED_CATEGORIES.includes(body.category) ? body.category : "individual",
    status:              ALLOWED_STATUSES.includes(body.status) ? body.status : "active",
    source:              ALLOWED_SOURCES.includes(body.source) ? body.source : "direct",
    contactPersons:      sanitizeContactPersons(body.contactPersons),
    notes:               String(body.notes || "").trim(),
  };

  if (clientType) payload.clientType = clientType;
  if (body.tradingName !== undefined) payload.tradingName = String(body.tradingName || "").trim();
  if (body.industry !== undefined) payload.industry = String(body.industry || "").trim();
  if (body.vatRegistered !== undefined) payload.vatRegistered = Boolean(body.vatRegistered);
  if (body.taxBehaviour !== undefined) payload.taxBehaviour = sanitizeTaxBehaviour(body.taxBehaviour);
  if (body.terms !== undefined) payload.terms = sanitizeTerms(body.terms);
  if (body.accountManager !== undefined) {
    const manager = String(body.accountManager || "").trim();
    if (manager && !mongoose.Types.ObjectId.isValid(manager)) throw badRequest("Invalid account manager");
    payload.accountManager = manager || null;
  }
  if (body.tags !== undefined) {
    payload.tags = [...new Set((Array.isArray(body.tags) ? body.tags : String(body.tags || "").split(","))
      .map((tag) => String(tag || "").trim().toLowerCase()).filter(Boolean))].slice(0, 30);
  }
  if (body.documents !== undefined) payload.documents = sanitizeDocuments(body.documents);
  if (body.dunningOptOut !== undefined) payload.dunningOptOut = Boolean(body.dunningOptOut);
  if (body.creditHold !== undefined) payload.creditHold = Boolean(body.creditHold);
  if (body.creditHoldReason !== undefined) payload.creditHoldReason = String(body.creditHoldReason || "").trim();

  return { payload, warnings: pin.warning ? [pin.warning] : [] };
};

const auditClient = (req, business, action, client, message, metadata = {}) =>
  logAuditEvent({ req, company: business, action, category: "finance", targetType: "Client", targetId: client?._id, targetName: client?.name || "", message, metadata });

// ─── Controllers ─────────────────────────────────────────────────────────────

export const listClients = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };

    if (req.query.status && ALLOWED_STATUSES.includes(req.query.status)) {
      filter.status = req.query.status;
    }
    if (req.query.category && ALLOWED_CATEGORIES.includes(req.query.category)) {
      filter.category = req.query.category;
    }
    if (req.query.clientType && CLIENT_TYPES.includes(req.query.clientType)) filter.clientType = req.query.clientType;
    if (req.query.tag) filter.tags = String(req.query.tag).trim().toLowerCase();
    if (req.query.accountManager && mongoose.Types.ObjectId.isValid(String(req.query.accountManager))) filter.accountManager = req.query.accountManager;
    if (req.query.creditHold === "true" || req.query.creditHold === "false") filter.creditHold = req.query.creditHold === "true";
    if (req.query.search) {
      const search = escapeRegex(String(req.query.search).trim());
      filter.$or = [
        { name:  new RegExp(search, "i") },
        { tradingName: new RegExp(search, "i") },
        { email: new RegExp(search, "i") },
        { phone: new RegExp(search, "i") },
        { clientCode: new RegExp(search, "i") },
        { taxPin: new RegExp(search, "i") },
      ];
    }

    const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 200);
    const page  = Math.max(Number(req.query.page  || 1), 1);
    const skip  = (page - 1) * limit;

    const [clients, total] = await Promise.all([
      Client.find(filter).sort({ name: 1 }).skip(skip).limit(limit).lean(),
      Client.countDocuments(filter),
    ]);

    // Balance, MRR and last SMS/email for this page only — three batched queries, so the list never
    // has to stitch them together from report endpoints that stop at 200 clients
    const pageIds = clients.map((c) => c._id);
    if (pageIds.length) {
      const [balances, contracts, sends] = await Promise.all([
        getOpenBalancesByClient({ business, clientIds: pageIds }),
        ClientContract.find({ business, client: { $in: pageIds }, status: "active" })
          .select("client mrr lines currentValue billingCycle")
          .lean(),
        ClientInteraction.aggregate([
          { $match: { business: new mongoose.Types.ObjectId(String(business)), client: { $in: pageIds }, type: { $in: ["sms", "email"] }, emailStatus: { $ne: "failed" } } },
          { $group: { _id: { client: "$client", type: "$type" }, at: { $max: "$createdAt" } } },
        ]),
      ]);
      const mrrByClient = new Map();
      contracts.forEach((c) => mrrByClient.set(String(c.client), round2((mrrByClient.get(String(c.client)) || 0) + contractMrr(c))));
      const sentByClient = new Map();
      sends.forEach(({ _id, at }) => {
        const entry = sentByClient.get(String(_id.client)) || {};
        entry[_id.type] = at;
        sentByClient.set(String(_id.client), entry);
      });
      clients.forEach((c) => {
        const id = String(c._id);
        const open = balances.get(id);
        c.balance = open?.balance || 0;
        c.overdue = open?.overdue || 0;
        c.mrr = mrrByClient.get(id) || 0;
        c.lastSmsAt = sentByClient.get(id)?.sms || null;
        c.lastEmailAt = sentByClient.get(id)?.email || null;
      });
    }

    const pagination = { page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) };
    res.status(200).json({ success: true, data: { clients, pagination }, clients, pagination });
  } catch (error) {
    next(error);
  }
};

export const getClient = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const client = await Client.findOne({ _id: req.params.id, business }).populate("accountManager", "surname otherNames email").lean();
    if (!client) return next(createError(404, "Client not found"));
    res.status(200).json({ success: true, data: client, client });
  } catch (error) {
    next(error);
  }
};

// Pre-create duplicate check: by name similarity, KRA PIN, phone and email.
// The form calls this as the user types; createClient enforces the hard rule
// (one client per KRA PIN) on its own.
export const checkDuplicateClients = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const source = { ...req.query, ...req.body };
    const matches = await findDuplicateClients({
      business,
      name: source.name,
      taxPin: source.taxPin,
      phone: source.phone,
      email: source.email,
      excludeId: mongoose.Types.ObjectId.isValid(String(source.excludeId || "")) ? source.excludeId : null,
    });
    const hasStrongMatch = matches.some((m) => m.reasons.includes("taxPin") || m.reasons.includes("email"));
    res.status(200).json({ success: true, data: { matches, hasStrongMatch }, matches, hasStrongMatch });
  } catch (error) {
    next(error);
  }
};

const assertPinUnique = async ({ business, taxPin, excludeId = null }) => {
  if (!taxPin) return;
  const clash = await Client.findOne({ business, taxPin, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }).select("name clientCode").lean();
  if (clash) throw createError(409, `KRA PIN ${taxPin} already belongs to ${clash.name} (${clash.clientCode})`);
};

export const createClient = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const { payload, warnings } = sanitizeClientPayload(req.body);

    if (!payload.name) return next(createError(400, "Client name is required"));
    await assertPinUnique({ business, taxPin: payload.taxPin });

    const clientCode = await nextClientCode(business);
    const client = await Client.create({
      ...payload,
      clientCode,
      business,
      createdBy: userId,
      updatedBy: userId,
    });

    auditClient(req, business, "client.created", client, `Client ${client.name} (${client.clientCode}) created`);
    emitToCompany(business, "client:created", { _id: client._id, name: client.name, clientCode: client.clientCode });
    res.status(201).json({ success: true, data: client, client, warnings, message: "Client created" });
  } catch (error) {
    next(error);
  }
};

export const updateClient = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const { payload, warnings } = sanitizeClientPayload(req.body);

    if (!payload.name) return next(createError(400, "Client name is required"));
    await assertPinUnique({ business, taxPin: payload.taxPin, excludeId: req.params.id });

    const before = await Client.findOne({ _id: req.params.id, business }).select("status creditHold dunningOptOut terms taxPin").lean();
    if (!before) return next(createError(404, "Client not found"));

    const client = await Client.findOneAndUpdate(
      { _id: req.params.id, business },
      { ...payload, updatedBy: userId },
      { new: true, runValidators: true }
    );
    if (!client) return next(createError(404, "Client not found"));

    // The commercially sensitive changes go into the audit trail explicitly.
    const changes = {};
    if (before.status !== client.status) changes.status = [before.status, client.status];
    if (Boolean(before.creditHold) !== Boolean(client.creditHold)) changes.creditHold = [Boolean(before.creditHold), client.creditHold];
    if (Boolean(before.dunningOptOut) !== Boolean(client.dunningOptOut)) changes.dunningOptOut = [Boolean(before.dunningOptOut), client.dunningOptOut];
    if (Number(before.terms?.creditLimit || 0) !== Number(client.terms?.creditLimit || 0)) changes.creditLimit = [Number(before.terms?.creditLimit || 0), client.terms?.creditLimit];
    if ((before.taxPin || "") !== (client.taxPin || "")) changes.taxPin = [before.taxPin || "", client.taxPin || ""];
    auditClient(req, business, "client.updated", client, `Client ${client.name} updated`, { changes });
    emitToCompany(business, "client:updated", { _id: client._id });

    res.status(200).json({ success: true, data: client, client, warnings, message: "Client updated" });
  } catch (error) {
    next(error);
  }
};

export const deleteClient = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const client = await Client.findOne({ _id: req.params.id, business }).lean();
    if (!client) return next(createError(404, "Client not found"));

    const hasActiveContracts = await ClientContract.exists({
      client:   client._id,
      business,
      status:   { $in: ["active", "draft"] },
    });
    if (hasActiveContracts) {
      return next(createError(400, "Cannot delete a client with active or draft contracts. Resolve contracts first."));
    }

    // A client with financial history must be kept (statements, audit, VAT).
    const [hasInvoices, hasReceipts] = await Promise.all([
      ClientInvoice.exists({ client: client._id, business, status: { $ne: "draft" } }),
      ClientReceipt.exists({ client: client._id, business }),
    ]);
    if (hasInvoices || hasReceipts) {
      return next(createError(400, "This client has invoices or receipts on record. Mark it churned or inactive instead of deleting it."));
    }

    await Client.deleteOne({ _id: client._id, business });
    auditClient(req, business, "client.deleted", client, `Client ${client.name} (${client.clientCode}) deleted`);
    emitToCompany(business, "client:deleted", { _id: client._id });
    res.status(200).json({ success: true, message: "Client deleted" });
  } catch (error) {
    next(error);
  }
};

export const getClientSummary = async (req, res, next) => {
  try {
    const business   = resolveActiveBusinessId(req);
    const clientId   = req.params.id;

    const client = await Client.findOne({ _id: clientId, business }).lean();
    if (!client) return next(createError(404, "Client not found"));

    const [activeContracts, invoiceAgg, interactionCount, balances, unappliedCredit, lastReceipt, lastLegacyPayment, whtAgg, credit] = await Promise.all([
      ClientContract.find({ client: clientId, business, status: { $in: ["active", "pending_renewal"] } })
        .select("mrr lines currentValue baseValue billingCycle taxMode startDate endDate openEnded minimumTermMonths")
        .lean(),
      ClientInvoice.aggregate([
        // Only invoices that were actually sent (and so posted to the GL) count
        // here — a draft never posted, and a cancelled one had its posting
        // reversed. Counting either would overstate the client's real
        // position and disagree with getClientStatement's identical exclusion.
        { $match: { client: client._id, business: client.business, status: { $nin: ["draft", "cancelled"] } } },
        {
          $group: {
            _id:            null,
            totalInvoiced:  { $sum: "$total" },
            totalPaid:      { $sum: "$paidAmount" },
            invoiceCount:   { $sum: 1 },
            overdueCount:   { $sum: { $cond: [{ $eq: ["$status", "overdue"] }, 1, 0] } },
          },
        },
      ]),
      ClientInteraction.countDocuments({ client: clientId, business }),
      getOpenBalancesByClient({ business, clientIds: [client._id] }),
      getClientUnappliedCredit({ business, clientId: client._id }),
      ClientReceipt.findOne({ client: clientId, business, status: "posted" }).sort({ receiptDate: -1 }).select("receiptNumber receiptDate amount method reference").lean(),
      ClientPayment.findOne({ client: clientId, business, status: { $ne: "reversed" } }).sort({ paymentDate: -1 }).select("paymentDate amount paymentMethod paymentReference").lean(),
      ClientWhtCertificate.aggregate([
        { $match: { client: client._id, business: client.business, status: "expected" } },
        { $group: { _id: "$type", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
      ]),
      assertClientCreditOk(client, { business }),
    ]);

    const inv = invoiceAgg[0] || { totalInvoiced: 0, totalPaid: 0, invoiceCount: 0, overdueCount: 0 };
    const open = balances.get(String(client._id)) || { balance: 0, overdue: 0, openInvoices: 0 };
    const mrr = round2(activeContracts.reduce((sum, c) => sum + contractMrr(c), 0));
    const creditLimit = Number(client.terms?.creditLimit || 0);

    // Newest of the receipt and legacy single-invoice payment paths.
    const lastPayment = [
      lastReceipt && { date: lastReceipt.receiptDate, amount: lastReceipt.amount, method: lastReceipt.method, reference: lastReceipt.reference, receiptNumber: lastReceipt.receiptNumber },
      lastLegacyPayment && { date: lastLegacyPayment.paymentDate, amount: lastLegacyPayment.amount, method: lastLegacyPayment.paymentMethod, reference: lastLegacyPayment.paymentReference },
    ].filter(Boolean).sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;

    const whtOf = (type) => whtAgg.find((r) => r._id === type) || { amount: 0, count: 0 };

    res.status(200).json({
      success: true,
      data: {
        client,
        summary: {
          activeContracts:  activeContracts.length,
          mrr,
          arr:              round2(mrr * 12),
          totalInvoiced:    inv.totalInvoiced,
          totalPaid:        inv.totalPaid,
          outstanding:      open.balance,
          balance:          open.balance,
          overdue:          open.overdue,
          openInvoices:     open.openInvoices,
          oldestDueDate:    open.oldestDueDate || null,
          unappliedCredit,
          netBalance:       round2(open.balance - unappliedCredit),
          creditLimit,
          creditUsed:       credit.exposure ?? 0,
          creditAvailable:  credit.available ?? null,
          creditUsedPercent: creditLimit > 0 ? Math.round(((credit.exposure || 0) / creditLimit) * 100) : null,
          creditStatus:     { level: credit.level, reasons: credit.reasons },
          lastPayment,
          openWhtCertificates: {
            count: whtOf("income_tax").count + whtOf("vat").count,
            incomeTax: round2(whtOf("income_tax").amount),
            vat: round2(whtOf("vat").amount),
          },
          invoiceCount:     inv.invoiceCount,
          overdueCount:     inv.overdueCount,
          interactionCount,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// Client statement — a running-balance ledger of invoices, credit/debit notes,
// receipts (with their allocations), WHT withheld, credit refunds and legacy
// payments; ?from collapses earlier activity into an opening balance and ?to
// caps it. Shaped to match the TenantStatementTab `statementData` contract.
export const getClientStatement = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const clientId = req.params.id;

    const client = await Client.findOne({ _id: clientId, business }).lean();
    if (!client) return next(createError(404, "Client not found"));

    const from = req.query.from || req.query.dateFrom || null;
    const to = req.query.to || req.query.dateTo || null;
    for (const value of [from, to]) {
      if (value && Number.isNaN(new Date(value).getTime())) return next(createError(400, "Invalid statement date"));
    }
    const statement = await buildClientStatement({ business, clientId: client._id, from, to });

    res.status(200).json({ success: true, data: { client, ...statement } });
  } catch (error) {
    next(error);
  }
};

// Sends an ad-hoc SMS to a client (or a specific contact person's number) and
// logs it as a ClientInteraction — reuses the shared communicationService's
// sendAdHocSms (the same one-off-send helper Property Sale's buyers/deals/leads
// controllers and Car Wash's manual-SMS actions already use), rather than
// building a separate SMS integration for this module.
export const sendClientSms = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const client = await Client.findOne({ _id: req.params.id, business }).lean();
    if (!client) return next(createError(404, "Client not found"));

    const phone = String(req.body.phone || client.phone || "").trim();
    const body  = String(req.body.body || "").trim();
    if (!phone) return next(createError(400, "No phone number available — provide one or add it to the client"));
    if (!body)  return next(createError(400, "Message body is required"));

    const result = await sendAdHocSms({ businessId: business, phone, body, templateKey: "client_manual", recipientName: client.name });
    const wasSent = Boolean(result?.messageId || result?.status);

    const interaction = await ClientInteraction.create({
      business,
      client: client._id,
      type: "sms",
      subject: `SMS to ${phone}`,
      body,
      emailStatus: wasSent ? "sent" : "failed",
      createdBy: userId,
    });

    res.status(200).json({ success: true, message: wasSent ? "SMS sent" : "SMS dispatch could not be confirmed", interaction });
  } catch (error) {
    next(error);
  }
};
