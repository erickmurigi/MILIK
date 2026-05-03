import mongoose from "mongoose";
import PettyCashAccount from "../../models/PettyCashAccount.js";
import PettyCashDisbursement, { PETTY_CASH_CATEGORIES } from "../../models/PettyCashDisbursement.js";
import PettyCashReplenishment from "../../models/PettyCashReplenishment.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import SequenceCounter from "../../models/SequenceCounter.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";

const numberOrZero = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const toId = (v) => {
  const raw = typeof v === "object" && v?._id ? v._id : v;
  return raw && mongoose.Types.ObjectId.isValid(String(raw)) ? String(raw) : null;
};

const getBusinessId = (req) =>
  toId(req.query?.business || req.body?.business || req.headers?.["x-business-id"]);

async function nextSequence(business, key) {
  const counter = await SequenceCounter.findOneAndUpdate(
    { business, key },
    { $inc: { sequence: 1 } },
    { upsert: true, new: true }
  ).lean();
  return counter.sequence;
}

async function postDisbursementLedger({ disbursement, account, userId }) {
  const businessId = toId(account.business);
  const txDate = disbursement.date || new Date();
  const amount = numberOrZero(disbursement.amount);
  const sourceId = String(disbursement._id);

  const commonFields = {
    business: businessId,
    property: toId(disbursement.property) || null,
    unit: toId(disbursement.unit) || null,
    sourceTransactionType: "petty_cash_disbursement",
    sourceTransactionId: sourceId,
    transactionDate: txDate,
    statementPeriodStart: txDate,
    statementPeriodEnd: txDate,
    category: "PETTY_CASH_EXPENSE",
    amount,
    status: "approved",
    createdBy: userId,
    narration: disbursement.description || "Petty cash disbursement",
  };

  const entries = [];

  // DR expense account
  if (toId(disbursement.expenseAccountId)) {
    entries.push(
      new FinancialLedgerEntry({
        ...commonFields,
        accountId: toId(disbursement.expenseAccountId),
        direction: "debit",
        debit: amount,
        credit: 0,
      })
    );
  }

  // CR petty cash GL account
  if (toId(account.glAccountId)) {
    entries.push(
      new FinancialLedgerEntry({
        ...commonFields,
        accountId: toId(account.glAccountId),
        direction: "credit",
        debit: 0,
        credit: amount,
      })
    );
  }

  if (entries.length === 0) return [];

  await FinancialLedgerEntry.insertMany(entries);
  return entries.map((e) => e._id);
}

async function reverseDisbursementLedger({ disbursement, userId }) {
  const existing = await FinancialLedgerEntry.find({
    sourceTransactionType: "petty_cash_disbursement",
    sourceTransactionId: String(disbursement._id),
    status: "approved",
  }).lean();

  if (existing.length === 0) return;

  const reversals = existing.map(
    (e) =>
      new FinancialLedgerEntry({
        business: e.business,
        property: e.property,
        unit: e.unit,
        accountId: e.accountId,
        sourceTransactionType: "petty_cash_disbursement",
        sourceTransactionId: String(disbursement._id),
        transactionDate: new Date(),
        statementPeriodStart: e.statementPeriodStart,
        statementPeriodEnd: e.statementPeriodEnd,
        category: "REVERSAL",
        amount: e.amount,
        direction: e.direction === "debit" ? "credit" : "debit",
        debit: e.credit,
        credit: e.debit,
        status: "approved",
        createdBy: userId,
        narration: `Void: ${disbursement.description || disbursement.voucherNumber}`,
      })
  );

  await FinancialLedgerEntry.insertMany(reversals);
  await FinancialLedgerEntry.updateMany(
    { _id: { $in: existing.map((e) => e._id) } },
    { $set: { status: "reversed" } }
  );
}

async function postReplenishmentLedger({ replenishment, account, userId }) {
  const businessId = toId(account.business);
  const txDate = new Date();
  const amount = numberOrZero(replenishment.amount);
  const sourceId = String(replenishment._id);

  const commonFields = {
    business: businessId,
    sourceTransactionType: "petty_cash_replenishment",
    sourceTransactionId: sourceId,
    transactionDate: txDate,
    statementPeriodStart: txDate,
    statementPeriodEnd: txDate,
    category: "PETTY_CASH_REPLENISHMENT",
    amount,
    status: "approved",
    createdBy: userId,
    narration: replenishment.notes || `Petty cash replenishment — ${replenishment.replenishmentNumber}`,
  };

  const entries = [];

  // DR petty cash GL account (restoring the asset)
  if (toId(account.glAccountId)) {
    entries.push(
      new FinancialLedgerEntry({
        ...commonFields,
        accountId: toId(account.glAccountId),
        direction: "debit",
        debit: amount,
        credit: 0,
      })
    );
  }

  // CR bank account (cash going out of bank)
  if (toId(replenishment.bankAccountId)) {
    entries.push(
      new FinancialLedgerEntry({
        ...commonFields,
        accountId: toId(replenishment.bankAccountId),
        direction: "credit",
        debit: 0,
        credit: amount,
      })
    );
  }

  if (entries.length === 0) return [];

  await FinancialLedgerEntry.insertMany(entries);
  return entries.map((e) => e._id);
}

// ─── Accounts ────────────────────────────────────────────────────────────────

export const createPettyCashAccount = async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) return res.status(400).json({ message: "Business ID required" });

    const { name, custodianName, custodianUserId, floatAmount, glAccountId, voucherPrefix, notes } = req.body;

    if (!name?.trim()) return res.status(400).json({ message: "Account name is required" });
    if (!floatAmount || numberOrZero(floatAmount) <= 0)
      return res.status(400).json({ message: "Float amount must be greater than zero" });

    const userId = await resolveAuditActorUserId({ req, businessId });

    const account = new PettyCashAccount({
      business: businessId,
      name: name.trim(),
      custodianName: custodianName?.trim() || "",
      custodianUserId: toId(custodianUserId) || null,
      floatAmount: numberOrZero(floatAmount),
      currentBalance: 0,
      glAccountId: toId(glAccountId) || null,
      voucherPrefix: voucherPrefix?.trim() || "PCV",
      notes: notes?.trim() || "",
      createdBy: userId,
    });

    await account.save();
    return res.status(201).json({ success: true, data: account });
  } catch (err) {
    next(err);
  }
};

export const getPettyCashAccounts = async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) return res.status(400).json({ message: "Business ID required" });

    const filter = { business: businessId };
    if (req.query.status) filter.status = req.query.status;

    const accounts = await PettyCashAccount.find(filter)
      .populate("glAccountId", "code name type")
      .populate("custodianUserId", "name email")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ success: true, data: accounts });
  } catch (err) {
    next(err);
  }
};

export const getPettyCashAccount = async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    const { id } = req.params;
    if (!businessId) return res.status(400).json({ message: "Business ID required" });

    const account = await PettyCashAccount.findOne({ _id: id, business: businessId })
      .populate("glAccountId", "code name type")
      .populate("custodianUserId", "name email")
      .lean();

    if (!account) return res.status(404).json({ message: "Petty cash account not found" });

    return res.status(200).json({ success: true, data: account });
  } catch (err) {
    next(err);
  }
};

export const updatePettyCashAccount = async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    const { id } = req.params;
    if (!businessId) return res.status(400).json({ message: "Business ID required" });

    const account = await PettyCashAccount.findOne({ _id: id, business: businessId });
    if (!account) return res.status(404).json({ message: "Petty cash account not found" });

    const allowedFields = ["name", "custodianName", "custodianUserId", "floatAmount", "glAccountId", "voucherPrefix", "notes", "status"];
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        if (field === "floatAmount") account.floatAmount = numberOrZero(req.body[field]);
        else if (field === "glAccountId" || field === "custodianUserId") account[field] = toId(req.body[field]) || null;
        else if (field === "name") account.name = String(req.body[field]).trim();
        else account[field] = req.body[field];
      }
    });

    await account.save();
    return res.status(200).json({ success: true, data: account });
  } catch (err) {
    next(err);
  }
};

// ─── Disbursements ────────────────────────────────────────────────────────────

export const createDisbursement = async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) return res.status(400).json({ message: "Business ID required" });

    const { pettyCashAccountId, date, amount, description, category, propertyId, unitId, expenseAccountId, receiptAttached, receiptNote } = req.body;

    if (!pettyCashAccountId) return res.status(400).json({ message: "Petty cash account is required" });
    if (!date) return res.status(400).json({ message: "Date is required" });
    if (!amount || numberOrZero(amount) <= 0) return res.status(400).json({ message: "Amount must be greater than zero" });
    if (!description?.trim()) return res.status(400).json({ message: "Description is required" });
    if (!category || !PETTY_CASH_CATEGORIES.includes(category)) return res.status(400).json({ message: "Valid category is required" });

    const account = await PettyCashAccount.findOne({ _id: pettyCashAccountId, business: businessId });
    if (!account) return res.status(404).json({ message: "Petty cash account not found" });
    if (account.status === "closed") return res.status(400).json({ message: "Cannot disburse from a closed petty cash account" });

    const disbursementAmount = numberOrZero(amount);
    if (disbursementAmount > account.currentBalance && account.currentBalance > 0) {
      return res.status(400).json({ message: `Insufficient petty cash balance. Available: ${account.currentBalance.toFixed(2)}` });
    }

    const userId = await resolveAuditActorUserId({ req, businessId });
    const seq = await nextSequence(businessId, `pcv:${String(account._id)}`);
    const voucherNumber = `${account.voucherPrefix || "PCV"}-${String(seq).padStart(4, "0")}`;

    const disbursement = new PettyCashDisbursement({
      business: businessId,
      pettyCashAccount: account._id,
      voucherNumber,
      date: new Date(date),
      amount: disbursementAmount,
      description: description.trim(),
      category,
      property: toId(propertyId) || null,
      unit: toId(unitId) || null,
      expenseAccountId: toId(expenseAccountId) || null,
      receiptAttached: Boolean(receiptAttached),
      receiptNote: receiptNote?.trim() || "",
      status: "active",
      createdBy: userId,
    });

    await disbursement.save();

    // Post to ledger
    try {
      const ledgerIds = await postDisbursementLedger({ disbursement, account, userId });
      disbursement.postedToLedger = ledgerIds.length > 0;
      disbursement.ledgerEntries = ledgerIds;
      await disbursement.save();
    } catch (ledgerErr) {
      console.warn("Petty cash ledger posting failed (non-fatal):", ledgerErr.message);
    }

    // Deduct from account balance
    account.currentBalance = Math.max(0, account.currentBalance - disbursementAmount);
    await account.save();

    return res.status(201).json({ success: true, data: disbursement, account: { currentBalance: account.currentBalance } });
  } catch (err) {
    next(err);
  }
};

export const getDisbursements = async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) return res.status(400).json({ message: "Business ID required" });

    const filter = { business: businessId };
    if (req.query.pettyCashAccountId) filter.pettyCashAccount = req.query.pettyCashAccountId;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.category) filter.category = req.query.category;
    if (req.query.propertyId) filter.property = req.query.propertyId;
    if (req.query.startDate || req.query.endDate) {
      filter.date = {};
      if (req.query.startDate) filter.date.$gte = new Date(req.query.startDate);
      if (req.query.endDate) filter.date.$lte = new Date(req.query.endDate);
    }

    const disbursements = await PettyCashDisbursement.find(filter)
      .populate("pettyCashAccount", "name voucherPrefix")
      .populate("property", "propertyName propertyCode")
      .populate("unit", "unitName unitNumber")
      .populate("expenseAccountId", "code name")
      .populate("createdBy", "name email")
      .sort({ date: -1, createdAt: -1 })
      .lean();

    return res.status(200).json({ success: true, data: disbursements });
  } catch (err) {
    next(err);
  }
};

export const voidDisbursement = async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    const { id } = req.params;
    const { voidReason } = req.body;

    if (!businessId) return res.status(400).json({ message: "Business ID required" });

    const disbursement = await PettyCashDisbursement.findOne({ _id: id, business: businessId });
    if (!disbursement) return res.status(404).json({ message: "Disbursement not found" });
    if (disbursement.status === "void") return res.status(400).json({ message: "Disbursement is already voided" });

    const userId = await resolveAuditActorUserId({ req, businessId });

    // Reverse ledger entries
    try {
      await reverseDisbursementLedger({ disbursement, userId });
    } catch (ledgerErr) {
      console.warn("Ledger reversal failed (non-fatal):", ledgerErr.message);
    }

    disbursement.status = "void";
    disbursement.voidedBy = userId;
    disbursement.voidedAt = new Date();
    disbursement.voidReason = voidReason?.trim() || "";
    await disbursement.save();

    // Restore balance
    const account = await PettyCashAccount.findById(disbursement.pettyCashAccount);
    if (account) {
      account.currentBalance = account.currentBalance + numberOrZero(disbursement.amount);
      await account.save();
    }

    return res.status(200).json({ success: true, data: disbursement });
  } catch (err) {
    next(err);
  }
};

// ─── Replenishments ───────────────────────────────────────────────────────────

export const requestReplenishment = async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) return res.status(400).json({ message: "Business ID required" });

    const { pettyCashAccountId, amount, bankAccountId, notes, requestDate } = req.body;

    if (!pettyCashAccountId) return res.status(400).json({ message: "Petty cash account is required" });
    if (!amount || numberOrZero(amount) <= 0) return res.status(400).json({ message: "Amount must be greater than zero" });

    const account = await PettyCashAccount.findOne({ _id: pettyCashAccountId, business: businessId });
    if (!account) return res.status(404).json({ message: "Petty cash account not found" });
    if (account.status === "closed") return res.status(400).json({ message: "Cannot replenish a closed account" });

    const userId = await resolveAuditActorUserId({ req, businessId });
    const seq = await nextSequence(businessId, `rep:${String(account._id)}`);
    const replenishmentNumber = `REP-${String(seq).padStart(4, "0")}`;

    const replenishment = new PettyCashReplenishment({
      business: businessId,
      pettyCashAccount: account._id,
      replenishmentNumber,
      requestDate: requestDate ? new Date(requestDate) : new Date(),
      amount: numberOrZero(amount),
      balanceBeforeReplenishment: account.currentBalance,
      targetFloat: account.floatAmount,
      bankAccountId: toId(bankAccountId) || null,
      notes: notes?.trim() || "",
      status: "pending",
      requestedBy: userId,
    });

    await replenishment.save();
    return res.status(201).json({ success: true, data: replenishment });
  } catch (err) {
    next(err);
  }
};

export const approveReplenishment = async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    const { id } = req.params;
    if (!businessId) return res.status(400).json({ message: "Business ID required" });

    const replenishment = await PettyCashReplenishment.findOne({ _id: id, business: businessId });
    if (!replenishment) return res.status(404).json({ message: "Replenishment not found" });
    if (replenishment.status !== "pending") return res.status(400).json({ message: `Cannot approve a replenishment with status: ${replenishment.status}` });

    const userId = await resolveAuditActorUserId({ req, businessId });

    replenishment.status = "approved";
    replenishment.approvedBy = userId;
    replenishment.approvedAt = new Date();
    await replenishment.save();

    return res.status(200).json({ success: true, data: replenishment });
  } catch (err) {
    next(err);
  }
};

export const postReplenishment = async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    const { id } = req.params;
    if (!businessId) return res.status(400).json({ message: "Business ID required" });

    const replenishment = await PettyCashReplenishment.findOne({ _id: id, business: businessId });
    if (!replenishment) return res.status(404).json({ message: "Replenishment not found" });
    if (!["approved", "pending"].includes(replenishment.status))
      return res.status(400).json({ message: `Cannot post a replenishment with status: ${replenishment.status}` });

    const account = await PettyCashAccount.findOne({ _id: replenishment.pettyCashAccount, business: businessId });
    if (!account) return res.status(404).json({ message: "Petty cash account not found" });

    const userId = await resolveAuditActorUserId({ req, businessId });

    // Post to ledger
    let ledgerIds = [];
    try {
      ledgerIds = await postReplenishmentLedger({ replenishment, account, userId });
    } catch (ledgerErr) {
      console.warn("Replenishment ledger posting failed (non-fatal):", ledgerErr.message);
    }

    replenishment.status = "posted";
    replenishment.postedToLedger = ledgerIds.length > 0;
    replenishment.ledgerEntries = ledgerIds;
    replenishment.postedAt = new Date();
    if (!replenishment.approvedBy) {
      replenishment.approvedBy = userId;
      replenishment.approvedAt = new Date();
    }
    await replenishment.save();

    // Restore balance
    const replenishmentAmount = numberOrZero(replenishment.amount);
    account.currentBalance = Math.min(
      account.floatAmount,
      account.currentBalance + replenishmentAmount
    );
    await account.save();

    return res.status(200).json({ success: true, data: replenishment, account: { currentBalance: account.currentBalance } });
  } catch (err) {
    next(err);
  }
};

export const rejectReplenishment = async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    const { id } = req.params;
    const { rejectionReason } = req.body;

    if (!businessId) return res.status(400).json({ message: "Business ID required" });

    const replenishment = await PettyCashReplenishment.findOne({ _id: id, business: businessId });
    if (!replenishment) return res.status(404).json({ message: "Replenishment not found" });
    if (replenishment.status !== "pending") return res.status(400).json({ message: "Only pending replenishments can be rejected" });

    const userId = await resolveAuditActorUserId({ req, businessId });

    replenishment.status = "rejected";
    replenishment.rejectedBy = userId;
    replenishment.rejectedAt = new Date();
    replenishment.rejectionReason = rejectionReason?.trim() || "";
    await replenishment.save();

    return res.status(200).json({ success: true, data: replenishment });
  } catch (err) {
    next(err);
  }
};

export const getReplenishments = async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) return res.status(400).json({ message: "Business ID required" });

    const filter = { business: businessId };
    if (req.query.pettyCashAccountId) filter.pettyCashAccount = req.query.pettyCashAccountId;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.startDate || req.query.endDate) {
      filter.requestDate = {};
      if (req.query.startDate) filter.requestDate.$gte = new Date(req.query.startDate);
      if (req.query.endDate) filter.requestDate.$lte = new Date(req.query.endDate);
    }

    const replenishments = await PettyCashReplenishment.find(filter)
      .populate("pettyCashAccount", "name voucherPrefix floatAmount")
      .populate("bankAccountId", "code name")
      .populate("requestedBy", "name email")
      .populate("approvedBy", "name email")
      .sort({ requestDate: -1, createdAt: -1 })
      .lean();

    return res.status(200).json({ success: true, data: replenishments });
  } catch (err) {
    next(err);
  }
};
