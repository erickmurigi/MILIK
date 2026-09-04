import { createError } from "../../../utils/error.js";
import Client from "../models/Client.js";
import ClientContract from "../models/ClientContract.js";
import ClientInvoice from "../models/ClientInvoice.js";
import ClientInteraction from "../models/ClientInteraction.js";
import ClientPayment from "../models/ClientPayment.js";
import { resolveActiveBusinessId, currentUserId, escapeRegex } from "../services/businessScope.js";
import { nextClientCode } from "../services/clientSequenceService.js";
import { sendAdHocSms } from "../../../services/communicationService.js";

// ─── Sanitizers ──────────────────────────────────────────────────────────────

const ALLOWED_CATEGORIES = ["enterprise", "sme", "individual"];
const ALLOWED_STATUSES   = ["active", "inactive", "churned"];
const ALLOWED_SOURCES    = ["referral", "direct", "online", "other"];

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

const sanitizeContactPersons = (persons) => {
  if (!Array.isArray(persons)) return [];
  return persons
    .filter((p) => p && String(p?.name || "").trim())
    .map((p) => ({
      name:      String(p?.name  || "").trim(),
      role:      String(p?.role  || "").trim(),
      email:     String(p?.email || "").trim(),
      phone:     String(p?.phone || "").trim(),
      isPrimary: Boolean(p?.isPrimary),
    }));
};

const sanitizeClientPayload = (body = {}) => ({
  name:                String(body.name || "").trim(),
  companyRegistration: String(body.companyRegistration || "").trim(),
  taxPin:              String(body.taxPin || "").trim(),
  email:               String(body.email || "").trim().toLowerCase(),
  phone:               String(body.phone || "").trim(),
  address:             sanitizeAddress(body.address),
  billingAddress:      sanitizeBillingAddress(body.billingAddress),
  category:            ALLOWED_CATEGORIES.includes(body.category) ? body.category : "individual",
  status:              ALLOWED_STATUSES.includes(body.status) ? body.status : "active",
  source:              ALLOWED_SOURCES.includes(body.source) ? body.source : "direct",
  contactPersons:      sanitizeContactPersons(body.contactPersons),
  notes:               String(body.notes || "").trim(),
});

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
    if (req.query.search) {
      const search = escapeRegex(String(req.query.search).trim());
      filter.$or = [
        { name:  new RegExp(search, "i") },
        { email: new RegExp(search, "i") },
        { phone: new RegExp(search, "i") },
        { clientCode: new RegExp(search, "i") },
      ];
    }

    const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 200);
    const page  = Math.max(Number(req.query.page  || 1), 1);
    const skip  = (page - 1) * limit;

    const [clients, total] = await Promise.all([
      Client.find(filter).sort({ name: 1 }).skip(skip).limit(limit).lean(),
      Client.countDocuments(filter),
    ]);

    const pagination = { page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) };
    res.status(200).json({ success: true, data: { clients, pagination }, clients, pagination });
  } catch (error) {
    next(error);
  }
};

export const getClient = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const client = await Client.findOne({ _id: req.params.id, business }).lean();
    if (!client) return next(createError(404, "Client not found"));
    res.status(200).json({ success: true, data: client, client });
  } catch (error) {
    next(error);
  }
};

export const createClient = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const payload  = sanitizeClientPayload(req.body);

    if (!payload.name) return next(createError(400, "Client name is required"));

    const clientCode = await nextClientCode(business);
    const client = await Client.create({
      ...payload,
      clientCode,
      business,
      createdBy: userId,
      updatedBy: userId,
    });

    res.status(201).json({ success: true, data: client, client, message: "Client created" });
  } catch (error) {
    next(error);
  }
};

export const updateClient = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const payload  = sanitizeClientPayload(req.body);

    if (!payload.name) return next(createError(400, "Client name is required"));

    const client = await Client.findOneAndUpdate(
      { _id: req.params.id, business },
      { ...payload, updatedBy: userId },
      { new: true, runValidators: true }
    );
    if (!client) return next(createError(404, "Client not found"));

    res.status(200).json({ success: true, data: client, client, message: "Client updated" });
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

    await Client.deleteOne({ _id: client._id, business });
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

    const [activeContracts, invoiceAgg, interactionCount] = await Promise.all([
      ClientContract.countDocuments({ client: clientId, business, status: "active" }),
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
    ]);

    const inv = invoiceAgg[0] || { totalInvoiced: 0, totalPaid: 0, invoiceCount: 0, overdueCount: 0 };

    res.status(200).json({
      success: true,
      data: {
        client,
        summary: {
          activeContracts,
          totalInvoiced:    inv.totalInvoiced,
          totalPaid:        inv.totalPaid,
          outstanding:      Math.max(0, inv.totalInvoiced - inv.totalPaid),
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

// Client statement — a running-balance ledger of every invoice (charge) and
// payment (credit) for one client. Shaped to match the existing
// TenantStatementTab component's `statementData` contract (transactions,
// totalCharges, totalPayments, operationalOutstanding, unappliedCredits,
// currentBalance) so the same statement UI pattern renders this too.
export const getClientStatement = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const clientId = req.params.id;

    const client = await Client.findOne({ _id: clientId, business }).lean();
    if (!client) return next(createError(404, "Client not found"));

    const [invoices, payments] = await Promise.all([
      // Only invoices that were actually sent (and so posted to the GL) belong
      // on the statement — a draft never posted, and a cancelled one had its
      // posting reversed. Including either would show a "charge" with nothing
      // behind it in the actual ledger.
      ClientInvoice.find({ client: clientId, business, status: { $nin: ["draft", "cancelled"] } })
        .select("invoiceNumber issueDate total status")
        .sort({ issueDate: 1 })
        .lean(),
      ClientPayment.find({ client: clientId, business, status: { $ne: "reversed" } })
        .select("invoice amount paymentDate paymentMethod paymentReference")
        .sort({ paymentDate: 1 })
        .lean(),
    ]);

    const invoiceNumberById = new Map(invoices.map((inv) => [String(inv._id), inv.invoiceNumber]));

    const transactions = [
      ...invoices.map((inv) => ({
        id: String(inv._id),
        date: inv.issueDate,
        description: `Invoice ${inv.invoiceNumber}`,
        type: "CHARGE",
        transactionCode: inv.invoiceNumber,
        amount: inv.total,
        sourceKind: "invoice",
        sourceId: String(inv._id),
      })),
      ...payments.map((pay) => {
        const forInvoice = invoiceNumberById.get(String(pay.invoice));
        return {
          id: String(pay._id),
          date: pay.paymentDate,
          description: `Payment received${forInvoice ? ` — ${forInvoice}` : ""}`,
          type: "PAYMENT",
          transactionCode: pay.paymentReference || "",
          amount: pay.amount,
          sourceKind: "receipt",
          sourceId: String(pay._id),
        };
      }),
    ].sort((a, b) => new Date(a.date) - new Date(b.date));

    // Running balance: charges increase what the client owes, payments reduce it.
    let running = 0;
    for (const tx of transactions) {
      running += tx.type === "CHARGE" ? tx.amount : -tx.amount;
      tx.balance = Math.round(running * 100) / 100;
    }

    const totalCharges = Math.round(invoices.reduce((sum, inv) => sum + inv.total, 0) * 100) / 100;
    const totalPayments = Math.round(payments.reduce((sum, pay) => sum + pay.amount, 0) * 100) / 100;
    const currentBalance = Math.round((totalCharges - totalPayments) * 100) / 100;

    res.status(200).json({
      success: true,
      data: {
        client,
        transactions,
        totalCharges,
        totalPayments,
        operationalOutstanding: Math.max(0, currentBalance),
        unappliedCredits: Math.max(0, -currentBalance),
        currentBalance,
      },
    });
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
