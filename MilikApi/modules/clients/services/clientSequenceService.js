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
