// Credit control: how much a client owes against their limit, and whether new
// billing should go ahead. The billing run calls assertClientCreditOk before
// raising an invoice; it never throws — callers decide what "block" means.
import mongoose from "mongoose";
import { round2 } from "../../../utils/math.js";
import Client from "../models/Client.js";
import ClientInvoice from "../models/ClientInvoice.js";
import ClientCollectionSettings from "../models/ClientCollectionSettings.js";
import { OPEN_INVOICE_STATUSES, getClientUnappliedCredit } from "./clientReceiptService.js";
import { clientInvoiceOutstandingExpr } from "./clientInvoiceBalanceService.js";

const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));

// Open AR for a set of clients in one aggregation (no per-client queries).
export const getOpenBalancesByClient = async ({ business, clientIds = null, asOf = new Date() }) => {
  const match = { business: toObjectId(business), status: { $in: OPEN_INVOICE_STATUSES } };
  if (clientIds) match.client = { $in: clientIds.map(toObjectId) };
  const rows = await ClientInvoice.aggregate([
    { $match: match },
    { $project: { client: 1, dueDate: 1, outstanding: { $max: [0, clientInvoiceOutstandingExpr()] } } },
    {
      $group: {
        _id: "$client",
        balance: { $sum: "$outstanding" },
        overdue: { $sum: { $cond: [{ $lt: ["$dueDate", asOf] }, "$outstanding", 0] } },
        openInvoices: { $sum: { $cond: [{ $gt: ["$outstanding", 0] }, 1, 0] } },
        oldestDueDate: { $min: "$dueDate" },
      },
    },
  ]);
  return new Map(rows.map((row) => [String(row._id), { balance: round2(row.balance), overdue: round2(row.overdue), openInvoices: row.openInvoices, oldestDueDate: row.oldestDueDate }]));
};

export const getCollectionSettings = async (business) => {
  const existing = await ClientCollectionSettings.findOne({ business }).lean();
  if (existing) return existing;
  // Lazily create with defaults; upsert keeps concurrent first calls safe.
  return ClientCollectionSettings.findOneAndUpdate(
    { business },
    { $setOnInsert: { business } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
};

/**
 * Returns { level: "ok"|"warn"|"block", ok, reasons[], creditLimit, exposure,
 * available, overdue, ... }. `additionalAmount` is the invoice about to be
 * raised. creditHold / on_hold / blacklisted always block; going over the
 * limit warns or blocks per the company's creditLimitAction.
 */
export const assertClientCreditOk = async (clientOrId, { business = null, additionalAmount = 0, settings = null } = {}) => {
  const client = clientOrId && typeof clientOrId === "object" && clientOrId.name !== undefined
    ? clientOrId
    : await Client.findOne({ _id: clientOrId, ...(business ? { business } : {}) }).select("business name status creditHold creditHoldReason terms").lean();
  if (!client) return { ok: false, level: "block", reasons: ["Client not found"] };

  const businessId = business || client.business;
  const [balances, unapplied, policy] = await Promise.all([
    getOpenBalancesByClient({ business: businessId, clientIds: [client._id] }),
    getClientUnappliedCredit({ business: businessId, clientId: client._id }),
    settings ? Promise.resolve(settings) : getCollectionSettings(businessId),
  ]);
  const open = balances.get(String(client._id)) || { balance: 0, overdue: 0, openInvoices: 0 };
  const exposure = round2(open.balance - unapplied + Number(additionalAmount || 0));
  const creditLimit = Number(client.terms?.creditLimit || 0);

  const reasons = [];
  let level = "ok";
  const escalate = (to) => { if (to === "block" || (to === "warn" && level === "ok")) level = to; };

  if (client.creditHold) { reasons.push(`Client is on credit hold${client.creditHoldReason ? `: ${client.creditHoldReason}` : ""}`); escalate("block"); }
  if (client.status === "blacklisted") { reasons.push("Client is blacklisted"); escalate("block"); }
  if (client.status === "on_hold") { reasons.push("Client account is on hold"); escalate("block"); }

  if (creditLimit > 0) {
    if (exposure > creditLimit) {
      reasons.push(`Exposure ${exposure} exceeds credit limit ${creditLimit}`);
      escalate(policy?.creditLimitAction === "block" ? "block" : "warn");
    } else if (exposure >= creditLimit * (Number(policy?.creditWarnPercent || 90) / 100)) {
      reasons.push(`Exposure ${exposure} is at ${Math.round((exposure / creditLimit) * 100)}% of the credit limit`);
      escalate("warn");
    }
  }
  if (open.overdue > 0) reasons.push(`${open.overdue} is overdue`);

  return {
    ok: level !== "block",
    level,
    reasons,
    creditLimit,
    balance: open.balance,
    overdue: open.overdue,
    unappliedCredit: unapplied,
    exposure,
    available: creditLimit > 0 ? round2(creditLimit - exposure) : null,
  };
};
