import mongoose from "mongoose";
import Budget from "../../models/Budget.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";

const toObjectId = (v) => {
  const raw = typeof v === "object" && v?._id ? v._id : v;
  if (!raw || !mongoose.Types.ObjectId.isValid(String(raw))) return null;
  return new mongoose.Types.ObjectId(String(raw));
};

const resolveBusinessId = (req) => {
  const id = req.query?.business || req.query?.company || req.body?.business || req.body?.company;
  return toObjectId(id);
};

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// ─── Compute actuals for a set of accountIds over a period ────────────────────
const computeActuals = async (businessId, accountIds, periodStart, periodEnd) => {
  if (!accountIds.length) return new Map();

  const end = new Date(periodEnd);
  end.setHours(23, 59, 59, 999);

  const results = await FinancialLedgerEntry.aggregate([
    {
      $match: {
        business:  businessId,
        accountId: { $in: accountIds },
        status:    { $in: ["approved", "posted"] },
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
  ]);

  const map = new Map();
  for (const r of results) {
    if (r._id != null) map.set(String(r._id), { debit: r.debit || 0, credit: r.credit || 0 });
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
    if (!businessId) return res.status(400).json({ message: "Missing business" });

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
    if (!businessId) return res.status(400).json({ message: "Missing business" });

    const budget = await Budget.findOne({ _id: req.params.id, business: businessId }).lean();
    if (!budget) return res.status(404).json({ message: "Budget not found" });

    const accountIds = budget.lines.map((l) => toObjectId(l.account)).filter(Boolean);
    const actualsMap = await computeActuals(businessId, accountIds, budget.periodStart, budget.periodEnd);

    const lines = budget.lines.map((line) => {
      const key = String(line.account);
      const { debit = 0, credit = 0 } = actualsMap.get(key) || {};
      const actual = netActual(line.accountType, debit, credit);
      const budgeted = round2(Number(line.budgetedAmount || 0));
      const variance = round2(budgeted - actual);
      const pctUsed = budgeted > 0 ? round2((actual / budgeted) * 100) : null;
      return { ...line, actual, budgeted, variance, pctUsed };
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
    if (!businessId) return res.status(400).json({ message: "Missing business" });

    const { name, periodStart, periodEnd, notes, lines = [] } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "Budget name is required" });
    if (!periodStart || !periodEnd) return res.status(400).json({ message: "Period start and end are required" });

    const sanitizedLines = await buildLines(lines, businessId);

    const budget = await Budget.create({
      business:    businessId,
      name:        String(name).trim(),
      periodStart: new Date(periodStart),
      periodEnd:   new Date(periodEnd),
      status:      "draft",
      notes:       String(notes || ""),
      lines:       sanitizedLines,
      createdBy:   toObjectId(req.user?._id || req.user?.id),
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
    if (!businessId) return res.status(400).json({ message: "Missing business" });

    const budget = await Budget.findOne({ _id: req.params.id, business: businessId });
    if (!budget) return res.status(404).json({ message: "Budget not found" });
    if (budget.status === "closed") return res.status(400).json({ message: "Closed budgets cannot be edited" });

    const { name, periodStart, periodEnd, notes, status, lines } = req.body;
    if (name !== undefined) budget.name = String(name).trim();
    if (periodStart !== undefined) budget.periodStart = new Date(periodStart);
    if (periodEnd !== undefined) budget.periodEnd = new Date(periodEnd);
    if (notes !== undefined) budget.notes = String(notes);
    if (status !== undefined && ["draft", "active", "closed"].includes(status)) budget.status = status;
    if (Array.isArray(lines)) budget.lines = await buildLines(lines, businessId);

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
    if (!businessId) return res.status(400).json({ message: "Missing business" });

    const budget = await Budget.findOne({ _id: req.params.id, business: businessId });
    if (!budget) return res.status(404).json({ message: "Budget not found" });
    if (budget.status !== "draft") return res.status(400).json({ message: "Only draft budgets can be deleted" });

    await budget.deleteOne();
    return res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
};

// ─── Helper: sanitize + denormalize lines ─────────────────────────────────────
async function buildLines(rawLines, businessId) {
  if (!rawLines?.length) return [];

  const accountIds = rawLines.map((l) => toObjectId(l.account)).filter(Boolean);
  const accounts = await ChartOfAccount.find({ _id: { $in: accountIds }, business: businessId })
    .select("_id code name type").lean();
  const acctMap = new Map(accounts.map((a) => [String(a._id), a]));

  return rawLines
    .filter((l) => toObjectId(l.account) && Number(l.budgetedAmount) >= 0)
    .map((l) => {
      const acct = acctMap.get(String(toObjectId(l.account)));
      return {
        account:        toObjectId(l.account),
        accountCode:    acct?.code || "",
        accountName:    acct?.name || "",
        accountType:    acct?.type || "",
        budgetedAmount: round2(Number(l.budgetedAmount || 0)),
      };
    });
}
