import BankReconciliation from "../../models/BankReconciliation.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import { toObjectId } from "../../utils/db.js";

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

const resolveBusinessId = (req) => {
  const id =
    req.query?.business ||
    req.query?.company ||
    req.body?.business ||
    req.body?.company ||
    req.user?.company?._id ||
    req.user?.company;
  return toObjectId(id);
};

// ─── Postable asset accounts suitable for reconciliation ──────────────────────
export const getBankAccounts = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return res.status(400).json({ message: "Missing business" });

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
    if (!businessId) return res.status(400).json({ message: "Missing business" });

    const accountId = toObjectId(req.query.account);
    if (!accountId) return res.status(400).json({ message: "Missing account" });

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
    if (!businessId) return res.status(400).json({ message: "Missing business" });

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
    if (!id) return res.status(400).json({ message: "Invalid ID" });

    const recon = await BankReconciliation.findById(id)
      .populate("account", "code name")
      .lean();
    if (!recon) return res.status(404).json({ message: "Reconciliation not found" });

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
    if (!businessId) return res.status(400).json({ message: "Missing business" });

    const { account, periodStart, periodEnd, statementOpeningBalance, statementClosingBalance, notes } = req.body;
    if (!account || !periodStart || !periodEnd)
      return res.status(400).json({ message: "account, periodStart and periodEnd are required" });

    const accountId = toObjectId(account);
    if (!accountId) return res.status(400).json({ message: "Invalid account" });

    const accountDoc = await ChartOfAccount.findOne({ _id: accountId, business: businessId })
      .select("code name")
      .lean();
    if (!accountDoc) return res.status(404).json({ message: "Account not found" });

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
    if (!id) return res.status(400).json({ message: "Invalid ID" });

    const recon = await BankReconciliation.findById(id);
    if (!recon) return res.status(404).json({ message: "Reconciliation not found" });
    if (recon.status === "reconciled")
      return res.status(400).json({ message: "Cannot modify a finalised reconciliation" });

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
    if (!id) return res.status(400).json({ message: "Invalid ID" });

    const recon = await BankReconciliation.findById(id);
    if (!recon) return res.status(404).json({ message: "Reconciliation not found" });
    if (recon.status === "reconciled")
      return res.status(400).json({ message: "Already finalised" });

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
    if (!id) return res.status(400).json({ message: "Invalid ID" });

    const recon = await BankReconciliation.findById(id);
    if (!recon) return res.status(404).json({ message: "Reconciliation not found" });
    if (recon.status === "reconciled")
      return res.status(400).json({ message: "Cannot delete a finalised reconciliation" });

    await recon.deleteOne();
    return res.status(200).json({ message: "Deleted" });
  } catch (error) {
    next(error);
  }
};
