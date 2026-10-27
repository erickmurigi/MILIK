import BankReconciliation from "../../models/BankReconciliation.js";
import BankStatementLine from "../../models/BankStatementLine.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import JournalEntry from "../../models/JournalEntry.js";
import SequenceCounter from "../../models/SequenceCounter.js";
import { postLinesJournalToLedger, validateJournalLines } from "../../services/journalLinesService.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";
import { toObjectId } from "../../utils/db.js";
import { resolveBusinessId } from "../../utils/requestContext.js";
import { createError } from "../../utils/error.js";

const ENTRY_PAGE_SIZE = 500;
const MAX_STATEMENT_LINES = 2000;
// How far outside the typed reconciliation period a ledger entry can still be considered a
// candidate match — banks often clear a transaction a few days after it was recorded (or vice
// versa), so a strict in-period-only match would miss perfectly legitimate pairs sitting just
// past either edge.
const MATCH_WINDOW_DAYS = 7;
const MATCH_AMOUNT_TOLERANCE = 0.01;

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
      .populate("reconciledBy", "surname otherNames")
      .lean();

    return res.status(200).json(list);
  } catch (error) {
    next(error);
  }
};

// ─── Single reconciliation (with entries) ─────────────────────────────────────
export const getReconciliation = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));

    const id = toObjectId(req.params.id);
    if (!id) return next(createError(400, "Invalid ID"));

    const recon = await BankReconciliation.findOne({ _id: id, business: businessId })
      .populate("account", "code name")
      .populate("reconciledBy", "surname otherNames")
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
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));

    const id = toObjectId(req.params.id);
    if (!id) return next(createError(400, "Invalid ID"));

    const recon = await BankReconciliation.findOne({ _id: id, business: businessId });
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
// Recomputed server-side from the actual ledger — never trusts the client's own
// `difference` figure (saved earlier by updateReconciliation) for a step that
// permanently locks the reconciliation as audited-correct.
export const finalizeReconciliation = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));

    const id = toObjectId(req.params.id);
    if (!id) return next(createError(400, "Invalid ID"));

    const recon = await BankReconciliation.findOne({ _id: id, business: businessId });
    if (!recon) return next(createError(404, "Reconciliation not found"));
    if (recon.status === "reconciled")
      return next(createError(400, "Already finalised"));

    const clearedIds = (recon.clearedEntries || []).filter(Boolean);
    const clearedEntryDocs = clearedIds.length
      ? await FinancialLedgerEntry.find({
          _id:       { $in: clearedIds },
          business:  businessId,
          accountId: recon.account,
          status:    { $in: ["approved", "draft"] },
        }).select("amount direction").lean()
      : [];

    let clearedDebits = 0, clearedCredits = 0;
    for (const e of clearedEntryDocs) {
      const amt = Number(e.amount || 0);
      if (e.direction === "debit") clearedDebits += amt; else clearedCredits += amt;
    }
    const clearedBalance = Number(recon.statementOpeningBalance || 0) + clearedDebits - clearedCredits;
    const difference = Math.round((Number(recon.statementClosingBalance || 0) - clearedBalance) * 100) / 100;

    if (Math.abs(difference) > 0.005) {
      return next(createError(400, `Cannot finalise — recomputed difference is KES ${difference.toFixed(2)}. Clear all matching entries first.`));
    }

    recon.difference   = difference;
    recon.status       = "reconciled";
    recon.reconciledAt = new Date();
    recon.reconciledBy = req.user?._id;
    await recon.save();

    return res.status(200).json(recon);
  } catch (error) {
    next(error);
  }
};

// ─── Reopen a finalised reconciliation ─────────────────────────────────────────
// An audited, permission-gated escape hatch for a genuine mistake — never a silent edit. Reverts
// to "draft" (every field stays exactly as it was when locked — cleared entries, balances) so the
// normal update/finalize flow picks up right where it left off, but appends a permanent record of
// who reopened it, when, and why, plus a snapshot of what was undone.
export const reopenReconciliation = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));

    const id = toObjectId(req.params.id);
    if (!id) return next(createError(400, "Invalid ID"));

    const reason = String(req.body?.reason || "").trim();
    if (!reason) return next(createError(400, "A reason is required to reopen a finalised reconciliation"));

    const recon = await BankReconciliation.findOne({ _id: id, business: businessId });
    if (!recon) return next(createError(404, "Reconciliation not found"));
    if (recon.status !== "reconciled")
      return next(createError(400, "Only a finalised reconciliation can be reopened"));

    recon.reopenHistory.push({
      reopenedAt: new Date(),
      reopenedBy: req.user?._id,
      reason,
      previousReconciledAt: recon.reconciledAt,
      previousDifference:   recon.difference,
    });
    recon.status       = "draft";
    recon.reconciledAt = null;
    recon.reconciledBy = null;
    await recon.save();

    return res.status(200).json(recon);
  } catch (error) {
    next(error);
  }
};

// ─── Statement import + matching ───────────────────────────────────────────────
//
// The ticking workflow above only ever asks "which of MY OWN entries actually happened on the
// bank statement?" — it can't catch money that moved in the real world but was never entered in
// the books at all. This is the other half: import the actual statement, match each line to a
// real ledger entry (auto where unambiguous, manually otherwise), or post the missing transaction
// directly from a line that has no match. Every statement line is kept as its own audited record
// (BankStatementLine), not discarded after matching.

// Every ledger entry on this account, within a window around the reconciliation's period, that
// isn't already cleared on this reconciliation and isn't already claimed by another statement line
// — i.e. everything still "up for grabs" as a match candidate.
const getCandidateEntries = async (businessId, recon) => {
  const windowStart = new Date(recon.periodStart);
  windowStart.setDate(windowStart.getDate() - MATCH_WINDOW_DAYS);
  const windowEnd = new Date(recon.periodEnd);
  windowEnd.setDate(windowEnd.getDate() + MATCH_WINDOW_DAYS);
  windowEnd.setHours(23, 59, 59, 999);

  const [candidates, claimedLines] = await Promise.all([
    FinancialLedgerEntry.find({
      business:  businessId,
      accountId: recon.account,
      status:    { $in: ["approved", "draft"] },
      transactionDate: { $gte: windowStart, $lte: windowEnd },
    }).select("_id amount direction transactionDate notes").lean(),
    BankStatementLine.find({
      business: businessId, reconciliation: recon._id,
      status: { $in: ["matched", "created"] }, matchedEntry: { $ne: null },
    }).select("matchedEntry").lean(),
  ]);

  const clearedSet = new Set((recon.clearedEntries || []).map(String));
  const claimedSet = new Set(claimedLines.map((l) => String(l.matchedEntry)));
  return candidates.filter((e) => !clearedSet.has(String(e._id)) && !claimedSet.has(String(e._id)));
};

// Candidates matching a line's amount + direction exactly, closest date first. Amount is the one
// thing a bank statement is never wrong about, so it's the hard filter; date is only ever a
// tie-breaker, never a cutoff, since clearing delay varies.
const suggestMatchesForLine = (candidates, line) =>
  candidates
    .filter((e) => e.direction === line.direction && Math.abs(Number(e.amount) - Number(line.amount)) <= MATCH_AMOUNT_TOLERANCE)
    .sort((a, b) => Math.abs(new Date(a.transactionDate) - new Date(line.date)) - Math.abs(new Date(b.transactionDate) - new Date(line.date)));

const serializeLine = (line, candidatesByLine) => ({
  ...line,
  suggestions: line.status === "unmatched" ? (candidatesByLine.get(String(line._id)) || []).slice(0, 5) : [],
});

// ─── Import a parsed bank statement (CSV parsed client-side, same convention every other bulk
// import in this app already uses — see tenants/properties/units bulk-import) ──────────────────
export const importStatementLines = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));

    const id = toObjectId(req.params.id);
    if (!id) return next(createError(400, "Invalid ID"));

    const recon = await BankReconciliation.findOne({ _id: id, business: businessId });
    if (!recon) return next(createError(404, "Reconciliation not found"));
    if (recon.status === "reconciled")
      return next(createError(400, "Cannot import a statement into a finalised reconciliation"));

    const rawLines = Array.isArray(req.body?.lines) ? req.body.lines : null;
    if (!rawLines || !rawLines.length) return next(createError(400, "No statement lines to import"));
    if (rawLines.length > MAX_STATEMENT_LINES) return next(createError(400, `Maximum ${MAX_STATEMENT_LINES} statement lines per import`));

    const toInsert = [];
    for (const [i, raw] of rawLines.entries()) {
      const n = i + 1;
      const date = raw?.date ? new Date(raw.date) : null;
      if (!date || Number.isNaN(date.getTime())) return next(createError(400, `Row ${n}: invalid date`));
      const amount = Number(raw?.amount);
      if (!Number.isFinite(amount) || amount <= 0) return next(createError(400, `Row ${n}: invalid amount`));
      const direction = String(raw?.direction || "").toLowerCase();
      if (!["debit", "credit"].includes(direction)) return next(createError(400, `Row ${n}: direction must be "debit" or "credit"`));

      toInsert.push({
        business: businessId, reconciliation: recon._id,
        date, amount, direction,
        description: String(raw?.description || "").trim().slice(0, 300),
        reference:   String(raw?.reference || "").trim().slice(0, 100),
      });
    }

    const created = await BankStatementLine.insertMany(toInsert);

    // Auto-match every unambiguous (exactly one candidate) line, claiming that candidate so a
    // later line in the SAME import can't also claim it; everything else is left for the user to
    // confirm from its suggestions.
    let candidates = await getCandidateEntries(businessId, recon);
    const newlyCleared = [];
    for (const line of created) {
      const matches = suggestMatchesForLine(candidates, line);
      if (matches.length === 1) {
        const entry = matches[0];
        line.status = "matched";
        line.matchedEntry = entry._id;
        line.matchedAt = new Date();
        await line.save();
        newlyCleared.push(entry._id);
        candidates = candidates.filter((c) => String(c._id) !== String(entry._id));
      }
    }
    if (newlyCleared.length) {
      const clearedSet = new Set((recon.clearedEntries || []).map(String));
      newlyCleared.forEach((id) => clearedSet.add(String(id)));
      recon.clearedEntries = [...clearedSet].map(toObjectId).filter(Boolean);
      await recon.save();
    }

    const candidatesByLine = new Map(created.map((l) => [String(l._id), suggestMatchesForLine(candidates, l)]));
    const lines = created.map((l) => serializeLine(l.toObject(), candidatesByLine));

    return res.status(201).json({
      imported: created.length,
      autoMatched: newlyCleared.length,
      lines,
    });
  } catch (error) {
    next(error);
  }
};

// ─── Statement lines for a reconciliation, each with its live match suggestions ────────────────
export const listStatementLines = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));

    const id = toObjectId(req.params.id);
    if (!id) return next(createError(400, "Invalid ID"));

    const recon = await BankReconciliation.findOne({ _id: id, business: businessId }).lean();
    if (!recon) return next(createError(404, "Reconciliation not found"));

    const [lines, candidates] = await Promise.all([
      BankStatementLine.find({ business: businessId, reconciliation: id }).sort({ date: 1 }).populate("matchedEntry", "amount direction transactionDate notes").lean(),
      getCandidateEntries(businessId, recon),
    ]);

    const candidatesByLine = new Map(lines.map((l) => [String(l._id), suggestMatchesForLine(candidates, l)]));
    return res.status(200).json(lines.map((l) => serializeLine(l, candidatesByLine)));
  } catch (error) {
    next(error);
  }
};

// ─── Confirm a match between a statement line and an existing ledger entry ─────────────────────
export const matchStatementLine = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));

    const reconId = toObjectId(req.params.id);
    const lineId  = toObjectId(req.params.lineId);
    const entryId = toObjectId(req.body?.entryId);
    if (!reconId || !lineId) return next(createError(400, "Invalid ID"));
    if (!entryId) return next(createError(400, "entryId is required"));

    const recon = await BankReconciliation.findOne({ _id: reconId, business: businessId });
    if (!recon) return next(createError(404, "Reconciliation not found"));
    if (recon.status === "reconciled") return next(createError(400, "Cannot modify a finalised reconciliation"));

    const line = await BankStatementLine.findOne({ _id: lineId, business: businessId, reconciliation: reconId });
    if (!line) return next(createError(404, "Statement line not found"));
    if (line.status !== "unmatched") return next(createError(400, "This statement line is already matched"));

    const entry = await FinancialLedgerEntry.findOne({ _id: entryId, business: businessId, accountId: recon.account }).select("_id").lean();
    if (!entry) return next(createError(404, "Ledger entry not found on this account"));

    const alreadyClaimed = await BankStatementLine.findOne({
      business: businessId, reconciliation: reconId, matchedEntry: entryId, status: { $in: ["matched", "created"] },
    }).select("_id").lean();
    if (alreadyClaimed) return next(createError(400, "That ledger entry is already matched to another statement line"));

    line.status = "matched";
    line.matchedEntry = entryId;
    line.matchedBy = req.user?._id || null;
    line.matchedAt = new Date();
    await line.save();

    const clearedSet = new Set((recon.clearedEntries || []).map(String));
    clearedSet.add(String(entryId));
    recon.clearedEntries = [...clearedSet].map(toObjectId).filter(Boolean);
    await recon.save();

    return res.status(200).json({ line, reconciliation: recon });
  } catch (error) {
    next(error);
  }
};

// ─── Undo a confirmed (or auto-) match — never removes the imported statement line itself ──────
export const unmatchStatementLine = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));

    const reconId = toObjectId(req.params.id);
    const lineId  = toObjectId(req.params.lineId);
    if (!reconId || !lineId) return next(createError(400, "Invalid ID"));

    const recon = await BankReconciliation.findOne({ _id: reconId, business: businessId });
    if (!recon) return next(createError(404, "Reconciliation not found"));
    if (recon.status === "reconciled") return next(createError(400, "Cannot modify a finalised reconciliation"));

    const line = await BankStatementLine.findOne({ _id: lineId, business: businessId, reconciliation: reconId });
    if (!line) return next(createError(404, "Statement line not found"));
    if (line.status === "unmatched") return next(createError(400, "This statement line is not matched"));
    if (line.status === "created")
      return next(createError(400, "This line's transaction was posted from the statement — reverse that journal instead of unmatching"));

    const entryId = line.matchedEntry;
    line.status = "unmatched";
    line.matchedEntry = null;
    line.matchedBy = null;
    line.matchedAt = null;
    await line.save();

    if (entryId) {
      recon.clearedEntries = (recon.clearedEntries || []).filter((e) => String(e) !== String(entryId));
      await recon.save();
    }

    return res.status(200).json({ line, reconciliation: recon });
  } catch (error) {
    next(error);
  }
};

// ─── Post the missing transaction directly from an unmatched statement line ────────────────────
// Reuses the exact same multi-line-journal validation + ledger-posting machinery the Journal
// Entries module uses (services/journalLinesService.js) — this is a real, fully-audited journal,
// not a side-channel posting, so it shows up in Journal Entries like any other.
export const createTransactionFromStatementLine = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));

    const reconId = toObjectId(req.params.id);
    const lineId  = toObjectId(req.params.lineId);
    const offsetAccountId = toObjectId(req.body?.offsetAccount);
    if (!reconId || !lineId) return next(createError(400, "Invalid ID"));
    if (!offsetAccountId) return next(createError(400, "offsetAccount is required — which account is the other side of this transaction?"));

    const recon = await BankReconciliation.findOne({ _id: reconId, business: businessId });
    if (!recon) return next(createError(404, "Reconciliation not found"));
    if (recon.status === "reconciled") return next(createError(400, "Cannot modify a finalised reconciliation"));

    const line = await BankStatementLine.findOne({ _id: lineId, business: businessId, reconciliation: reconId });
    if (!line) return next(createError(404, "Statement line not found"));
    if (line.status !== "unmatched") return next(createError(400, "This statement line is already matched"));

    const description = String(req.body?.description || line.description || "").trim().slice(0, 200) || "From imported bank statement";

    const rawLines = [
      {
        account: String(recon.account),
        description,
        debit:  line.direction === "debit"  ? line.amount : 0,
        credit: line.direction === "credit" ? line.amount : 0,
      },
      {
        account: String(offsetAccountId),
        description,
        debit:  line.direction === "credit" ? line.amount : 0,
        credit: line.direction === "debit"  ? line.amount : 0,
      },
    ];
    const { lines: validatedLines, totalDebit } = await validateJournalLines({ businessId, lines: rawLines });

    const actorUserId = await resolveAuditActorUserId({
      req, businessId,
      fallbackErrorMessage: "No valid company user could be resolved for posting this transaction.",
    });

    const counter = await SequenceCounter.findOneAndUpdate(
      { business: businessId, key: "journal_no" },
      { $setOnInsert: { business: businessId, key: "journal_no" }, $inc: { sequence: 1 } },
      { new: true, upsert: true }
    ).lean();
    const journalNo = `JRN${String(counter.sequence).padStart(4, "0")}`;

    const journal = await JournalEntry.create({
      journalNo,
      date: line.date,
      journalType: "adjustment",
      sourceModule: "accounts",
      reference: line.reference || "",
      narration: description,
      lines: validatedLines,
      amount: totalDebit,
      debitAccount: null,
      creditAccount: null,
      includeInLandlordStatement: false,
      status: "draft",
      createdBy: actorUserId,
      business: businessId,
    });

    const posted = await postLinesJournalToLedger({ journal, actorUserId });
    const ownEntry = posted.find((p) => String(p.accountId) === String(recon.account)) || posted[0];

    line.status = "created";
    line.matchedEntry = ownEntry._id;
    line.matchedBy = req.user?._id || null;
    line.matchedAt = new Date();
    await line.save();

    const clearedSet = new Set((recon.clearedEntries || []).map(String));
    clearedSet.add(String(ownEntry._id));
    recon.clearedEntries = [...clearedSet].map(toObjectId).filter(Boolean);
    await recon.save();

    return res.status(201).json({ line, journal, reconciliation: recon });
  } catch (error) {
    next(error);
  }
};

// ─── Delete draft reconciliation ───────────────────────────────────────────────
export const deleteReconciliation = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));

    const id = toObjectId(req.params.id);
    if (!id) return next(createError(400, "Invalid ID"));

    const recon = await BankReconciliation.findOne({ _id: id, business: businessId });
    if (!recon) return next(createError(404, "Reconciliation not found"));
    if (recon.status === "reconciled")
      return next(createError(400, "Cannot delete a finalised reconciliation"));

    await Promise.all([
      recon.deleteOne(),
      BankStatementLine.deleteMany({ business: businessId, reconciliation: id }),
    ]);
    return res.status(200).json({ message: "Deleted" });
  } catch (error) {
    next(error);
  }
};
