import Budget from "../../models/Budget.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import { toObjectId } from "../../utils/db.js";
import { resolveBusinessId, currentUserId } from "../../utils/requestContext.js";
import { createError } from "../../utils/error.js";
import { round2 } from "../../utils/math.js";

// Same status set every other GL report uses (financialReports.js, ledgerDiagnostics.js):
// a reversal flips the original entry to "reversed" (keeping its original amount) and posts
// a new offsetting entry as "approved" — both legs are needed so they net to zero.
const REPORT_LEDGER_STATUSES = ["approved", "reversed"];

// ─── Every "YYYY-MM" the period touches (inclusive of partial start/end months) ───
const monthsInPeriod = (periodStart, periodEnd) => {
  const months = [];
  const cursor = new Date(periodStart.getFullYear(), periodStart.getMonth(), 1);
  const last = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 1);
  while (cursor <= last) {
    months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
};

// ─── Compute actuals for a set of accountIds over a period ────────────────────
const computeActuals = async (businessId, accountIds, periodStart, periodEnd) => {
  if (!accountIds.length) return new Map();

  const end = new Date(periodEnd);
  end.setHours(23, 59, 59, 999);

  // aggregate() does not auto-cast strings → ObjectId the way find() does — must cast explicitly.
  const businessOid = toObjectId(businessId);

  const results = await FinancialLedgerEntry.aggregate([
    {
      $match: {
        business:  businessOid,
        accountId: { $in: accountIds },
        status:    { $in: REPORT_LEDGER_STATUSES },
        transactionDate: { $gte: new Date(periodStart), $lte: end },
      },
    },
    {
      $group: {
        _id:    "$accountId",
        debit:  { $sum: { $cond: [{ $eq: ["$direction", "debit"]  }, { $ifNull: ["$amount", 0] }, 0] } },
        credit: { $sum: { $cond: [{ $eq: ["$direction", "credit"] }, { $ifNull: ["$amount", 0] }, 0] } },
      },
    },
  ]).allowDiskUse(true);

  const map = new Map();
  for (const r of results) {
    if (r._id != null) map.set(String(r._id), { debit: r.debit || 0, credit: r.credit || 0 });
  }
  return map;
};

// ─── Same as computeActuals but grouped by account + calendar month, for budget lines ──
// that have a monthly spread. Keyed "accountId:YYYY-MM" -> { debit, credit }.
const computeMonthlyActuals = async (businessId, accountIds, periodStart, periodEnd) => {
  if (!accountIds.length) return new Map();

  const end = new Date(periodEnd);
  end.setHours(23, 59, 59, 999);
  const businessOid = toObjectId(businessId);

  const results = await FinancialLedgerEntry.aggregate([
    {
      $match: {
        business:  businessOid,
        accountId: { $in: accountIds },
        status:    { $in: REPORT_LEDGER_STATUSES },
        transactionDate: { $gte: new Date(periodStart), $lte: end },
      },
    },
    {
      $group: {
        _id: { accountId: "$accountId", month: { $dateToString: { format: "%Y-%m", date: "$transactionDate" } } },
        debit:  { $sum: { $cond: [{ $eq: ["$direction", "debit"]  }, { $ifNull: ["$amount", 0] }, 0] } },
        credit: { $sum: { $cond: [{ $eq: ["$direction", "credit"] }, { $ifNull: ["$amount", 0] }, 0] } },
      },
    },
  ]).allowDiskUse(true);

  const map = new Map();
  for (const r of results) {
    if (r._id?.accountId == null) continue;
    map.set(`${String(r._id.accountId)}:${r._id.month}`, { debit: r.debit || 0, credit: r.credit || 0 });
  }
  return map;
};

// ─── Net actual for a line (positive = "spent / earned" in the normal sense) ──
const netActual = (accountType, debit, credit) => {
  if (accountType === "income" || accountType === "liability" || accountType === "equity") {
    return round2(credit - debit); // normal credit-side accounts
  }
  return round2(debit - credit); // normal debit-side: asset, expense
};

// ─── List budgets ─────────────────────────────────────────────────────────────
export const getBudgets = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));

    const filter = { business: businessId };
    if (req.query.status) filter.status = req.query.status;

    const budgets = await Budget.find(filter)
      .select("name periodStart periodEnd status notes createdAt lines")
      .sort({ periodStart: -1, createdAt: -1 })
      .lean();

    const enriched = budgets.map((b) => ({
      ...b,
      totalBudgeted: round2(b.lines.reduce((s, l) => s + Number(l.budgetedAmount || 0), 0)),
      lineCount: b.lines.length,
    }));

    return res.status(200).json(enriched);
  } catch (err) {
    next(err);
  }
};

// ─── Single budget with variance report ───────────────────────────────────────
export const getBudget = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));

    const budget = await Budget.findOne({ _id: req.params.id, business: businessId }).lean();
    if (!budget) return next(createError(404, "Budget not found"));

    const accountIds = budget.lines.map((l) => toObjectId(l.account)).filter(Boolean);
    const hasMonthlyLines = budget.lines.some((l) => l.monthlyAmounts?.length);
    const [actualsMap, monthlyActualsMap] = await Promise.all([
      computeActuals(businessId, accountIds, budget.periodStart, budget.periodEnd),
      hasMonthlyLines ? computeMonthlyActuals(businessId, accountIds, budget.periodStart, budget.periodEnd) : Promise.resolve(new Map()),
    ]);

    const lines = budget.lines.map((line) => {
      const key = String(line.account);
      const { debit = 0, credit = 0 } = actualsMap.get(key) || {};
      const actual = netActual(line.accountType, debit, credit);
      const budgeted = round2(Number(line.budgetedAmount || 0));
      const variance = round2(budgeted - actual);
      const pctUsed = budgeted > 0 ? round2((actual / budgeted) * 100) : null;

      const monthly = (line.monthlyAmounts || []).map((m) => {
        const { debit: md = 0, credit: mc = 0 } = monthlyActualsMap.get(`${key}:${m.month}`) || {};
        const mActual = netActual(line.accountType, md, mc);
        return { month: m.month, budgeted: round2(m.amount), actual: mActual, variance: round2(m.amount - mActual) };
      });

      return { ...line, actual, budgeted, variance, pctUsed, monthly };
    });

    return res.status(200).json({ ...budget, lines });
  } catch (err) {
    next(err);
  }
};

// ─── Create ───────────────────────────────────────────────────────────────────
export const createBudget = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));

    const { name, periodStart, periodEnd, notes, lines = [] } = req.body;
    if (!name?.trim()) return next(createError(400, "Budget name is required"));
    if (!periodStart || !periodEnd) return next(createError(400, "Period start and end are required"));
    if (new Date(periodEnd) < new Date(periodStart)) return next(createError(400, "Period end must be on or after period start"));

    const sanitizedLines = await buildLines(lines, businessId, periodStart, periodEnd);

    const budget = await Budget.create({
      business:    businessId,
      name:        String(name).trim(),
      periodStart: new Date(periodStart),
      periodEnd:   new Date(periodEnd),
      status:      "draft",
      notes:       String(notes || ""),
      lines:       sanitizedLines,
      createdBy:   currentUserId(req),
    });

    return res.status(201).json(budget);
  } catch (err) {
    next(err);
  }
};

// ─── Update (name/period/notes/status + replace lines) ────────────────────────
export const updateBudget = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));

    const budget = await Budget.findOne({ _id: req.params.id, business: businessId });
    if (!budget) return next(createError(404, "Budget not found"));
    if (budget.status === "closed") return next(createError(400, "Closed budgets cannot be edited"));

    const { name, periodStart, periodEnd, notes, status, lines } = req.body;
    if (name !== undefined) budget.name = String(name).trim();
    if (periodStart !== undefined) budget.periodStart = new Date(periodStart);
    if (periodEnd !== undefined) budget.periodEnd = new Date(periodEnd);
    if (budget.periodEnd < budget.periodStart) return next(createError(400, "Period end must be on or after period start"));
    if (notes !== undefined) budget.notes = String(notes);
    if (status !== undefined && ["draft", "active", "closed"].includes(status)) budget.status = status;
    if (Array.isArray(lines)) budget.lines = await buildLines(lines, businessId, budget.periodStart, budget.periodEnd);

    await budget.save();
    return res.status(200).json(budget);
  } catch (err) {
    next(err);
  }
};

// ─── Delete (draft only) ──────────────────────────────────────────────────────
export const deleteBudget = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));

    const budget = await Budget.findOne({ _id: req.params.id, business: businessId });
    if (!budget) return next(createError(404, "Budget not found"));
    if (budget.status !== "draft") return next(createError(400, "Only draft budgets can be deleted"));

    await budget.deleteOne();
    return res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
};

// ─── Helper: sanitize + denormalize lines ─────────────────────────────────────
// Drops lines for an account id that isn't valid or doesn't belong to this business (instead
// of keeping an orphaned reference with blank denormalized fields), and merges duplicate
// accounts into a single line (summing budgetedAmount, and monthlyAmounts per month) so the
// same account can never appear twice — computeActuals groups actuals by accountId, so a
// duplicate would double-count the budgeted side against one shared actual figure.
//
// monthlyAmounts is opt-in per line: when a line carries it, every entry's month must fall
// within the budget's own period (out-of-range months are dropped, not errored — a client
// retrying after a period edit shouldn't hard-fail), amounts are rounded, and budgetedAmount
// is recomputed as their sum — the client's own total is never trusted once a spread is given,
// so the two can never silently drift apart.
async function buildLines(rawLines, businessId, periodStart, periodEnd) {
  if (!rawLines?.length) return [];

  const validMonths = new Set(monthsInPeriod(new Date(periodStart), new Date(periodEnd)));
  const accountIds = rawLines.map((l) => toObjectId(l.account)).filter(Boolean);
  const accounts = await ChartOfAccount.find({ _id: { $in: accountIds }, business: businessId })
    .select("_id code name type").lean();
  const acctMap = new Map(accounts.map((a) => [String(a._id), a]));

  const merged = new Map();
  for (const l of rawLines) {
    const accountOid = toObjectId(l.account);
    const acct = accountOid && acctMap.get(String(accountOid));
    const hasMonthly = Array.isArray(l.monthlyAmounts) && l.monthlyAmounts.length > 0;
    if (!acct || (!hasMonthly && Number(l.budgetedAmount) < 0)) continue;

    const key = String(accountOid);
    const prior = merged.get(key);

    const monthlyMap = new Map((prior?.monthlyAmounts || []).map((m) => [m.month, m.amount]));
    if (hasMonthly) {
      for (const m of l.monthlyAmounts) {
        if (!validMonths.has(m.month) || Number(m.amount) < 0) continue;
        monthlyMap.set(m.month, round2((monthlyMap.get(m.month) || 0) + Number(m.amount || 0)));
      }
    }
    const monthlyAmounts = Array.from(monthlyMap, ([month, amount]) => ({ month, amount }))
      .sort((a, b) => a.month.localeCompare(b.month));

    const budgetedAmount = monthlyAmounts.length
      ? round2(monthlyAmounts.reduce((s, m) => s + m.amount, 0))
      : round2((prior?.budgetedAmount || 0) + Number(l.budgetedAmount || 0));

    merged.set(key, {
      account:        accountOid,
      accountCode:    acct.code || "",
      accountName:    acct.name || "",
      accountType:    acct.type || "",
      budgetedAmount,
      monthlyAmounts,
    });
  }

  return Array.from(merged.values());
}
