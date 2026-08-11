import BankReconciliation from "../../models/BankReconciliation.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import { toObjectId } from "../../utils/db.js";
import { resolveBusinessId } from "../../utils/requestContext.js";
import { createError } from "../../utils/error.js";

const ENTRY_PAGE_SIZE = 500;

const encodeCursor = (entry) =>
  Buffer.from(JSON.stringify({ d: new Date(entry.transactionDate).toISOString(), i: String(entry._id) })).toString("base64url");

const decodeCursor = (cursor) => {
  try { return JSON.parse(Buffer.from(cursor, "base64url").toString()); }
  catch { return null; }
};

const applyEntryCursor = (filter, after) => {
  const decoded = after ? decodeCursor(after) : null;
  if (!decoded) return filter;
  const afterDate = new Date(decoded.d);
  const afterId   = toObjectId(decoded.i);
  if (!afterId) return filter;
  return {
    ...filter,
    $or: [
      { transactionDate: { $gt: afterDate } },
      { transactionDate: afterDate, _id: { $gt: afterId } },
    ],
  };
};


// ─── Postable asset accounts suitable for reconciliation ──────────────────────
export const getBankAccounts = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));

    const accounts = await ChartOfAccount.find({
      business: businessId,
      type: "asset",
      isPosting: true,
      isHeader: false,
    })
      .select("code name group subGroup")
      .sort({ code: 1 })
      .lean();

    return res.status(200).json(accounts);
  } catch (error) {
    next(error);
  }
};

// ─── Ledger entries for a given account + period (cursor-paginated) ───────────
export const getReconciliationEntries = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));

    const accountId = toObjectId(req.query.account);
    if (!accountId) return next(createError(400, "Missing account"));

    const from = req.query.from ? new Date(req.query.from) : null;
    const to   = req.query.to   ? new Date(req.query.to)   : new Date();
    if (to) to.setHours(23, 59, 59, 999);

    let baseFilter = {
      business:  businessId,
      accountId,
      status:    { $in: ["approved", "draft"] },
    };
    if (from || to) {
      baseFilter.transactionDate = {};
      if (from) baseFilter.transactionDate.$gte = from;
      if (to)   baseFilter.transactionDate.$lte = to;
    }

    const filter = applyEntryCursor(baseFilter, req.query.after || null);

    const raw = await FinancialLedgerEntry.find(filter)
      .sort({ transactionDate: 1, _id: 1 })
      .limit(ENTRY_PAGE_SIZE + 1)
      .lean();

    const hasMore = raw.length > ENTRY_PAGE_SIZE;
    const entries = hasMore ? raw.slice(0, ENTRY_PAGE_SIZE) : raw;
    const nextCursor = hasMore ? encodeCursor(entries[entries.length - 1]) : null;

    return res.status(200).json({ entries, nextCursor, hasMore });
  } catch (error) {
    next(error);
  }
};

// ─── List saved reconciliations ────────────────────────────────────────────────
export const getReconciliations = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));

    const filter = { business: businessId };
    if (req.query.account) filter.account = toObjectId(req.query.account);
    if (req.query.status)  filter.status  = req.query.status;

    const list = await BankReconciliation.find(filter)
      .sort({ periodEnd: -1 })
      .limit(200)
      .populate("account", "code name")
      .lean();

    return res.status(200).json(list);
  } catch (error) {
    next(error);
  }
};

// ─── Single reconciliation (with entries) ─────────────────────────────────────
export const getReconciliation = async (req, res, next) => {
  try {
    const id = toObjectId(req.params.id);
    if (!id) return next(createError(400, "Invalid ID"));

    const recon = await BankReconciliation.findById(id)
      .populate("account", "code name")
      .lean();
    if (!recon) return next(createError(404, "Reconciliation not found"));

    const periodEnd = new Date(recon.periodEnd);
    periodEnd.setHours(23, 59, 59, 999);

    const baseEntryFilter = {
      business:        recon.business,
      accountId:       recon.account._id,
      transactionDate: { $gte: recon.periodStart, $lte: periodEnd },
      status:          { $in: ["approved", "draft"] },
    };
    const entryFilter = applyEntryCursor(baseEntryFilter, req.query.after || null);

    const raw = await FinancialLedgerEntry.find(entryFilter)
      .sort({ transactionDate: 1, _id: 1 })
      .limit(ENTRY_PAGE_SIZE + 1)
      .lean();

    const hasMore = raw.length > ENTRY_PAGE_SIZE;
    const pageEntries = hasMore ? raw.slice(0, ENTRY_PAGE_SIZE) : raw;
    const nextCursor = hasMore ? encodeCursor(pageEntries[pageEntries.length - 1]) : null;

    const clearedSet = new Set(recon.clearedEntries.map(String));
    const entriesWithCleared = pageEntries.map((e) => ({
      ...e,
      cleared: clearedSet.has(String(e._id)),
    }));

    return res.status(200).json({ ...recon, entries: entriesWithCleared, nextCursor, hasMore });
  } catch (error) {
    next(error);
  }
};

// ─── Create new reconciliation session ────────────────────────────────────────
export const createReconciliation = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));

    const { account, periodStart, periodEnd, statementOpeningBalance, statementClosingBalance, notes } = req.body;
    if (!account || !periodStart || !periodEnd)
      return next(createError(400, "account, periodStart and periodEnd are required"));

    const accountId = toObjectId(account);
    if (!accountId) return next(createError(400, "Invalid account"));

    const accountDoc = await ChartOfAccount.findOne({ _id: accountId, business: businessId })
      .select("code name")
      .lean();
    if (!accountDoc) return next(createError(404, "Account not found"));

    const recon = await BankReconciliation.create({
      business:               businessId,
      account:                accountId,
      accountName:            accountDoc.name,
      accountCode:            accountDoc.code,
      periodStart:            new Date(periodStart),
      periodEnd:              new Date(periodEnd),
      statementOpeningBalance: Number(statementOpeningBalance) || 0,
      statementClosingBalance: Number(statementClosingBalance) || 0,
      notes:          notes || "",
      clearedEntries: [],
      difference:     0,
      status:         "draft",
    });

    return res.status(201).json(recon);
  } catch (error) {
    next(error);
  }
};

// ─── Save cleared entries + balances ──────────────────────────────────────────
export const updateReconciliation = async (req, res, next) => {
  try {
    const id = toObjectId(req.params.id);
    if (!id) return next(createError(400, "Invalid ID"));

    const recon = await BankReconciliation.findById(id);
    if (!recon) return next(createError(404, "Reconciliation not found"));
    if (recon.status === "reconciled")
      return next(createError(400, "Cannot modify a finalised reconciliation"));

    const { clearedEntries, statementOpeningBalance, statementClosingBalance, notes, difference } = req.body;

    if (clearedEntries !== undefined)
      recon.clearedEntries = clearedEntries.map(toObjectId).filter(Boolean);
    if (statementOpeningBalance !== undefined) recon.statementOpeningBalance = Number(statementOpeningBalance);
    if (statementClosingBalance !== undefined) recon.statementClosingBalance = Number(statementClosingBalance);
    if (notes      !== undefined) recon.notes      = notes;
    if (difference !== undefined) recon.difference = Number(difference);

    await recon.save();
    return res.status(200).json(recon);
  } catch (error) {
    next(error);
  }
};

// ─── Finalise (lock) reconciliation ───────────────────────────────────────────
export const finalizeReconciliation = async (req, res, next) => {
  try {
    const id = toObjectId(req.params.id);
    if (!id) return next(createError(400, "Invalid ID"));

    const recon = await BankReconciliation.findById(id);
    if (!recon) return next(createError(404, "Reconciliation not found"));
    if (recon.status === "reconciled")
      return next(createError(400, "Already finalised"));

    recon.status       = "reconciled";
    recon.reconciledAt = new Date();
    recon.reconciledBy = req.user?._id;
    await recon.save();

    return res.status(200).json(recon);
  } catch (error) {
    next(error);
  }
};

// ─── Delete draft reconciliation ───────────────────────────────────────────────
export const deleteReconciliation = async (req, res, next) => {
  try {
    const id = toObjectId(req.params.id);
    if (!id) return next(createError(400, "Invalid ID"));

    const recon = await BankReconciliation.findById(id);
    if (!recon) return next(createError(404, "Reconciliation not found"));
    if (recon.status === "reconciled")
      return next(createError(400, "Cannot delete a finalised reconciliation"));

    await recon.deleteOne();
    return res.status(200).json({ message: "Deleted" });
  } catch (error) {
    next(error);
  }
};
