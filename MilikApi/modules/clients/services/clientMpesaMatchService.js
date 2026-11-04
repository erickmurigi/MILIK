// M-Pesa C2B → client receipt. A paybill payment whose account reference is a
// client code (CLT-00012) or a client invoice number (CINV-00345) becomes a
// posted ClientReceipt with an instant SMS acknowledgement, the same way PMS
// rent payments are auto-receipted. Anything that doesn't resolve stays in
// the existing unmatched queue untouched, for manual matching.
import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import { round2 } from "../../../utils/math.js";
import Company from "../../../models/Company.js";
import MpesaCollection from "../../../models/MpesaCollection.js";
import { getRawMpesaPaybillConfigs, getPrimaryMpesaPaybillConfig } from "../../../utils/companyModules.js";
import { sendAdHocSms, sendAdHocSmsToMasked } from "../../../services/communicationService.js";
import Client from "../models/Client.js";
import ClientInvoice from "../models/ClientInvoice.js";
import ClientReceipt from "../models/ClientReceipt.js";
import { createClientReceipt } from "./clientReceiptService.js";
import { getOpenBalancesByClient } from "./clientCreditControlService.js";

// Payers type references every which way: "clt00012", "CLT-12", "cinv 345".
export const referenceVariants = (raw) => {
  const compact = String(raw || "").toUpperCase().replace(/\s+/g, "").trim();
  if (!compact) return [];
  const variants = new Set([compact]);
  const match = compact.match(/^([A-Z]+)-?(\d+)$/);
  if (match) {
    const [, prefix, digits] = match;
    const trimmed = String(Number(digits));
    for (const number of new Set([digits, trimmed, trimmed.padStart(5, "0")])) {
      variants.add(`${prefix}-${number}`);
      variants.add(`${prefix}${number}`);
    }
  }
  return [...variants];
};

// Invoice number wins over client code: it's the more specific instruction.
export const resolveClientFromReference = async ({ business, reference }) => {
  const variants = referenceVariants(reference);
  if (!variants.length) return null;
  const [invoice, client] = await Promise.all([
    ClientInvoice.findOne({ business, invoiceNumber: { $in: variants }, status: { $nin: ["draft", "cancelled"] } }).select("client invoiceNumber").lean(),
    Client.findOne({ business, clientCode: { $in: variants } }).select("_id").lean(),
  ]);
  if (invoice) return { clientId: String(invoice.client), invoiceId: String(invoice._id), matchedBy: "invoice_number" };
  if (client) return { clientId: String(client._id), invoiceId: null, matchedBy: "client_code" };
  return null;
};

const resolvePaybillCashbook = async (business, shortCode) => {
  const company = await Company.findById(business).select("paymentIntegration companyName").lean();
  const configs = getRawMpesaPaybillConfigs(company?.paymentIntegration || {});
  const config = configs.find((item) => String(item?.shortCode || "").trim() === String(shortCode || "").trim()) || getPrimaryMpesaPaybillConfig(configs);
  return { cashbookAccountId: config?.defaultCashbookAccountId || null, companyName: company?.companyName || "" };
};

const fmt = (value) => `KES ${round2(value).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const buildMpesaReceiptSms = ({ client, receipt, balance, companyName }) => {
  const applied = receipt.allocations.filter((a) => a.kind === "receipt").map((a) => a.invoiceNumber).filter(Boolean);
  const parts = [
    `Dear ${client.name}, we have received ${fmt(receipt.amount)} (ref ${receipt.reference}).`,
    `Receipt ${receipt.receiptNumber}${applied.length ? ` for ${applied.slice(0, 3).join(", ")}${applied.length > 3 ? "..." : ""}` : ""}.`,
    receipt.unappliedAmount > 0 ? `Credit on account: ${fmt(receipt.unappliedAmount)}.` : "",
    `Balance: ${fmt(balance)}. Thank you${companyName ? ` - ${companyName}` : ""}`,
  ];
  return parts.filter(Boolean).join(" ");
};

const isKenyanMobile = (value) => /^(?:\+?254|0)?[17]\d{8}$/.test(String(value || "").replace(/\s+/g, ""));

const sendReceiptSms = async ({ business, collection, client, receipt, companyName }) => {
  try {
    const balances = await getOpenBalancesByClient({ business, clientIds: [client._id] });
    const balance = balances.get(String(client._id))?.balance || 0;
    const body = buildMpesaReceiptSms({ client, receipt, balance, companyName });
    const msisdn = String(collection.msisdn || "").trim();
    // Safaricom now masks payer numbers on C2B; Africa's Talking routes a
    // reply to the hashed number (same path as the car wash instant SMS).
    if (msisdn && !isKenyanMobile(msisdn)) {
      return await sendAdHocSmsToMasked({ businessId: business, maskedNumber: msisdn, body, templateKey: "client_mpesa_receipt", recipientName: client.name });
    }
    const phone = msisdn || client.phone;
    if (!phone) return null;
    return await sendAdHocSms({ businessId: business, phone, body, templateKey: "client_mpesa_receipt", recipientName: client.name });
  } catch (err) {
    console.error("[clientMpesa] receipt SMS failed:", err?.message || err);
    return null;
  }
};

/**
 * Turns one MpesaCollection into a client receipt. Idempotent: a collection
 * already receipted returns that receipt. `clientId`/`invoiceId` override the
 * reference lookup (manual matching from the unmatched queue).
 */
export const matchMpesaCollectionToClient = async ({ business = null, collectionId, clientId = null, invoiceId = null, cashbookAccountId = null, userId = null, source = "mpesa_auto", sendSms = true }) => {
  if (!mongoose.Types.ObjectId.isValid(String(collectionId || ""))) throw createError(400, "Invalid collection id");
  const collection = await MpesaCollection.findOne({ _id: collectionId, ...(business ? { business } : {}) }).lean();
  if (!collection) throw createError(404, "M-Pesa collection not found");
  const businessId = String(collection.business);

  const existing = await ClientReceipt.findOne({ business: businessId, mpesaCollection: collection._id, status: "posted" }).lean();
  if (existing) return { matched: true, alreadyMatched: true, receipt: existing };
  if (["captured", "duplicate", "ignored"].includes(collection.matchingStatus)) {
    throw createError(400, `This M-Pesa payment is already ${collection.matchingStatus}${collection.matchedReceipt ? " to a rent receipt" : ""}`);
  }
  if (!(Number(collection.amount) > 0)) throw createError(400, "M-Pesa payment has no amount");

  let target = null;
  if (clientId) {
    target = { clientId: String(clientId), invoiceId: invoiceId ? String(invoiceId) : null, matchedBy: "manual" };
  } else {
    target = await resolveClientFromReference({ business: businessId, reference: collection.accountReference || collection.billRefNumber });
  }
  if (!target) return { matched: false, reason: "Account reference does not match any client code or invoice number" };

  const client = await Client.findOne({ _id: target.clientId, business: businessId }).select("name phone clientCode").lean();
  if (!client) throw createError(404, "Client not found");

  const paybill = await resolvePaybillCashbook(businessId, collection.shortCode);
  const cashbook = cashbookAccountId || paybill.cashbookAccountId;
  if (!cashbook) {
    await MpesaCollection.updateOne({ _id: collection._id }, { $set: { "metadata.clientMatchSkipReason": "Paybill config has no default cashbook account" } });
    return { matched: false, reason: "Paybill config has no default cashbook account" };
  }

  const receipt = await createClientReceipt({
    business: businessId,
    userId,
    source,
    mpesaCollectionId: collection._id,
    input: {
      client: target.clientId,
      method: "mobile_money",
      amount: collection.amount,
      receiptDate: collection.transactionDate || collection.createdAt || new Date(),
      reference: collection.transactionCode,
      cashbookAccountId: cashbook,
      preferInvoiceId: target.invoiceId,
      notes: `M-Pesa ${collection.transactionCode}${collection.payerName ? ` — ${collection.payerName}` : ""}`,
    },
  });

  await MpesaCollection.updateOne(
    { _id: collection._id },
    {
      $set: {
        matchingStatus: "captured",
        "metadata.matchedModule": "clients",
        "metadata.clientId": String(client._id),
        "metadata.clientReceiptId": String(receipt._id),
        "metadata.clientReceiptNumber": receipt.receiptNumber,
        "metadata.clientMatchedBy": target.matchedBy,
        "metadata.clientMatchSkipReason": "",
      },
    }
  );

  const sms = sendSms ? await sendReceiptSms({ business: businessId, collection, client, receipt, companyName: paybill.companyName }) : null;
  return { matched: true, matchedBy: target.matchedBy, receipt, smsSent: Boolean(sms?.messageId || sms?.status) };
};

// Hook for the C2B confirmation callback: only acts on payments PMS didn't
// claim (no tenant matched) and never throws back into the callback.
export const autoMatchClientMpesaCollection = async (collectionOrId) => {
  try {
    const collection = typeof collectionOrId === "object" && collectionOrId?._id ? collectionOrId : await MpesaCollection.findById(collectionOrId).lean();
    if (!collection || collection.tenant || collection.matchingStatus !== "unmatched") return { matched: false, reason: "not eligible" };
    return await matchMpesaCollectionToClient({ collectionId: collection._id, source: "mpesa_auto" });
  } catch (err) {
    console.error("[clientMpesa] auto-match failed:", err?.message || err);
    const id = collectionOrId?._id || collectionOrId;
    if (id) await MpesaCollection.updateOne({ _id: id }, { $set: { "metadata.clientMatchSkipReason": String(err?.message || "Client auto-match failed").slice(0, 300) } }).catch(() => {});
    return { matched: false, reason: err?.message || "failed" };
  }
};
