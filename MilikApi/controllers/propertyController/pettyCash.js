import mongoose from "mongoose";
import PettyCashAccount from "../../models/PettyCashAccount.js";
import PettyCashDisbursement, { PETTY_CASH_CATEGORIES, PETTY_CASH_CATEGORY_LABELS } from "../../models/PettyCashDisbursement.js";
import PettyCashReplenishment from "../../models/PettyCashReplenishment.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import SequenceCounter from "../../models/SequenceCounter.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";
import { aggregateChartOfAccountBalances } from "../../services/chartAccountAggregationService.js";
import { createError } from "../../utils/error.js";
import { parsePagination } from "../../utils/pagination.js";
import { resolveBusinessId } from "../../utils/requestContext.js";
import { round2 } from "../../utils/math.js";

const numberOrZero = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const toId = (v) => {
  const raw = typeof v === "object" && v?._id ? v._id : v;
  return raw && mongoose.Types.ObjectId.isValid(String(raw)) ? String(raw) : null;
};

// Delegates to the shared resolver (utils/requestContext.js) — the same x-active-company-id
// header + canAccessCompanyId-gated explicit-id handling every other module uses. The previous
// local version checked a header named "x-business-id", which the frontend never actually sends
// (it sends x-active-company-id/x-company-id) — dead code that silently fell through to
// req.user.company every time.
const getBusinessId = (req) => toId(resolveBusinessId(req));

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

  // A GL audit may only ever see this narration (not the Petty Cash page itself), so it needs to
  // stand on its own: voucher number, category, what it was for, and which box it came from.
  const categoryLabel = PETTY_CASH_CATEGORY_LABELS[disbursement.category] || disbursement.category || "";
  const narration = [
    disbursement.voucherNumber,
    categoryLabel,
    disbursement.description,
  ].filter(Boolean).join(" — ") + (account.name ? ` (${account.name})` : "");

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
    notes: narration, // FinancialLedgerEntry's field is "notes" — see the comment above on why this matters
  };

  // Both legs are mandatory — a disbursement with only one (or neither) would move the petty
  // cash subledger balance with no, or a one-sided, GL effect, leaving the two permanently out
  // of sync. createDisbursement validates this before ever saving, so reaching here with either
  // missing means the caller skipped that check — fail loudly instead of quietly posting nothing.
  if (!toId(disbursement.expenseAccountId)) throw createError(400, "Disbursement has no expense account — cannot post to the general ledger.");
  if (!toId(account.glAccountId)) throw createError(400, "Petty cash account has no GL asset account configured — cannot post to the general ledger.");

  const entries = [
    new FinancialLedgerEntry({
      ...commonFields,
      accountId: toId(disbursement.expenseAccountId),
      direction: "debit",
      debit: amount,
      credit: 0,
    }),
    new FinancialLedgerEntry({
      ...commonFields,
      accountId: toId(account.glAccountId),
      direction: "credit",
      debit: 0,
      credit: amount,
    }),
  ];

  await FinancialLedgerEntry.insertMany(entries);

  const touchedIds = [toId(disbursement.expenseAccountId), toId(account.glAccountId)].filter(Boolean);
  if (touchedIds.length) await aggregateChartOfAccountBalances(businessId, touchedIds).catch(() => {});

  return entries.map((e) => e._id);
}

async function reverseDisbursementLedger({ disbursement, userId, voidReason }) {
  const existing = await FinancialLedgerEntry.find({
    business: disbursement.business,
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
        notes: [
          `Void: ${disbursement.voucherNumber}`,
          disbursement.description,
          voidReason ? `Reason: ${voidReason}` : null,
        ].filter(Boolean).join(" — "),
      })
  );

  await FinancialLedgerEntry.insertMany(reversals);
  await FinancialLedgerEntry.updateMany(
    { _id: { $in: existing.map((e) => e._id) } },
    { $set: { status: "reversed" } },
    { _bypassImmutability: true }
  );

  const businessId = String(existing[0].business);
  const touchedIds = [...new Set(existing.map((e) => String(e.accountId)))];
  if (businessId && touchedIds.length) await aggregateChartOfAccountBalances(businessId, touchedIds).catch(() => {});
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
    // The ref number must never be dropped even when the requester left a note — this used to be
    // `replenishment.notes || "Replenishment — REP-xxxx"`, so a note on the request silently
    // replaced the only thing tying this GL entry back to its replenishment record.
    notes: [
      `${replenishment.replenishmentNumber} — Petty cash replenishment`,
      account.name ? `(${account.name})` : null,
      replenishment.notes || null,
    ].filter(Boolean).join(" "),
  };

  // Same reasoning as postDisbursementLedger: both legs are mandatory, never a silent partial post.
  if (!toId(account.glAccountId)) throw createError(400, "Petty cash account has no GL asset account configured — cannot post to the general ledger.");
  if (!toId(replenishment.bankAccountId)) throw createError(400, "Replenishment has no funding bank account — cannot post to the general ledger.");

  const entries = [
    new FinancialLedgerEntry({
      ...commonFields,
      accountId: toId(account.glAccountId),
      direction: "debit",
      debit: amount,
      credit: 0,
    }),
    new FinancialLedgerEntry({
      ...commonFields,
      accountId: toId(replenishment.bankAccountId),
      direction: "credit",
      debit: 0,
      credit: amount,
    }),
  ];

  await FinancialLedgerEntry.insertMany(entries);

  const touchedIds = [toId(account.glAccountId), toId(replenishment.bankAccountId)].filter(Boolean);
  if (touchedIds.length) await aggregateChartOfAccountBalances(businessId, touchedIds).catch(() => {});

  return entries.map((e) => e._id);
}

// ─── Accounts ────────────────────────────────────────────────────────────────

export const createPettyCashAccount = async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) return next(createError(400, "Business ID required"));

    const { name, custodianName, custodianUserId, floatAmount, glAccountId, voucherPrefix, notes } = req.body;

    if (!name?.trim()) return next(createError(400, "Account name is required"));
    if (!floatAmount || numberOrZero(floatAmount) <= 0)
      return next(createError(400, "Float amount must be greater than zero"));
    // Required so every disbursement/replenishment against this account can always post to the
    // GL — an account with no asset account would silently diverge the subledger from the GL.
    if (!toId(glAccountId)) return next(createError(400, "GL asset account is required"));

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
    if (!businessId) return next(createError(400, "Business ID required"));

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
    if (!businessId) return next(createError(400, "Business ID required"));

    const account = await PettyCashAccount.findOne({ _id: id, business: businessId })
      .populate("glAccountId", "code name type")
      .populate("custodianUserId", "name email")
      .lean();

    if (!account) return next(createError(404, "Petty cash account not found"));

    return res.status(200).json({ success: true, data: account });
  } catch (err) {
    next(err);
  }
};

export const updatePettyCashAccount = async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    const { id } = req.params;
    if (!businessId) return next(createError(400, "Business ID required"));

    const account = await PettyCashAccount.findOne({ _id: id, business: businessId });
    if (!account) return next(createError(404, "Petty cash account not found"));

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
    if (!businessId) return next(createError(400, "Business ID required"));

    const { pettyCashAccountId, date, amount, description, category, propertyId, unitId, expenseAccountId, receiptAttached, receiptNote } = req.body;

    if (!pettyCashAccountId) return next(createError(400, "Petty cash account is required"));
    if (!date) return next(createError(400, "Date is required"));
    if (!amount || numberOrZero(amount) <= 0) return next(createError(400, "Amount must be greater than zero"));
    if (!description?.trim()) return next(createError(400, "Description is required"));
    if (!category || !PETTY_CASH_CATEGORIES.includes(category)) return next(createError(400, "Valid category is required"));
    // Required so the expense always has somewhere to post to in the GL — see postDisbursementLedger.
    if (!toId(expenseAccountId)) return next(createError(400, "Expense account is required"));

    const account = await PettyCashAccount.findOne({ _id: pettyCashAccountId, business: businessId });
    if (!account) return next(createError(404, "Petty cash account not found"));
    if (account.status === "closed") return next(createError(400, "Cannot disburse from a closed petty cash account"));
    if (!toId(account.glAccountId)) return next(createError(400, "This petty cash account has no GL asset account configured. Set one before recording transactions."));

    const disbursementAmount = numberOrZero(amount);
    if (disbursementAmount > account.currentBalance) {
      return next(createError(400, `Insufficient petty cash balance. Available: ${account.currentBalance.toFixed(2)}`));
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

    // Post to ledger — fatal on failure: a disbursement whose balance moves in the subledger
    // with no (or a half-posted) GL effect would permanently diverge the two, so if this fails
    // the disbursement itself is removed rather than left behind in a partially-posted state.
    try {
      const ledgerIds = await postDisbursementLedger({ disbursement, account, userId });
      disbursement.postedToLedger = ledgerIds.length > 0;
      disbursement.ledgerEntries = ledgerIds;
      await disbursement.save();
    } catch (ledgerErr) {
      await PettyCashDisbursement.deleteOne({ _id: disbursement._id });
      return next(ledgerErr);
    }

    // Atomically deduct balance — conditional update prevents race conditions and negative balances
    const updatedAccount = await PettyCashAccount.findOneAndUpdate(
      { _id: account._id, currentBalance: { $gte: disbursementAmount } },
      { $inc: { currentBalance: -disbursementAmount } },
      { new: true }
    ).lean();

    if (!updatedAccount) {
      // Concurrent disbursement depleted the balance between our check and this write
      await PettyCashDisbursement.deleteOne({ _id: disbursement._id });
      return next(createError(409, "Insufficient petty cash balance — another disbursement was processed concurrently. Please retry."));
    }

    return res.status(201).json({ success: true, data: disbursement, account: { currentBalance: updatedAccount.currentBalance } });
  } catch (err) {
    next(err);
  }
};

export const getDisbursements = async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) return next(createError(400, "Business ID required"));

    const filter = { business: businessId };
    if (req.query.pettyCashAccountId) filter.pettyCashAccount = req.query.pettyCashAccountId;
    if (req.query.status) {
      filter.status = req.query.status;
    } else if (req.query.includeVoid !== "true") {
      // voided disbursements are kept for the audit trail but stay out of the working list unless asked for
      filter.status = { $ne: "void" };
    }
    if (req.query.category) filter.category = req.query.category;
    if (req.query.propertyId) filter.property = req.query.propertyId;
    if (req.query.startDate || req.query.endDate) {
      filter.date = {};
      if (req.query.startDate) filter.date.$gte = new Date(req.query.startDate);
      if (req.query.endDate) filter.date.$lte = new Date(req.query.endDate);
    }

    const { page: pageNum, limit: limitNum, skip } = parsePagination(req, { defaultLimit: 50, maxLimit: 200 });

    if (req.query.search) {
      const term = req.query.search.trim();
      filter.$or = [
        { voucherNumber: { $regex: term, $options: "i" } },
        { description: { $regex: term, $options: "i" } },
      ];
    }

    const [disbursements, total] = await Promise.all([
      PettyCashDisbursement.find(filter)
        .populate("pettyCashAccount", "name voucherPrefix")
        .populate("property", "propertyName propertyCode")
        .populate("unit", "unitName unitNumber")
        .populate("expenseAccountId", "code name")
        .populate("createdBy", "name email")
        .sort({ date: -1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      PettyCashDisbursement.countDocuments(filter),
    ]);

    return res.status(200).json({ success: true, data: disbursements, total, page: pageNum, pages: Math.max(1, Math.ceil(total / limitNum)) });
  } catch (err) {
    next(err);
  }
};

export const voidDisbursement = async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    const { id } = req.params;
    const { voidReason } = req.body;

    if (!businessId) return next(createError(400, "Business ID required"));

    const disbursement = await PettyCashDisbursement.findOne({ _id: id, business: businessId });
    if (!disbursement) return next(createError(404, "Disbursement not found"));
    if (disbursement.status === "void") return next(createError(400, "Disbursement is already voided"));

    const userId = await resolveAuditActorUserId({ req, businessId });

    // Reverse ledger entries — fatal on failure: voiding without a successful GL reversal would
    // restore the subledger balance while the original GL entries stayed posted, double-counting
    // the expense's reversal (subledger says it never happened; the GL still says it did).
    try {
      await reverseDisbursementLedger({ disbursement, userId, voidReason: voidReason?.trim() || "" });
    } catch (ledgerErr) {
      return next(ledgerErr);
    }

    disbursement.status = "void";
    disbursement.voidedBy = userId;
    disbursement.voidedAt = new Date();
    disbursement.voidReason = voidReason?.trim() || "";
    await disbursement.save();

    // Atomically restore balance
    await PettyCashAccount.findByIdAndUpdate(
      disbursement.pettyCashAccount,
      { $inc: { currentBalance: numberOrZero(disbursement.amount) } }
    );

    return res.status(200).json({ success: true, data: disbursement });
  } catch (err) {
    next(err);
  }
};

// ─── Replenishments ───────────────────────────────────────────────────────────

export const requestReplenishment = async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    if (!businessId) return next(createError(400, "Business ID required"));

    const { pettyCashAccountId, amount, bankAccountId, notes, requestDate } = req.body;

    if (!pettyCashAccountId) return next(createError(400, "Petty cash account is required"));
    if (!amount || numberOrZero(amount) <= 0) return next(createError(400, "Amount must be greater than zero"));
    // Required so posting (on approval) always has a credit leg — see postReplenishmentLedger.
    if (!toId(bankAccountId)) return next(createError(400, "Funding bank account is required"));

    const account = await PettyCashAccount.findOne({ _id: pettyCashAccountId, business: businessId });
    if (!account) return next(createError(404, "Petty cash account not found"));
    if (account.status === "closed") return next(createError(400, "Cannot replenish a closed account"));

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
    if (!businessId) return next(createError(400, "Business ID required"));

    const replenishment = await PettyCashReplenishment.findOne({ _id: id, business: businessId });
    if (!replenishment) return next(createError(404, "Replenishment not found"));
    if (replenishment.status !== "pending") return next(createError(400, `Cannot approve a replenishment with status: ${replenishment.status}`));

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
    if (!businessId) return next(createError(400, "Business ID required"));

    const replenishment = await PettyCashReplenishment.findOne({ _id: id, business: businessId });
    if (!replenishment) return next(createError(404, "Replenishment not found"));
    if (!["approved", "pending"].includes(replenishment.status))
      return next(createError(400, `Cannot post a replenishment with status: ${replenishment.status}`));

    const account = await PettyCashAccount.findOne({ _id: replenishment.pettyCashAccount, business: businessId });
    if (!account) return next(createError(404, "Petty cash account not found"));

    const userId = await resolveAuditActorUserId({ req, businessId });

    // Post to ledger — fatal on failure: posting "posted" and restoring the balance without a
    // successful GL entry would move real money in the subledger with no GL effect behind it.
    let ledgerIds;
    try {
      ledgerIds = await postReplenishmentLedger({ replenishment, account, userId });
    } catch (ledgerErr) {
      return next(ledgerErr);
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

    if (!businessId) return next(createError(400, "Business ID required"));

    const replenishment = await PettyCashReplenishment.findOne({ _id: id, business: businessId });
    if (!replenishment) return next(createError(404, "Replenishment not found"));
    if (replenishment.status !== "pending") return next(createError(400, "Only pending replenishments can be rejected"));

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
    if (!businessId) return next(createError(400, "Business ID required"));

    const filter = { business: businessId };
    if (req.query.pettyCashAccountId) filter.pettyCashAccount = req.query.pettyCashAccountId;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.startDate || req.query.endDate) {
      filter.requestDate = {};
      if (req.query.startDate) filter.requestDate.$gte = new Date(req.query.startDate);
      if (req.query.endDate) filter.requestDate.$lte = new Date(req.query.endDate);
    }

    const { page: pageNum, limit: limitNum, skip } = parsePagination(req, { defaultLimit: 50, maxLimit: 200 });

    const [replenishments, total] = await Promise.all([
      PettyCashReplenishment.find(filter)
        .populate("pettyCashAccount", "name voucherPrefix floatAmount")
        .populate("bankAccountId", "code name")
        .populate("requestedBy", "name email")
        .populate("approvedBy", "name email")
        .sort({ requestDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      PettyCashReplenishment.countDocuments(filter),
    ]);

    return res.status(200).json({ success: true, data: replenishments, total, page: pageNum, pages: Math.max(1, Math.ceil(total / limitNum)) });
  } catch (err) {
    next(err);
  }
};

// ─── Unified ledger (disbursements + replenishments, one chronological register) ──────────────
// A real cash register shows money out and money in together with a running balance — splitting
// them into two separate lists (the old UI) makes it hard to answer "does this box's balance
// match what I expect right now." This merges both collections for one account, sorted
// chronologically, and walks forward to compute the balance after each row — only a disbursement
// with status "active" or a replenishment with status "posted" actually moved money, so a voided
// disbursement or a pending/rejected replenishment still shows up (for the audit trail) but
// leaves the running balance untouched at that point.
export const getPettyCashLedger = async (req, res, next) => {
  try {
    const businessId = getBusinessId(req);
    const { id } = req.params;
    if (!businessId) return next(createError(400, "Business ID required"));

    const account = await PettyCashAccount.findOne({ _id: id, business: businessId }).lean();
    if (!account) return next(createError(404, "Petty cash account not found"));

    const { search, category, status, type, startDate, endDate } = req.query;
    const term = typeof search === "string" ? search.trim() : "";

    const disbFilter = { business: businessId, pettyCashAccount: id };
    if (category) disbFilter.category = category;
    if (startDate || endDate) {
      disbFilter.date = {};
      if (startDate) disbFilter.date.$gte = new Date(startDate);
      if (endDate) disbFilter.date.$lte = new Date(endDate);
    }
    if (term) disbFilter.$or = [{ voucherNumber: { $regex: term, $options: "i" } }, { description: { $regex: term, $options: "i" } }];

    const repFilter = { business: businessId, pettyCashAccount: id };
    if (startDate || endDate) {
      repFilter.requestDate = {};
      if (startDate) repFilter.requestDate.$gte = new Date(startDate);
      if (endDate) repFilter.requestDate.$lte = new Date(endDate);
    }
    if (term) repFilter.$or = [{ replenishmentNumber: { $regex: term, $options: "i" } }, { notes: { $regex: term, $options: "i" } }];

    const wantDisbursements = !type || type === "all" || type === "disbursement";
    const wantReplenishments = !type || type === "all" || type === "replenishment";

    const [disbursements, replenishments] = await Promise.all([
      wantDisbursements
        ? PettyCashDisbursement.find(disbFilter)
          .populate("property", "propertyName propertyCode")
          .populate("expenseAccountId", "code name")
          .populate("createdBy", "name email")
          .lean()
        : [],
      wantReplenishments
        ? PettyCashReplenishment.find(repFilter)
          .populate("bankAccountId", "code name")
          .populate("requestedBy", "name email")
          .populate("approvedBy", "name email")
          .lean()
        : [],
    ]);

    let rows = [
      ...disbursements.map((d) => ({
        _id: d._id,
        kind: "disbursement",
        date: d.date,
        createdAt: d.createdAt,
        ref: d.voucherNumber,
        description: d.description,
        category: d.category,
        property: d.property,
        expenseAccountId: d.expenseAccountId,
        receiptAttached: d.receiptAttached,
        receiptNote: d.receiptNote,
        voidReason: d.voidReason,
        amountOut: numberOrZero(d.amount),
        amountIn: 0,
        status: d.status,
        createdBy: d.createdBy,
        affectsBalance: d.status === "active",
        balanceDelta: d.status === "active" ? -numberOrZero(d.amount) : 0,
      })),
      ...replenishments.map((r) => ({
        _id: r._id,
        kind: "replenishment",
        date: r.requestDate,
        createdAt: r.createdAt,
        ref: r.replenishmentNumber,
        description: r.notes || "Replenishment",
        notes: r.notes,
        balanceBeforeReplenishment: r.balanceBeforeReplenishment,
        bankAccountId: r.bankAccountId,
        amountOut: 0,
        amountIn: numberOrZero(r.amount),
        status: r.status,
        requestedBy: r.requestedBy,
        approvedBy: r.approvedBy,
        affectsBalance: r.status === "posted",
        balanceDelta: r.status === "posted" ? numberOrZero(r.amount) : 0,
      })),
    ];

    if (status) rows = rows.filter((r) => r.status === status);

    // Oldest-first to walk the running balance forward, then reversed for the usual newest-first
    // display. Compared by calendar date only (not the raw timestamp) before falling back to
    // createdAt: a disbursement's "date" is a plain date picker (always midnight), while a
    // replenishment's defaults to the real time it was requested — comparing raw timestamps would
    // let a same-day disbursement always sort "before" a same-day replenishment regardless of which
    // actually happened first, corrupting the running balance for every same-day pair.
    const dayOnly = (d) => { const x = new Date(d); return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
    rows.sort((a, b) => dayOnly(a.date) - dayOnly(b.date) || new Date(a.createdAt) - new Date(b.createdAt));
    let running = 0;
    for (const row of rows) {
      if (row.affectsBalance) running = round2(running + row.balanceDelta);
      row.balanceAfter = running;
    }
    rows.reverse();

    const { page: pageNum, limit: limitNum, skip } = parsePagination(req, { defaultLimit: 50, maxLimit: 200 });
    const total = rows.length;
    const pageRows = rows.slice(skip, skip + limitNum);

    return res.status(200).json({
      success: true,
      data: pageRows,
      total,
      page: pageNum,
      pages: Math.max(1, Math.ceil(total / limitNum)),
      account: { _id: account._id, name: account.name, currentBalance: account.currentBalance, floatAmount: account.floatAmount },
    });
  } catch (err) {
    next(err);
  }
};
