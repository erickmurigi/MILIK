import mongoose from "mongoose";
import { escapeRegex } from "../../utils/escapeRegex.js";
import JournalEntry from "../../models/JournalEntry.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import PaymentVoucher from "../../models/PaymentVoucher.js";
import { postEntry, postReversal } from "../../services/ledgerPostingService.js";
import { aggregateChartOfAccountBalances } from "../../services/chartAccountAggregationService.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";
import { emitToCompany } from "../../utils/socketManager.js";
import {
  resolvePropertyAccountingContext,
  resolveLandlordRemittancePayableAccount,
} from "../../services/propertyAccountingService.js";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const sameId = (left, right) => String(left || "") === String(right || "");
const LANDLORD_FACING_JOURNAL_TYPES = new Set([
  "landlord_credit_adjustment",
  "landlord_debit_adjustment",
  "property_expense_accrual",
]);
const COMPANY_ONLY_JOURNAL_TYPES = new Set(["company_journal"]);
const isLandlordFacingJournalType = (value) =>
  LANDLORD_FACING_JOURNAL_TYPES.has(String(value || "").trim().toLowerCase());

const normalizeDate = (value, fallback = new Date()) => {
  const date = value ? new Date(value) : new Date(fallback);
  return Number.isNaN(date.getTime()) ? new Date(fallback) : date;
};

const buildStatementPeriod = (value) => {
  const dt = normalizeDate(value, new Date());
  const year = dt.getFullYear();
  const month = dt.getMonth();
  return {
    start: new Date(year, month, 1, 0, 0, 0, 0),
    end: new Date(year, month + 1, 0, 23, 59, 59, 999),
  };
};

const resolveBusinessId = async (req) => {
  const direct =
    req?.query?.business ||
    req?.query?.company ||
    req?.body?.business ||
    req?.body?.company ||
    req?.user?.company?._id ||
    req?.user?.company ||
    null;

  if (direct) return direct;

  if (req?.params?.id && isValidObjectId(req.params.id)) {
    const existing = await JournalEntry.findById(req.params.id).select("business").lean();
    if (existing?.business) return existing.business;
  }

  return null;
};

const resolveActorUserId = async (req, businessId) =>
  resolveAuditActorUserId({
    req,
    businessId,
    fallbackErrorMessage: "No valid company user could be resolved for journal posting.",
  });

// Derives the linked property from a debit or credit account's property reference.
// Property-specific sub-accounts (e.g. 2110-PARK) carry account.property = propertyId.
const derivePropertyFromAccounts = async (businessId, debitAccountId, creditAccountId) => {
  const ids = [debitAccountId, creditAccountId].filter(isValidObjectId);
  if (!ids.length) return null;
  const account = await ChartOfAccount.findOne({
    _id: { $in: ids },
    business: businessId,
    property: { $exists: true, $ne: null },
  }).select("property").lean();
  return account?.property || null;
};

const resolveJournalLandlordId = async ({ businessId, payload = {} }) => {
  if (payload?.landlord && isValidObjectId(payload.landlord)) {
    return String(payload.landlord);
  }

  // Prefer explicitly supplied property, then derive from selected accounts
  const propertyId = (payload?.property && isValidObjectId(payload.property))
    ? payload.property
    : await derivePropertyFromAccounts(businessId, payload.debitAccount, payload.creditAccount);

  if (!propertyId) return null;

  const accountingContext = await resolvePropertyAccountingContext({
    propertyId,
    landlordId: null,
    businessId,
  }).catch(() => null);

  return accountingContext?.landlordId ? String(accountingContext.landlordId) : null;
};

const generateJournalNo = async (businessId) => {
  const prefix = "JRN";
  const lastJournal = await JournalEntry.findOne(
    { business: businessId, journalNo: { $regex: `^${prefix}\\d+$` } },
    { journalNo: 1 },
    { sort: { createdAt: -1 } }
  ).lean();

  let seq = 1;
  if (lastJournal?.journalNo) {
    seq = (parseInt(lastJournal.journalNo.replace(prefix, ""), 10) || 0) + 1;
  }

  return `${prefix}${String(seq).padStart(4, "0")}`;
};

const ensurePostingAccount = async ({ businessId, accountId, label }) => {
  if (!accountId || !isValidObjectId(accountId)) {
    throw new Error(`${label} account is required.`);
  }

  const account = await ChartOfAccount.findOne({
    _id: accountId,
    business: businessId,
    isPosting: { $ne: false },
    isHeader: { $ne: true },
  }).lean();

  if (!account) {
    throw new Error(`${label} account not found or is not a posting account.`);
  }

  return account;
};

const validateJournalPayload = async ({ businessId, payload = {} }) => {
  const journalType = String(payload?.journalType || "general_manual_journal").trim().toLowerCase();
  const isCompanyJournal = COMPANY_ONLY_JOURNAL_TYPES.has(journalType);

  if (!payload.debitAccount || !isValidObjectId(payload.debitAccount)) {
    throw new Error("Debit account is required.");
  }

  if (!payload.creditAccount || !isValidObjectId(payload.creditAccount)) {
    throw new Error("Credit account is required.");
  }

  if (String(payload.debitAccount) === String(payload.creditAccount)) {
    throw new Error("Debit and credit accounts must be different.");
  }

  const amount = Number(payload.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Amount must be greater than zero.");
  }

  // Company journals never touch landlord payable or appear on any landlord statement
  if (isCompanyJournal) {
    const [debitAccount, creditAccount] = await Promise.all([
      ensurePostingAccount({ businessId, accountId: payload.debitAccount, label: "Debit" }),
      ensurePostingAccount({ businessId, accountId: payload.creditAccount, label: "Credit" }),
    ]);
    return {
      debitAccount,
      creditAccount,
      amount,
      resolvedLandlordId: null,
      landlordPayableAccount: null,
      normalizedIncludeInStatement: false,
    };
  }

  const normalizedIncludeInStatement =
    journalType === "internal_account_transfer"
      ? false
      : isLandlordFacingJournalType(journalType)
      ? true
      : Boolean(payload?.includeInLandlordStatement);

  const [resolvedLandlordId, [debitAccount, creditAccount], landlordPayableAccount] = await Promise.all([
    resolveJournalLandlordId({
      businessId,
      payload: {
        ...payload,
        journalType,
        includeInLandlordStatement: normalizedIncludeInStatement,
      },
    }),
    Promise.all([
      ensurePostingAccount({ businessId, accountId: payload.debitAccount, label: "Debit" }),
      ensurePostingAccount({ businessId, accountId: payload.creditAccount, label: "Credit" }),
    ]),
    resolveLandlordRemittancePayableAccount(businessId).catch(() => null),
  ]);
  const debitTouchesLandlordPayable = landlordPayableAccount?._id
    ? sameId(payload.debitAccount, landlordPayableAccount._id)
    : false;
  const creditTouchesLandlordPayable = landlordPayableAccount?._id
    ? sameId(payload.creditAccount, landlordPayableAccount._id)
    : false;
  const touchesLandlordPayable = debitTouchesLandlordPayable || creditTouchesLandlordPayable;

  if ((isLandlordFacingJournalType(journalType) || normalizedIncludeInStatement || touchesLandlordPayable) && !resolvedLandlordId) {
    throw new Error("A linked property owner/landlord could not be resolved for this journal.");
  }

  if (debitTouchesLandlordPayable && creditTouchesLandlordPayable) {
    throw new Error("Landlord Remittance Payable can only appear on one side of a journal.");
  }

  if (journalType === "internal_account_transfer" && touchesLandlordPayable) {
    throw new Error("Internal ledger transfers cannot use Landlord Remittance Payable.");
  }

  if (journalType === "landlord_credit_adjustment") {
    if (!landlordPayableAccount?._id) {
      throw new Error("Landlord Remittance Payable account was not found for this business.");
    }
    if (!creditTouchesLandlordPayable || debitTouchesLandlordPayable) {
      throw new Error("Landlord Credit Adjustment must credit Landlord Remittance Payable and debit the balancing account.");
    }
  }

  if (["landlord_debit_adjustment", "property_expense_accrual"].includes(journalType)) {
    if (!landlordPayableAccount?._id) {
      throw new Error("Landlord Remittance Payable account was not found for this business.");
    }
    if (!debitTouchesLandlordPayable || creditTouchesLandlordPayable) {
      const label =
        journalType === "property_expense_accrual"
          ? "Property Expense Accrual"
          : "Landlord Debit Adjustment";
      throw new Error(`${label} must debit Landlord Remittance Payable and credit the balancing account.`);
    }
  }

  if (journalType === "general_manual_journal" && normalizedIncludeInStatement) {
    if (!landlordPayableAccount?._id) {
      throw new Error("Landlord Remittance Payable account was not found for this business.");
    }
    if (debitTouchesLandlordPayable === creditTouchesLandlordPayable) {
      throw new Error(
        "Statement-visible general journals must touch Landlord Remittance Payable on exactly one side so they read as one clean landlord addition or deduction."
      );
    }
  }

  return {
    debitAccount,
    creditAccount,
    amount,
    resolvedLandlordId,
    landlordPayableAccount,
    normalizedIncludeInStatement,
  };
};

const populateJournalQuery = (query) =>
  query
    .populate("property", "propertyName name")
    .populate("landlord", "landlordName name")
    .populate("debitAccount", "code name type group")
    .populate("creditAccount", "code name type group")
    .populate("postedBy", "surname otherNames email")
    .populate("reversedBy", "surname otherNames email")
    .populate("createdBy", "surname otherNames email");

const normalizeJournalPayload = (payload = {}) => {
  const journalType = String(payload?.journalType || "").trim().toLowerCase();
  const includeInLandlordStatement =
    journalType === "internal_account_transfer"
      ? false
      : isLandlordFacingJournalType(journalType)
      ? true
      : Boolean(payload?.includeInLandlordStatement);

  if (journalType !== "internal_account_transfer") {
    return {
      ...payload,
      journalType,
      landlord: payload?.landlord || null,
      includeInLandlordStatement,
    };
  }

  return {
    ...payload,
    journalType,
    landlord: null,
    includeInLandlordStatement: false,
  };
};

const resolveStatementPostingConfig = ({ journal = {}, landlordPayableAccountId = null }) => {
  const journalType = String(journal?.journalType || "").trim().toLowerCase();

  if (COMPANY_ONLY_JOURNAL_TYPES.has(journalType)) {
    return {
      debitLeg: { includeInLandlordStatement: false },
      creditLeg: { includeInLandlordStatement: false },
    };
  }

  const debitTouchesLandlordPayable = landlordPayableAccountId
    ? sameId(journal?.debitAccount?._id || journal?.debitAccount, landlordPayableAccountId)
    : false;
  const creditTouchesLandlordPayable = landlordPayableAccountId
    ? sameId(journal?.creditAccount?._id || journal?.creditAccount, landlordPayableAccountId)
    : false;

  if (journalType === "landlord_credit_adjustment") {
    return {
      debitLeg: { includeInLandlordStatement: false },
      creditLeg: { includeInLandlordStatement: true, statementBucket: "addition" },
    };
  }

  if (["landlord_debit_adjustment", "property_expense_accrual"].includes(journalType)) {
    return {
      debitLeg: { includeInLandlordStatement: true, statementBucket: "deduction" },
      creditLeg: { includeInLandlordStatement: false },
    };
  }

  if (journalType === "general_manual_journal" && journal.includeInLandlordStatement) {
    if (debitTouchesLandlordPayable && !creditTouchesLandlordPayable) {
      return {
        debitLeg: { includeInLandlordStatement: true, statementBucket: "deduction" },
        creditLeg: { includeInLandlordStatement: false },
      };
    }

    if (creditTouchesLandlordPayable && !debitTouchesLandlordPayable) {
      return {
        debitLeg: { includeInLandlordStatement: false },
        creditLeg: { includeInLandlordStatement: true, statementBucket: "addition" },
      };
    }
  }

  return {
    debitLeg: { includeInLandlordStatement: false },
    creditLeg: { includeInLandlordStatement: false },
  };
};

const reverseJournalLedgerEntries = async ({ journal, userId, reason }) => {
  const originalEntries = await FinancialLedgerEntry.find({
    business: journal.business,
    sourceTransactionType: "manual_adjustment",
    sourceTransactionId: String(journal._id),
    $or: [{ reversalOf: { $exists: false } }, { reversalOf: null }],
    status: "approved",
  }).select("_id accountId").lean();

  if (!originalEntries.length) return [];

  const reversalResults = await Promise.all(
    originalEntries.map((entry) =>
      postReversal({
        entryId: entry._id,
        reason: reason || `Reversal of journal ${journal.journalNo}`,
        userId,
      })
    )
  );

  const touchedAccountIds = new Set();
  originalEntries.forEach((entry) => {
    if (entry?.accountId) touchedAccountIds.add(String(entry.accountId));
  });
  reversalResults.forEach((result) => {
    if (result?.reversalEntry?.accountId) {
      touchedAccountIds.add(String(result.reversalEntry.accountId));
    }
  });

  if (touchedAccountIds.size > 0) {
    await aggregateChartOfAccountBalances(journal.business, Array.from(touchedAccountIds));
  }

  return reversalResults;
};

const postJournalToLedger = async ({ journal, actorUserId }) => {
  const existingEntries = await FinancialLedgerEntry.find({
    business: journal.business,
    sourceTransactionType: "manual_adjustment",
    sourceTransactionId: String(journal._id),
    $or: [{ reversalOf: { $exists: false } }, { reversalOf: null }],
    status: "approved",
  }).select("_id").lean();

  if (existingEntries.length > 0) {
    return existingEntries;
  }

  // Derive property from linked sub-account if not explicitly set on the journal
  const resolvedPropertyId = journal.property
    || await derivePropertyFromAccounts(journal.business, journal.debitAccount, journal.creditAccount);

  const isCompanyJournal = COMPANY_ONLY_JOURNAL_TYPES.has(String(journal.journalType || "")) || !resolvedPropertyId;

  const amount = Math.abs(Number(journal.amount || 0));
  const date = normalizeDate(journal.date || new Date());
  const { start, end } = buildStatementPeriod(date);
  const journalGroupId = new mongoose.Types.ObjectId();
  const narration = String(journal.narration || journal.reference || `Journal ${journal.journalNo}`).trim();

  const [accountingContext, landlordPayableAccount] = await Promise.all([
    isCompanyJournal
      ? Promise.resolve({ businessId: String(journal.business), propertyId: null, landlordId: null })
      : resolvePropertyAccountingContext({
          propertyId: resolvedPropertyId,
          landlordId: journal.landlord || null,
          businessId: journal.business,
        }),
    resolveLandlordRemittancePayableAccount(journal.business).catch(() => null),
  ]);
  const statementPostingConfig = resolveStatementPostingConfig({
    journal,
    landlordPayableAccountId: landlordPayableAccount?._id || null,
  });

  const commonPayload = {
    business: accountingContext.businessId,
    property: accountingContext.propertyId,
    landlord: accountingContext.landlordId,
    sourceTransactionType: "manual_adjustment",
    sourceTransactionId: String(journal._id),
    transactionDate: date,
    statementPeriodStart: start,
    statementPeriodEnd: end,
    category: "ADJUSTMENT",
    amount,
    payer: "manager",
    receiver: journal.landlord ? "landlord" : "system",
    notes: narration,
    journalGroupId,
    createdBy: actorUserId,
    approvedBy: actorUserId,
    approvedAt: new Date(),
    status: "approved",
    metadata: {
      journalEntryId: String(journal._id),
      journalNo: journal.journalNo,
      journalType: journal.journalType,
      includeInLandlordStatement: Boolean(journal.includeInLandlordStatement),
      reference: journal.reference || "",
    },
  };

  const debitLeg = await postEntry({
    ...commonPayload,
    accountId: journal.debitAccount,
    direction: "debit",
    debit: amount,
    credit: 0,
    metadata: {
      ...commonPayload.metadata,
      includeInLandlordStatement: Boolean(statementPostingConfig.debitLeg?.includeInLandlordStatement),
      ...(statementPostingConfig.debitLeg?.statementBucket
        ? { statementBucket: statementPostingConfig.debitLeg.statementBucket }
        : {}),
    },
  });

  const creditLeg = await postEntry({
    ...commonPayload,
    accountId: journal.creditAccount,
    direction: "credit",
    debit: 0,
    credit: amount,
    metadata: {
      ...commonPayload.metadata,
      includeInLandlordStatement: Boolean(statementPostingConfig.creditLeg?.includeInLandlordStatement),
      ...(statementPostingConfig.creditLeg?.statementBucket
        ? { statementBucket: statementPostingConfig.creditLeg.statementBucket }
        : {}),
    },
  });

  journal.status = "posted";
  journal.postedAt = new Date();
  journal.postedBy = actorUserId;
  journal.journalGroupId = journalGroupId;
  journal.ledgerEntries = [debitLeg._id, creditLeg._id];
  await journal.save();

  await aggregateChartOfAccountBalances(journal.business, [
    String(journal.debitAccount),
    String(journal.creditAccount),
  ]);

  return [debitLeg, creditLeg];
};

export const createJournalEntry = async (req, res, next) => {
  try {
    const businessId = await resolveBusinessId(req);
    if (!businessId) {
      return res.status(400).json({ success: false, message: "User must have a company context" });
    }

    const normalizedPayload = normalizeJournalPayload(req.body || {});

    const [actorUserId, { resolvedLandlordId, normalizedIncludeInStatement }, journalNo] = await Promise.all([
      resolveActorUserId(req, businessId),
      validateJournalPayload({ businessId, payload: normalizedPayload }),
      generateJournalNo(businessId),
    ]);

    // Derive property from selected accounts when not explicitly provided
    const derivedProperty = normalizedPayload.property
      || await derivePropertyFromAccounts(businessId, normalizedPayload.debitAccount, normalizedPayload.creditAccount);

    const journal = await JournalEntry.create({
      journalNo,
      date: normalizedPayload.date,
      journalType: normalizedPayload.journalType,
      property: derivedProperty || null,
      landlord: resolvedLandlordId || null,
      debitAccount: normalizedPayload.debitAccount,
      creditAccount: normalizedPayload.creditAccount,
      amount: Number(normalizedPayload.amount || 0),
      reference: normalizedPayload.reference || "",
      narration: normalizedPayload.narration || "",
      includeInLandlordStatement: Boolean(normalizedIncludeInStatement),
      sourceModule: String(normalizedPayload.sourceModule || "propertyManagement"),
      status: "draft",
      createdBy: actorUserId,
      business: businessId,
    });

    emitToCompany(businessId, "journal:new", { journalId: journal._id });

    const populated = await populateJournalQuery(JournalEntry.findById(journal._id)).lean();
    return res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
};

export const getJournalEntries = async (req, res, next) => {
  try {
    const business = await resolveBusinessId(req);
    if (!business) {
      return res.status(400).json({ success: false, message: "User must have a company context" });
    }

    const { status, journalType, property, landlord, sourceModule, excludeSourceModules, startDate, endDate, search, page = 1, limit = 5000 } = req.query;
    const filter = { business };

    if (status && status !== "all") filter.status = status;
    if (journalType && journalType !== "all") filter.journalType = journalType;
    if (property && property !== "all") filter.property = property;
    if (landlord && landlord !== "all") filter.landlord = landlord;
    if (sourceModule && sourceModule !== "all") {
      filter.sourceModule = sourceModule;
    } else if (excludeSourceModules) {
      const toExclude = String(excludeSourceModules).split(",").map((s) => s.trim()).filter(Boolean);
      if (toExclude.length > 0) filter.sourceModule = { $nin: toExclude };
    }

    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(new Date(startDate).setHours(0, 0, 0, 0));
      if (endDate) filter.date.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
    }

    if (search) {
      const term = escapeRegex(String(search).trim());
      filter.$or = [
        { journalNo: { $regex: term, $options: "i" } },
        { reference: { $regex: term, $options: "i" } },
        { narration: { $regex: term, $options: "i" } },
      ];
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

    const [rows, total] = await Promise.all([
      populateJournalQuery(
        JournalEntry.find(filter)
          .sort({ date: -1, createdAt: -1 })
          .skip((pageNum - 1) * limitNum)
          .limit(limitNum)
      ).lean(),
      JournalEntry.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: rows,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    next(err);
  }
};

export const getJournalEntry = async (req, res, next) => {
  try {
    const business = await resolveBusinessId(req);
    if (!business) {
      return res.status(400).json({ success: false, message: "User must have a company context" });
    }

    const journal = await populateJournalQuery(
      JournalEntry.findOne({
        _id: req.params.id,
        business,
      })
    ).lean();

    if (!journal) {
      return res.status(404).json({ success: false, message: "Journal not found" });
    }

    return res.status(200).json(journal);
  } catch (err) {
    next(err);
  }
};

export const updateJournalEntry = async (req, res, next) => {
  try {
    const businessId = await resolveBusinessId(req);
    if (!businessId) {
      return res.status(400).json({ success: false, message: "User must have a company context" });
    }

    const existing = await JournalEntry.findOne({
      _id: req.params.id,
      business: businessId,
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: "Journal not found" });
    }

    if (existing.status !== "draft") {
      return res.status(400).json({
        success: false,
        message: "Only draft journals can be edited",
      });
    }

    const normalizedPayload = normalizeJournalPayload({
      ...existing.toObject(),
      ...(req.body || {}),
    });

    const { resolvedLandlordId, normalizedIncludeInStatement } = await validateJournalPayload({
      businessId,
      payload: normalizedPayload,
    });

    existing.date = normalizedPayload.date || existing.date;
    existing.journalType = normalizedPayload.journalType || existing.journalType;
    existing.property = normalizedPayload.property || existing.property;
    existing.landlord = resolvedLandlordId || null;
    existing.debitAccount = normalizedPayload.debitAccount || existing.debitAccount;
    existing.creditAccount = normalizedPayload.creditAccount || existing.creditAccount;
    existing.amount = Number(normalizedPayload.amount || existing.amount || 0);
    existing.reference = normalizedPayload.reference || "";
    existing.narration = normalizedPayload.narration || "";
    existing.includeInLandlordStatement = Boolean(normalizedIncludeInStatement);

    await existing.save();

    emitToCompany(businessId, "journal:updated", { journalId: existing._id });

    const populated = await populateJournalQuery(JournalEntry.findById(existing._id)).lean();
    return res.status(200).json(populated);
  } catch (err) {
    next(err);
  }
};

export const postJournalEntry = async (req, res, next) => {
  try {
    const businessId = await resolveBusinessId(req);
    if (!businessId) {
      return res.status(400).json({ success: false, message: "User must have a company context" });
    }

    const journal = await JournalEntry.findOne({
      _id: req.params.id,
      business: businessId,
    });

    if (!journal) {
      return res.status(404).json({ success: false, message: "Journal not found" });
    }

    if (journal.status !== "draft") {
      return res.status(400).json({ success: false, message: "Only draft journals can be posted" });
    }

    const actorUserId = await resolveActorUserId(req, businessId);

    await postJournalToLedger({ journal, actorUserId });

    emitToCompany(businessId, "journal:posted", { journalId: journal._id });

    const populated = await populateJournalQuery(JournalEntry.findById(journal._id)).lean();
    return res.status(200).json(populated);
  } catch (err) {
    next(err);
  }
};

export const reverseJournalEntry = async (req, res, next) => {
  try {
    const businessId = await resolveBusinessId(req);
    if (!businessId) {
      return res.status(400).json({ success: false, message: "User must have a company context" });
    }

    const journal = await JournalEntry.findOne({
      _id: req.params.id,
      business: businessId,
    });

    if (!journal) {
      return res.status(404).json({ success: false, message: "Journal not found" });
    }

    if (journal.status !== "posted") {
      return res.status(400).json({ success: false, message: "Only posted journals can be reversed" });
    }

    if (journal.reversedAt) {
      return res.status(400).json({ success: false, message: "Journal is already reversed" });
    }

    const actorUserId = await resolveActorUserId(req, businessId);
    const reason = String(req.body?.reason || "").trim();

    await reverseJournalLedgerEntries({
      journal,
      userId: actorUserId,
      reason,
    });

    journal.status = "reversed";
    journal.reversedAt = new Date();
    journal.reversedBy = actorUserId;
    journal.reversalReason = reason || "Journal reversed";
    await journal.save();

    emitToCompany(businessId, "journal:reversed", { journalId: journal._id });

    const populated = await populateJournalQuery(JournalEntry.findById(journal._id)).lean();
    return res.status(200).json(populated);
  } catch (err) {
    next(err);
  }
};

export const deleteJournalEntry = async (req, res, next) => {
  try {
    const businessId = await resolveBusinessId(req);
    if (!businessId) {
      return res.status(400).json({ success: false, message: "User must have a company context" });
    }

    const journal = await JournalEntry.findOne({
      _id: req.params.id,
      business: businessId,
    });

    if (!journal) {
      return res.status(404).json({ success: false, message: "Journal not found" });
    }

    if (journal.status !== "draft") {
      return res.status(400).json({ success: false, message: "Only draft journals can be deleted" });
    }

    await JournalEntry.deleteOne({ _id: journal._id });

    emitToCompany(businessId, "journal:deleted", { journalId: journal._id });

    return res.status(200).json({ success: true, message: "Journal deleted successfully" });
  } catch (err) {
    next(err);
  }
};

export const getJournalPostingPreview = async (req, res, next) => {
  try {
    const businessId = await resolveBusinessId(req);
    if (!businessId) {
      return res.status(400).json({ success: false, message: "User must have a company context" });
    }

    await validateJournalPayload({
      businessId,
      payload: req.body || {},
    });

    const [debitAccount, creditAccount] = await Promise.all([
      ChartOfAccount.findById(req.body.debitAccount).select("code name type group").lean(),
      ChartOfAccount.findById(req.body.creditAccount).select("code name type group").lean(),
    ]);

    const amount = Number(req.body.amount || 0);
    const date = normalizeDate(req.body.date || new Date());

    return res.status(200).json({
      success: true,
      preview: {
        date,
        amount,
        journalType: req.body.journalType || "general_manual_journal",
        reference: req.body.reference || "",
        narration: req.body.narration || "",
        lines: [
          {
            direction: "debit",
            account: debitAccount,
            amount,
          },
          {
            direction: "credit",
            account: creditAccount,
            amount,
          },
        ],
      },
    });
  } catch (err) {
    next(err);
  }
};

export const createJournalFromVoucher = async (req, res, next) => {
  try {
    const businessId = await resolveBusinessId(req);
    if (!businessId) {
      return res.status(400).json({ success: false, message: "User must have a company context" });
    }

    const voucher = await PaymentVoucher.findOne({
      _id: req.params.voucherId,
      business: businessId,
    }).lean();

    if (!voucher) {
      return res.status(404).json({ success: false, message: "Voucher not found" });
    }

    const actorUserId = await resolveActorUserId(req, businessId);
    const journalNo = await generateJournalNo(businessId);

    const journal = await JournalEntry.create({
      journalNo,
      date: voucher.voucherDate || new Date(),
      journalType: "general_manual_journal",
      property: voucher.property || null,
      landlord: voucher.landlord || null,
      debitAccount: voucher.debitAccount,
      creditAccount: voucher.creditAccount,
      amount: Number(voucher.amount || 0),
      reference: voucher.voucherNumber || "",
      narration: voucher.description || "",
      includeInLandlordStatement: Boolean(req.body.includeInLandlordStatement),
      status: "draft",
      createdBy: actorUserId,
      business: businessId,
    });

    emitToCompany(businessId, "journal:new", { journalId: journal._id });

    const populated = await populateJournalQuery(JournalEntry.findById(journal._id)).lean();
    return res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
};

export const postJournalEntryAction = postJournalEntry;
export const reverseJournalEntryAction = reverseJournalEntry;

// ─── APPROVAL WORKFLOW ────────────────────────────────────────────────────────
// Submit draft for review (creator does this)
export const submitJournalForReview = async (req, res, next) => {
  try {
    const businessId = await resolveBusinessId(req);
    const journal = await JournalEntry.findOne({ _id: req.params.id, business: businessId });
    if (!journal) return res.status(404).json({ message: "Journal not found" });
    if (journal.status !== "draft")
      return res.status(400).json({ message: "Only draft journals can be submitted for review" });
    if (journal.approvalStatus === "approved")
      return res.status(400).json({ message: "Journal is already approved" });

    journal.approvalStatus = "pending_review";
    await journal.save();

    emitToCompany(businessId, "journal:submitted", { journalId: journal._id });
    const populated = await populateJournalQuery(JournalEntry.findById(journal._id)).lean();
    return res.status(200).json(populated);
  } catch (err) {
    next(err);
  }
};

// Reviewer marks as reviewed (senior accountant does this)
export const reviewJournalEntry = async (req, res, next) => {
  try {
    const businessId = await resolveBusinessId(req);
    const actorUserId = await resolveActorUserId(req, businessId);
    const journal = await JournalEntry.findOne({ _id: req.params.id, business: businessId });
    if (!journal) return res.status(404).json({ message: "Journal not found" });
    if (journal.approvalStatus !== "pending_review")
      return res.status(400).json({ message: "Journal is not pending review" });

    journal.approvalStatus = "reviewed";
    journal.reviewedBy = actorUserId;
    journal.reviewedAt = new Date();
    await journal.save();

    emitToCompany(businessId, "journal:reviewed", { journalId: journal._id });
    const populated = await populateJournalQuery(JournalEntry.findById(journal._id)).lean();
    return res.status(200).json(populated);
  } catch (err) {
    next(err);
  }
};

// Approver signs off — after this the journal can be posted (CFO/finance manager)
export const approveJournalEntry = async (req, res, next) => {
  try {
    const businessId = await resolveBusinessId(req);
    const actorUserId = await resolveActorUserId(req, businessId);
    const journal = await JournalEntry.findOne({ _id: req.params.id, business: businessId });
    if (!journal) return res.status(404).json({ message: "Journal not found" });
    if (!["pending_review", "reviewed"].includes(journal.approvalStatus))
      return res.status(400).json({ message: "Journal must be pending review or reviewed before approval" });
    if (journal.status !== "draft")
      return res.status(400).json({ message: "Only draft journals can be approved" });

    journal.approvalStatus = "approved";
    journal.approvedByUser = actorUserId;
    journal.approvedByUserAt = new Date();
    await journal.save();

    emitToCompany(businessId, "journal:approved", { journalId: journal._id });
    const populated = await populateJournalQuery(JournalEntry.findById(journal._id)).lean();
    return res.status(200).json(populated);
  } catch (err) {
    next(err);
  }
};

// Reject — sends back to draft for correction
export const rejectJournalEntry = async (req, res, next) => {
  try {
    const { reason } = req.body || {};
    if (!reason || !String(reason).trim())
      return res.status(400).json({ message: "A rejection reason is required" });

    const businessId = await resolveBusinessId(req);
    const actorUserId = await resolveActorUserId(req, businessId);
    const journal = await JournalEntry.findOne({ _id: req.params.id, business: businessId });
    if (!journal) return res.status(404).json({ message: "Journal not found" });
    if (!["pending_review", "reviewed"].includes(journal.approvalStatus))
      return res.status(400).json({ message: "Only journals under review can be rejected" });

    journal.approvalStatus = "rejected";
    journal.rejectedBy = actorUserId;
    journal.rejectedAt = new Date();
    journal.rejectionReason = String(reason).trim();
    await journal.save();

    emitToCompany(businessId, "journal:rejected", { journalId: journal._id });
    const populated = await populateJournalQuery(JournalEntry.findById(journal._id)).lean();
    return res.status(200).json(populated);
  } catch (err) {
    next(err);
  }
};

export default {
  createJournalEntry,
  getJournalEntries,
  getJournalEntry,
  updateJournalEntry,
  postJournalEntry,
  postJournalEntryAction,
  reverseJournalEntry,
  reverseJournalEntryAction,
  deleteJournalEntry,
  getJournalPostingPreview,
  createJournalFromVoucher,
};