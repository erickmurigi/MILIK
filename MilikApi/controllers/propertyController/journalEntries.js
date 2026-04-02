import mongoose from "mongoose";
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
  if (!payload.property || !isValidObjectId(payload.property)) {
    throw new Error("Property is required.");
  }

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

  if (
    ["landlord_credit_adjustment", "landlord_debit_adjustment"].includes(payload.journalType) &&
    !payload.landlord
  ) {
    throw new Error("Landlord is required for landlord journal types.");
  }

  const [debitAccount, creditAccount] = await Promise.all([
    ensurePostingAccount({
      businessId,
      accountId: payload.debitAccount,
      label: "Debit",
    }),
    ensurePostingAccount({
      businessId,
      accountId: payload.creditAccount,
      label: "Credit",
    }),
  ]);

  const landlordPayable = await resolveLandlordRemittancePayableAccount(businessId).catch(() => null);

  if (landlordPayable?._id) {
    const touchesLandlordPayable =
      String(payload.debitAccount) === String(landlordPayable._id) ||
      String(payload.creditAccount) === String(landlordPayable._id);

    if (touchesLandlordPayable && !payload.landlord) {
      throw new Error("Landlord is required when journal touches Landlord Payable.");
    }
  }

  return {
    debitAccount,
    creditAccount,
    amount,
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

const resolveStatementPostingConfig = (journal = {}) => {
  const journalType = String(journal?.journalType || "").trim().toLowerCase();

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
    return {
      debitLeg: { includeInLandlordStatement: true },
      creditLeg: { includeInLandlordStatement: true },
    };
  }

  return {
    debitLeg: { includeInLandlordStatement: Boolean(journal.includeInLandlordStatement) },
    creditLeg: { includeInLandlordStatement: Boolean(journal.includeInLandlordStatement) },
  };
};

const reverseJournalLedgerEntries = async ({ journal, userId, reason }) => {
  const originalEntries = await FinancialLedgerEntry.find({
    business: journal.business,
    sourceTransactionType: "manual_adjustment",
    sourceTransactionId: String(journal._id),
    reversalOf: null,
    status: "approved",
  }).select("_id accountId");

  if (!originalEntries.length) return [];

  const reversalResults = [];
  for (const entry of originalEntries) {
    const result = await postReversal({
      entryId: entry._id,
      reason: reason || `Reversal of journal ${journal.journalNo}`,
      userId,
    });
    reversalResults.push(result);
  }

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
    reversalOf: null,
    status: "approved",
  }).select("_id");

  if (existingEntries.length > 0) {
    return existingEntries;
  }

  const accountingContext = await resolvePropertyAccountingContext({
    propertyId: journal.property,
    landlordId: journal.landlord || null,
    businessId: journal.business,
  });

  const amount = Math.abs(Number(journal.amount || 0));
  const date = normalizeDate(journal.date || new Date());
  const { start, end } = buildStatementPeriod(date);
  const journalGroupId = new mongoose.Types.ObjectId();
  const narration = String(journal.narration || journal.reference || `Journal ${journal.journalNo}`).trim();

  const statementPostingConfig = resolveStatementPostingConfig(journal);

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

    const actorUserId = await resolveActorUserId(req, businessId);

    await validateJournalPayload({
      businessId,
      payload: req.body || {},
    });

    const journalNo = await generateJournalNo(businessId);

    const journal = await JournalEntry.create({
      journalNo,
      date: req.body.date,
      journalType: req.body.journalType,
      property: req.body.property,
      landlord: req.body.landlord || null,
      debitAccount: req.body.debitAccount,
      creditAccount: req.body.creditAccount,
      amount: Number(req.body.amount || 0),
      reference: req.body.reference || "",
      narration: req.body.narration || "",
      includeInLandlordStatement: Boolean(req.body.includeInLandlordStatement),
      status: req.body.status === "posted" ? "draft" : "draft",
      createdBy: actorUserId,
      business: businessId,
    });

    emitToCompany(businessId, "journal:new", { journalId: journal._id });

    const populated = await populateJournalQuery(JournalEntry.findById(journal._id));
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

    const { status, journalType, property, landlord, search } = req.query;
    const filter = { business };

    if (status && status !== "all") filter.status = status;
    if (journalType && journalType !== "all") filter.journalType = journalType;
    if (property && property !== "all") filter.property = property;
    if (landlord && landlord !== "all") filter.landlord = landlord;

    if (search) {
      const term = String(search).trim();
      filter.$or = [
        { journalNo: { $regex: term, $options: "i" } },
        { reference: { $regex: term, $options: "i" } },
        { narration: { $regex: term, $options: "i" } },
      ];
    }

    const rows = await populateJournalQuery(
      JournalEntry.find(filter).sort({ date: -1, createdAt: -1 })
    );

    return res.status(200).json(rows);
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
    );

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

    await validateJournalPayload({
      businessId,
      payload: req.body || {},
    });

    existing.date = req.body.date || existing.date;
    existing.journalType = req.body.journalType || existing.journalType;
    existing.property = req.body.property || existing.property;
    existing.landlord = req.body.landlord || null;
    existing.debitAccount = req.body.debitAccount || existing.debitAccount;
    existing.creditAccount = req.body.creditAccount || existing.creditAccount;
    existing.amount = Number(req.body.amount || existing.amount || 0);
    existing.reference = req.body.reference || "";
    existing.narration = req.body.narration || "";
    existing.includeInLandlordStatement = Boolean(req.body.includeInLandlordStatement);

    await existing.save();

    emitToCompany(businessId, "journal:updated", { journalId: existing._id });

    const populated = await populateJournalQuery(JournalEntry.findById(existing._id));
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

    const populated = await populateJournalQuery(JournalEntry.findById(journal._id));
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

    const populated = await populateJournalQuery(JournalEntry.findById(journal._id));
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

    const debitAccount = await ChartOfAccount.findById(req.body.debitAccount)
      .select("code name type group")
      .lean();

    const creditAccount = await ChartOfAccount.findById(req.body.creditAccount)
      .select("code name type group")
      .lean();

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

    const populated = await populateJournalQuery(JournalEntry.findById(journal._id));
    return res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
};

export const postJournalEntryAction = postJournalEntry;
export const reverseJournalEntryAction = reverseJournalEntry;

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