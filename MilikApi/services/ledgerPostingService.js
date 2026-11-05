import mongoose from "mongoose";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import AccountingPeriod from "../models/AccountingPeriod.js";
import { currentUserKey } from "../utils/requestScope.js";
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

// dimensions.{saleProject,saleDeal,saleListing,costCentre} are ObjectId-typed, default null — but a
// caller passing "" instead of omitting the field (e.g. a cleared-but-not-nulled form field) gets
// stored as the literal string "" with no error, since document CONSTRUCTION doesn't cast-validate
// eagerly. That silently poisons the entry: any LATER save of the same shape — a reversal copying
// `dimensions` straight off the original, exactly what postReversal does — fails validation with a
// Cast-to-ObjectId error. Sanitizing here, at the single chokepoint every entry (original or
// reversal) is posted through, stops this invalid shape from ever being persisted again.
const OBJECT_ID_DIMENSION_FIELDS = ["saleProject", "saleDeal", "saleListing", "costCentre"];
const sanitizeDimensions = (dimensions) => {
  if (!dimensions || typeof dimensions !== "object") return dimensions;
  const sanitized = { ...dimensions };
  for (const field of OBJECT_ID_DIMENSION_FIELDS) {
    const value = sanitized[field];
    if (value == null) continue; // already null/undefined — leave as-is
    if (value === "" || !mongoose.Types.ObjectId.isValid(String(value))) {
      sanitized[field] = null;
    }
  }
  return sanitized;
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

// Throws when the date falls in a closed or locked period. A closed (not locked) period lets one user
// post into it while a posting window opened for them is still running — see openPostingWindow in
// accountingPeriodService.js. Exported for modules that write ledger rows without postEntry.
export const assertPeriodOpen = async (businessId, transactionDate) => {
  if (!businessId || !transactionDate) return;
  const date = new Date(transactionDate);
  const blocked = await AccountingPeriod.findOne({
    business: businessId,
    status: { $in: ["closed", "locked"] },
    startDate: { $lte: date },
    endDate: { $gte: date },
  }).select("name status startDate endDate postingWindows").lean();
  if (!blocked) return;

  if (blocked.status === "closed") {
    const userKey = currentUserKey();
    const now = Date.now();
    if (userKey && (blocked.postingWindows || []).some((w) => w.userKey === userKey && new Date(w.until).getTime() > now)) return;
  }

  const range = `(${blocked.startDate.toISOString().slice(0, 10)} – ${blocked.endDate.toISOString().slice(0, 10)})`;
  throw createError(400,
    blocked.status === "locked"
      ? `Cannot post to the locked period "${blocked.name}" ${range}. Locked periods are final: post to a later date.`
      : `Cannot post to the closed period "${blocked.name}" ${range}. Reopen it, open a short posting window on it (Accounting Periods), or post to a different date.`
  );
};

const checkPeriodLock = assertPeriodOpen;

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
    dimensions: sanitizeDimensions(resolvedPayload.dimensions),
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

/**
 * Posts the legs of one journal in order, inside a single Mongo transaction, so a journal is never left
 * half-posted. The previous implementation posted legs sequentially and, on failure, tried to reverse
 * whatever had already been pushed onto a `posted` array — but a leg that ghost-writes (the insert
 * commits on the server while the driver's write-acknowledgment is lost, so the `await postEntry(...)`
 * call itself still throws) never gets pushed onto `posted` at all, so that catch block could never see
 * it, let alone reverse it: a permanent, orphaned, one-sided GL entry. Wrapping the whole loop in one
 * transaction removes the need for any of that — MongoDB itself rolls back every write made inside an
 * aborted transaction, ghost-written inserts included, so either every leg survives or none do.
 *
 * Pass an existing `session` when the caller already has one open (e.g. its own `withTransaction` block
 * that also needs to `.save()` a parent record alongside these legs) so postEntries joins it instead of
 * opening a nested, independent transaction. With no session passed, postEntries creates, manages, and
 * ends its own — the external contract is unchanged either way: resolves to the array of posted entries
 * on success, throws on failure with nothing left behind.
 */
export const postEntries = async (payloads = [], { session: externalSession = null } = {}) => {
  const postAll = async (session) => {
    const posted = [];
    for (const payload of payloads) {
      posted.push(await postEntry({ ...payload, session }));
    }
    return posted;
  };

  if (externalSession) {
    return postAll(externalSession);
  }

  const session = await mongoose.startSession();
  try {
    let posted;
    await session.withTransaction(async () => {
      posted = await postAll(session);
    });
    return posted;
  } finally {
    await session.endSession();
  }
};

export const postReversal = async ({ entryId, reason, userId, session = null }) => {
  if (!entryId) {
    throw createError(400, "postReversal requires entryId");
  }

  // Atomically claim the entry for reversal BEFORE reading anything else — flips
  // status approved -> reversed in one update, conditioned on it still being "approved". Two
  // concurrent calls to postReversal for the SAME entry (e.g. two overlapping delete-invoice
  // requests racing — a real production incident: a double-click or a re-run script landed two
  // overlapping deleteTenantInvoice calls on the same invoice, and the old read-then-check-then-write
  // version let both calls see "not yet reversed" before either had written, so both posted a
  // reversal — one original leg ended up reversed twice, the other once, breaking the GL balance)
  // can no longer both succeed: only the call whose updateOne actually matches a document gets to
  // proceed, the other sees matchedCount 0 and is correctly told the entry is already reversed.
  const claimResult = await FinancialLedgerEntry.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(String(entryId)), status: "approved", reversedByEntry: null },
    { $set: { status: "reversed" } },
    session ? { session } : undefined
  );

  if (claimResult.matchedCount === 0) {
    const exists = await FinancialLedgerEntry.findById(entryId).session(session || null).lean();
    if (!exists) throw createError(404, "Ledger entry not found");
    throw createError(400, "Ledger entry already reversed");
  }

  // .lean() deliberately — hydrating a full Mongoose document re-casts every path, including
  // dimensions.*, and throws on any pre-existing entry that already has an invalid value there
  // (e.g. dimensions.costCentre stored as "" instead of null). A reversal must still be postable
  // for an entry whose dimensions are already corrupted; sanitizing happens below before reposting.
  // Status here already reads "reversed" — that's this call's own claim above, not a race.
  const originalEntry = await FinancialLedgerEntry.findById(entryId).session(session || null).lean();

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

  let reversalEntry;
  try {
    reversalEntry = await postEntry({
      session,
      allowInactiveAccount:  true,
      business:              originalEntry.business,
      dimensions:            originalEntry.dimensions,
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
  } catch (postError) {
    // The claim above already flipped status to "reversed" — if the reversal entry itself never
    // gets created, that leaves the original stuck "reversed" with nothing actually reversing it.
    // Un-claim it so it's postable again instead of silently disappearing from the GL.
    await FinancialLedgerEntry.collection.updateOne(
      { _id: originalEntry._id, status: "reversed", reversedByEntry: null },
      { $set: { status: "approved" } },
      session ? { session } : undefined
    );
    throw postError;
  }

  originalEntry.status           = "reversed";
  originalEntry.reversedByEntry  = reversalEntry._id;
  if (!originalEntry.journalGroupId) originalEntry.journalGroupId = groupId;

  // FinancialLedgerEntry blocks every Mongoose query-style update (pre("updateOne")/
  // pre("findOneAndUpdate") below in the model — "use reversal entries instead"), and the original
  // code's own `.save()` only got away with mutating these three link fields because a full
  // document re-hydrate+save isn't a Query at all. That re-hydration is exactly what throws on an
  // already-corrupted dimensions.* value (see the .lean() read above), so update through the raw
  // driver collection instead — it bypasses Mongoose entirely, immutability guard included, which
  // is fine here: this is the one sanctioned internal mutation (linking a reversal), not a rewrite
  // of the entry's financial meaning. status is already "reversed" from the atomic claim above —
  // this just links reversedByEntry/journalGroupId, it isn't what makes the reversal exclusive.
  await FinancialLedgerEntry.collection.updateOne(
    { _id: originalEntry._id },
    {
      $set: {
        status: originalEntry.status,
        reversedByEntry: originalEntry.reversedByEntry,
        journalGroupId: originalEntry.journalGroupId,
      },
    },
    session ? { session } : undefined
  );

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
    // Defaults to the SAME group the reversal above was just posted into — a caller that doesn't
    // supply its own journalGroupId (the chart-of-accounts "reclassify" endpoint never has — it only
    // ever passes entryId/reason/correctedPayload) used to leave the corrected entry with no group
    // at all. That's not just cosmetic: the GL integrity report's per-group balance check only
    // looks at entries that HAVE a journalGroupId, so a correction's other leg silently fell outside
    // every balance check — invisible to both the per-group check (wrong journalGroupId) and,
    // combined with a separate bug in the report's overall-total query, miscounted there too. A real
    // production instance of exactly this (a landlord-advancement bank-account reclassification)
    // was found this way and is what prompted this fix.
    journalGroupId: correctedPayload.journalGroupId || reversalEntry.journalGroupId,
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