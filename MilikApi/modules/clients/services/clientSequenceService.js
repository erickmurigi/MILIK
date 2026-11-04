import SequenceCounter from "../../../models/SequenceCounter.js";

/**
 * Atomically increments a named counter for the given business and returns
 * a formatted reference number string.
 */
const nextNumber = async (business, key, prefix, padLength = 5) => {
  const counter = await SequenceCounter.findOneAndUpdate(
    { business, key },
    { $inc: { sequence: 1 } },
    { new: true, upsert: true }
  );
  return `${prefix}-${String(counter.sequence).padStart(padLength, "0")}`;
};

export const nextClientCode = (businessId) =>
  nextNumber(businessId, `clients_client_${businessId}`, "CLT");

export const nextContractNumber = (businessId) =>
  nextNumber(businessId, `clients_contract_${businessId}`, "CTR");

export const nextInvoiceNumber = (businessId) =>
  nextNumber(businessId, `clients_invoice_${businessId}`, "CINV");

export const nextClientReceiptNumber = (businessId) =>
  nextNumber(businessId, `clients_receipt_${businessId}`, "CR");

export const nextClientRefundNumber = (businessId) =>
  nextNumber(businessId, `clients_refund_${businessId}`, "CRF");

// eTIMS invcNo must be a plain integer sequence per taxpayer branch.
export const nextEtimsInvoiceNo = async (businessId) => {
  const counter = await SequenceCounter.findOneAndUpdate(
    { business: businessId, key: `clients_etims_invcno_${businessId}` },
    { $inc: { sequence: 1 } },
    { new: true, upsert: true }
  );
  return counter.sequence;
};

// ─── Contract billing documents (part A) ─────────────────────────────────────
const cleanPrefix = (prefix, fallback) =>
  String(prefix || fallback).trim().toUpperCase().replace(/[^A-Z0-9]/g, "") || fallback;

// Invoice series: the default "CINV" series keeps using the original counter so numbering continues
// unbroken; any other prefix gets its own counter.
export const nextInvoiceNumberForSeries = (businessId, prefix = "CINV") => {
  const series = cleanPrefix(prefix, "CINV");
  return series === "CINV"
    ? nextInvoiceNumber(businessId)
    : nextNumber(businessId, `clients_invoice_${businessId}_${series}`, series);
};

export const nextCreditNoteNumber = (businessId, prefix = "CN") =>
  nextNumber(businessId, `clients_credit_note_${businessId}`, cleanPrefix(prefix, "CN"));

export const nextDebitNoteNumber = (businessId, prefix = "DN") =>
  nextNumber(businessId, `clients_debit_note_${businessId}`, cleanPrefix(prefix, "DN"));

export const nextQuoteNumber = (businessId, prefix = "QUO") =>
  nextNumber(businessId, `clients_quote_${businessId}`, cleanPrefix(prefix, "QUO"));
