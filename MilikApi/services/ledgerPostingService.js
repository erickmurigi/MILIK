import mongoose from "mongoose";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import AccountingPeriod from "../models/AccountingPeriod.js";
import { resolvePropertyAccountingContext } from "./propertyAccountingService.js";
import { createError } from "../utils/error.js";

const flipDirection = (direction) => (direction === "credit" ? "debit" : "credit");

const toObjectIdString = (value) => {
  const raw = typeof value === "object" && value?._id ? value._id : value;
  if (!raw || !mongoose.Types.ObjectId.isValid(String(raw))) return "";
  return String(raw);
};

const normalizeDate = (value, fallback = new Date()) => {
  const date = value ? new Date(value) : new Date(fallback);
  return Number.isNaN(date.getTime()) ? new Date(fallback) : date;
};

const validatePayload = (payload) => {
  const requiredFields = [
    "business",
    "sourceTransactionType",
    "sourceTransactionId",
    "transactionDate",
    "statementPeriodStart",
    "statementPeriodEnd",
    "category",
    "amount",
    "direction",
  ];

  const missing = requiredFields.filter(
    (field) => payload[field] === undefined || payload[field] === null || payload[field] === ""
  );

  if (missing.length > 0) {
    throw createError(400, `Missing ledger payload fields: ${missing.join(", ")}`);
  }

  const amount = Number(payload.amount || 0);
  if (!Number.isFinite(amount) || Math.abs(amount) <= 0) {
    throw createError(400, "Ledger entry amount must be greater than zero.");
  }

  const direction = String(payload.direction || "").toLowerCase();
  if (!["debit", "credit"].includes(direction)) {
    throw createError(400, "Ledger entry direction must be debit or credit.");
  }
};

const validatePostingAccount = async (payload = {}) => {
  if (payload.allowNoAccount === true) return null;

  const businessId = toObjectIdString(payload.business);
  const accountId = toObjectIdString(payload.accountId);

  if (!accountId) {
    throw createError(400, "A valid posting account is required before saving a ledger entry.");
  }

  if (!businessId) {
    throw createError(400, "A valid business id is required before saving a ledger entry.");
  }

  const account = await ChartOfAccount.findOne({
    _id: accountId,
    business: businessId,
  }).select("_id code name type active isActive isPosting isHeader").lean();

  if (!account) {
    throw createError(400, "Selected posting account was not found in this company chart of accounts.");
  }

  if (account.isPosting === false || account.isHeader === true) {
    throw createError(400, `Account ${account.code || account.name || accountId} is a header/non-posting account and cannot receive ledger entries.`);
  }

  // An inactive account takes no NEW postings, but a reversal must always be able to undo what was posted before it was switched off.
  if (!payload.allowInactiveAccount && (account.active === false || account.isActive === false)) {
    throw createError(400, `Account ${account.code || account.name || accountId} is inactive and cannot receive new ledger entries.`);
  }

  return account;
};

const enrichPayloadFromProperty = async (payload = {}) => {
  // Allow business-level journaling when explicitly requested and no property context exists.
  if (payload.business && payload.allowUnscoped === true && !payload.property) {
    return payload;
  }

  // Skip enrichment if we already have all required property-scoped fields.
  if (payload.property && payload.landlord && payload.business) {
    return payload;
  }

  if (!payload.property) {
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

const checkPeriodLock = async (businessId, transactionDate) => {
  if (!businessId || !transactionDate) return;
  const date = new Date(transactionDate);
  const blocked = await AccountingPeriod.findOne({
    business: businessId,
    status: { $in: ["closed", "locked"] },
    startDate: { $lte: date },
    endDate: { $gte: date },
  }).select("name status startDate endDate").lean();
  if (blocked) {
    throw createError(400, 
      `Cannot post to a ${blocked.status} period "${blocked.name}" ` +
      `(${blocked.startDate.toISOString().slice(0, 10)} – ${blocked.endDate.toISOString().slice(0, 10)}). ` +
      `Reopen the period or post to a different date.`
    );
  }
};

export const postEntry = async (payload = {}) => {
  const { session = null, ...entryPayload } = payload || {};
  const resolvedPayload = await enrichPayloadFromProperty(entryPayload);
  validatePayload(resolvedPayload);
  await checkPeriodLock(
    toObjectIdString(resolvedPayload.business),
    resolvedPayload.transactionDate
  );
  await validatePostingAccount(resolvedPayload);

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

  return entry.save(session ? { session } : undefined);
};

export const postReversal = async ({ entryId, reason, userId, session = null }) => {
  if (!entryId) {
    throw createError(400, "postReversal requires entryId");
  }

  const originalEntry = await FinancialLedgerEntry.findById(entryId).session(session || null);
  if (!originalEntry) {
    throw createError(404, "Ledger entry not found");
  }

  if (originalEntry.reversedByEntry || originalEntry.status === "reversed") {
    throw createError(400, "Ledger entry already reversed");
  }

  // Guarantee the original has a journalGroupId before reversing.
  // If it was posted without one (pre-fix entries), create a shared group now so
  // both the original and its reversal end up in the same group — keeping the
  // GL integrity report from treating the reversal as an orphan.
  const groupId = originalEntry.journalGroupId || new mongoose.Types.ObjectId();

  // statementPeriod must reflect when the reversal is posted (today), not the original
  // entry's period — otherwise period-based P&L reports will double-count the original period.
  const reversalDate = new Date();
  const reversalPeriodStart = new Date(reversalDate.getFullYear(), reversalDate.getMonth(), 1, 0, 0, 0, 0);
  const reversalPeriodEnd   = new Date(reversalDate.getFullYear(), reversalDate.getMonth() + 1, 0, 23, 59, 59, 999);

  const reversalEntry = await postEntry({
    session,
    allowInactiveAccount:  true,
    business:              originalEntry.business,
    dimensions:            originalEntry.toObject().dimensions,
    property:              originalEntry.property,
    landlord:              originalEntry.landlord,
    tenant:                originalEntry.tenant,
    unit:                  originalEntry.unit,
    sourceTransactionType: originalEntry.sourceTransactionType,
    sourceTransactionId:   originalEntry.sourceTransactionId,
    transactionDate:       reversalDate,
    statementPeriodStart:  reversalPeriodStart,
    statementPeriodEnd:    reversalPeriodEnd,
    category:              "REVERSAL",
    accountId:             originalEntry.accountId || null,
    journalGroupId:        groupId,
    amount:                originalEntry.amount,
    direction:             flipDirection(originalEntry.direction),
    payer:                 originalEntry.receiver || "n/a",
    receiver:              originalEntry.payer   || "n/a",
    notes:                 reason || `Reversal of ledger entry ${originalEntry._id}`,
    reversalOf:            originalEntry._id,
    metadata: {
      reversalReason:          reason || "Correction",
      reversedEntryCategory:   originalEntry.category,
      reversedEntryId:         String(originalEntry._id),
      originalAccountId:       String(originalEntry.accountId   || ""),
      originalJournalGroupId:  String(originalEntry.journalGroupId || ""),
      originalMetadata:        originalEntry.metadata || {},
    },
    createdBy:  userId,
    approvedBy: userId,
    approvedAt: new Date(),
    status:     "approved",
  });

  originalEntry.status           = "reversed";
  originalEntry.reversedByEntry  = reversalEntry._id;
  if (!originalEntry.journalGroupId) originalEntry.journalGroupId = groupId;
  await originalEntry.save(session ? { session } : undefined);

  return { originalEntry, reversalEntry };
};

export const postCorrection = async ({ entryId, correctedPayload, reason, userId, session = null }) => {
  if (!entryId || !correctedPayload || !userId) {
    throw createError(400, "postCorrection requires entryId, correctedPayload, and userId");
  }

  const { originalEntry, reversalEntry } = await postReversal({
    entryId,
    reason: reason || "Correction reversal",
    userId,
    session,
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

  const correctedEntry = await postEntry({
    ...correctedEntryPayload,
    session,
  });

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