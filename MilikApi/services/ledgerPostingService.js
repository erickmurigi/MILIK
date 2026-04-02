import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import { resolvePropertyAccountingContext } from "./propertyAccountingService.js";

const flipDirection = (direction) => (direction === "credit" ? "debit" : "credit");

const normalizeDate = (value, fallback = new Date()) => {
  const date = value ? new Date(value) : new Date(fallback);
  return Number.isNaN(date.getTime()) ? new Date(fallback) : date;
};

const validatePayload = (payload) => {
  const requiredFields = [
    "business",
    "property",
    "sourceTransactionType",
    "sourceTransactionId",
    "transactionDate",
    "statementPeriodStart",
    "statementPeriodEnd",
    "category",
    "amount",
    "direction",
    "createdBy",
  ];

  const missing = requiredFields.filter(
    (field) => payload[field] === undefined || payload[field] === null || payload[field] === ""
  );

  if (missing.length > 0) {
    throw new Error(`Missing ledger payload fields: ${missing.join(", ")}`);
  }
};

const enrichPayloadFromProperty = async (payload = {}) => {
  // Skip enrichment if we already have all required fields
  if (payload.property && payload.landlord && payload.business) {
    return payload;
  }

  const context = await resolvePropertyAccountingContext({
    propertyId: payload.property,
    landlordId: payload.landlord || null,
    businessId: payload.business || null,
  });

  return {
    ...payload,
    business: payload.business || context.businessId,
    property: payload.property || context.propertyId,
    landlord: payload.landlord || context.landlordId,
  };
};

export const postEntry = async (payload) => {
  const resolvedPayload = await enrichPayloadFromProperty(payload);
  validatePayload(resolvedPayload);

  const normalizedAmount = Math.abs(Number(resolvedPayload.amount || 0));
  const normalizedDirection = String(resolvedPayload.direction || "").toLowerCase();
  const debit = normalizedDirection === "debit" ? normalizedAmount : 0;
  const credit = normalizedDirection === "credit" ? normalizedAmount : 0;

  const entry = new FinancialLedgerEntry({
    ...resolvedPayload,
    transactionDate: normalizeDate(resolvedPayload.transactionDate),
    statementPeriodStart: normalizeDate(resolvedPayload.statementPeriodStart),
    statementPeriodEnd: normalizeDate(resolvedPayload.statementPeriodEnd),
    amount: normalizedAmount,
    direction: normalizedDirection,
    debit,
    credit,
    approvedBy: resolvedPayload.approvedBy || resolvedPayload.createdBy || null,
    approvedAt: resolvedPayload.approvedAt || new Date(),
    status: resolvedPayload.status || "approved",
  });

  return entry.save();
};

export const postReversal = async ({ entryId, reason, userId }) => {
  if (!entryId || !userId) {
    throw new Error("postReversal requires entryId and userId");
  }

  const originalEntry = await FinancialLedgerEntry.findById(entryId);
  if (!originalEntry) {
    throw new Error("Ledger entry not found");
  }

  if (originalEntry.reversedByEntry || originalEntry.status === "reversed") {
    throw new Error("Ledger entry already reversed");
  }

  const reversalDirection = flipDirection(originalEntry.direction);

  const reversalEntry = await postEntry({
    business: originalEntry.business,
    property: originalEntry.property,
    landlord: originalEntry.landlord,
    tenant: originalEntry.tenant,
    unit: originalEntry.unit,
    sourceTransactionType: originalEntry.sourceTransactionType,
    sourceTransactionId: originalEntry.sourceTransactionId,
    transactionDate: new Date(),
    statementPeriodStart: originalEntry.statementPeriodStart,
    statementPeriodEnd: originalEntry.statementPeriodEnd,
    category: "REVERSAL",
    accountId: originalEntry.accountId || null,
    journalGroupId: originalEntry.journalGroupId || null,
    amount: originalEntry.amount,
    direction: reversalDirection,
    debit: reversalDirection === "debit" ? Number(originalEntry.amount || 0) : 0,
    credit: reversalDirection === "credit" ? Number(originalEntry.amount || 0) : 0,
    payer: originalEntry.receiver || "n/a",
    receiver: originalEntry.payer || "n/a",
    notes: reason || `Reversal of ledger entry ${originalEntry._id}`,
    reversalOf: originalEntry._id,
    metadata: {
      reversalReason: reason || "Correction",
      reversedEntryCategory: originalEntry.category,
      reversedEntryId: String(originalEntry._id),
      originalAccountId: String(originalEntry.accountId || ""),
      originalJournalGroupId: String(originalEntry.journalGroupId || ""),
      originalMetadata: originalEntry.metadata || {},
    },
    createdBy: userId,
    approvedBy: userId,
    approvedAt: new Date(),
    status: "approved",
  });

  originalEntry.status = "reversed";
  originalEntry.reversedByEntry = reversalEntry._id;
  await originalEntry.save();

  return {
    originalEntry,
    reversalEntry,
  };
};

export const postCorrection = async ({ entryId, correctedPayload, reason, userId }) => {
  if (!entryId || !correctedPayload || !userId) {
    throw new Error("postCorrection requires entryId, correctedPayload, and userId");
  }

  const { originalEntry, reversalEntry } = await postReversal({
    entryId,
    reason: reason || "Correction reversal",
    userId,
  });

  const correctedEntryPayload = {
    ...correctedPayload,
    business: correctedPayload.business || originalEntry.business,
    property: correctedPayload.property || originalEntry.property,
    landlord: correctedPayload.landlord || originalEntry.landlord,
    tenant: correctedPayload.tenant ?? originalEntry.tenant,
    unit: correctedPayload.unit ?? originalEntry.unit,
    sourceTransactionType: correctedPayload.sourceTransactionType || originalEntry.sourceTransactionType,
    sourceTransactionId: correctedPayload.sourceTransactionId || originalEntry.sourceTransactionId,
    transactionDate: correctedPayload.transactionDate || new Date(),
    statementPeriodStart: correctedPayload.statementPeriodStart || originalEntry.statementPeriodStart,
    statementPeriodEnd: correctedPayload.statementPeriodEnd || originalEntry.statementPeriodEnd,
    payer: correctedPayload.payer || originalEntry.payer,
    receiver: correctedPayload.receiver || originalEntry.receiver,
    notes: correctedPayload.notes || `Correction repost after reversal of ${originalEntry._id}`,
    metadata: {
      ...(originalEntry.metadata || {}),
      ...(correctedPayload.metadata || {}),
      correctionOf: String(originalEntry._id),
      reversalEntryId: String(reversalEntry._id),
      correctionReason: reason || "Correction repost",
    },
    createdBy: userId,
    approvedBy: userId,
    approvedAt: new Date(),
    status: correctedPayload.status || "approved",
  };

  const correctedEntry = await postEntry(correctedEntryPayload);

  return {
    originalEntry,
    reversalEntry,
    correctedEntry,
  };
};

export default {
  postEntry,
  postReversal,
  postCorrection,
};