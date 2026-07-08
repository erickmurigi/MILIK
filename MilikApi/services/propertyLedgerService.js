/**
 * propertyLedgerService.js
 *
 * Core engine for Property GL — the isolated per-property ledger.
 * Used when property.accountLedgerType === "property-gl" AND property.propertyLedgerEnabled === true.
 *
 * Design principles:
 *  - Every report is a single MongoDB aggregation pipeline. No in-memory summation.
 *  - All reads use .lean() — zero Mongoose hydration overhead.
 *  - Indexes on PropertyLedgerEntry are shaped for every query pattern here.
 *  - The main JournalEntry collection is never touched by this service.
 */

import mongoose from "mongoose";
import PropertyLedgerEntry from "../models/PropertyLedgerEntry.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import Property from "../models/Property.js";

const { isValidObjectId, Types: { ObjectId } } = mongoose;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const toOid = (v) => {
  if (v instanceof ObjectId) return v;
  const s = String(v || "").trim();
  return isValidObjectId(s) ? new ObjectId(s) : null;
};

const normalizeDate = (value, endOfDay = false) => {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  if (endOfDay) { d.setHours(23, 59, 59, 999); }
  else { d.setHours(0, 0, 0, 0); }
  return d;
};

const statementPeriodKey = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
};

// 5-min cache: business → { code → accountId }
const _acctCache = new Map();
const _CACHE_TTL = 5 * 60 * 1000;

const getCachedAccount = async (businessId, code) => {
  const key = `${businessId}:${code}`;
  const hit = _acctCache.get(key);
  if (hit && Date.now() - hit.at < _CACHE_TTL) return hit.id;
  const acct = await ChartOfAccount.findOne({ business: businessId, code, isPosting: true })
    .select("_id").lean();
  const id = acct?._id || null;
  if (id) _acctCache.set(key, { id, at: Date.now() });
  return id;
};

// ─── Account resolution ───────────────────────────────────────────────────────

/**
 * Resolves the standard system accounts needed for property ledger postings.
 * Fetched in parallel, results cached per business for 5 minutes.
 */
export const resolvePropertyLedgerAccounts = async (businessId) => {
  const [
    receivables,    // 1200 — tenant receivables
    depositsHeld,   // 2100 — security deposits payable
    rentIncome,     // 4100 — rent income
    serviceCharge,  // 4101 — service charge income
    utilityIncome,  // 4102 — utility recharge income
    penaltyIncome,  // 4103 — late penalty income
    commission,     // 5100 — management commission expense (from property's perspective)
  ] = await Promise.all([
    getCachedAccount(businessId, "1200"),
    getCachedAccount(businessId, "2100"),
    getCachedAccount(businessId, "4100"),
    getCachedAccount(businessId, "4101"),
    getCachedAccount(businessId, "4102"),
    getCachedAccount(businessId, "4103"),
    getCachedAccount(businessId, "5100"),
  ]);
  return { receivables, depositsHeld, rentIncome, serviceCharge, utilityIncome, penaltyIncome, commission };
};

// ─── Posting ──────────────────────────────────────────────────────────────────

/**
 * Posts a balanced pair of lines (debit + credit) to the property ledger.
 * groupId links both lines into one logical journal entry.
 *
 * Returns the two saved documents.
 */
export const postPropertyLedgerEntry = async ({
  businessId,
  propertyId,
  debitAccountId,
  creditAccountId,
  amount,
  date,
  narration = "",
  reference = "",
  category = "other",
  tenantId = null,
  unitId = null,
  invoiceId = null,
  paymentId = null,
  postedBy = null,
  session = null,
}) => {
  const groupId = new ObjectId();
  const txDate  = normalizeDate(date) || new Date();
  const period  = statementPeriodKey(txDate);
  const base = {
    business:        toOid(businessId),
    property:        toOid(propertyId),
    groupId,
    date:            txDate,
    statementPeriod: period,
    narration,
    reference,
    category,
    tenant:  toOid(tenantId),
    unit:    toOid(unitId),
    invoice: toOid(invoiceId),
    payment: toOid(paymentId),
    postedBy: toOid(postedBy),
    postedAt: new Date(),
    isReversed: false,
  };
  const amt = Math.max(0, Number(amount) || 0);
  const opts = session ? { session } : {};
  const [dr, cr] = await PropertyLedgerEntry.insertMany(
    [
      { ...base, account: toOid(debitAccountId),  debit: amt,  credit: 0 },
      { ...base, account: toOid(creditAccountId), debit: 0,    credit: amt },
    ],
    opts
  );
  return { groupId, debit: dr, credit: cr };
};

/**
 * Reverses all non-reversed lines in a groupId.
 * Creates mirror lines (debit↔credit) and marks originals isReversed=true.
 */
export const reversePropertyLedgerEntry = async ({
  groupId,
  propertyId,
  date = new Date(),
  narration = "Reversal",
  postedBy = null,
  session = null,
}) => {
  const originals = await PropertyLedgerEntry.find({
    groupId: toOid(groupId),
    property: toOid(propertyId),
    isReversed: false,
  }).lean();
  if (!originals.length) return [];

  const txDate  = normalizeDate(date) || new Date();
  const period  = statementPeriodKey(txDate);
  const newGroupId = new ObjectId();
  const reversals = originals.map((o) => ({
    business:        o.business,
    property:        o.property,
    groupId:         newGroupId,
    account:         o.account,
    date:            txDate,
    statementPeriod: period,
    narration,
    reference:       o.reference,
    category:        o.category,
    tenant:          o.tenant,
    unit:            o.unit,
    invoice:         o.invoice,
    payment:         o.payment,
    // Swap debit and credit
    debit:           o.credit,
    credit:          o.debit,
    postedBy:        toOid(postedBy),
    postedAt:        new Date(),
    isReversed:      false,
    reversalOf:      o._id,
  }));

  const opts = session ? { session } : {};
  await PropertyLedgerEntry.insertMany(reversals, opts);
  await PropertyLedgerEntry.updateMany(
    { groupId: toOid(groupId), property: toOid(propertyId) },
    { $set: { isReversed: true } },
    opts
  );
  return reversals;
};

// ─── Reports (pure aggregation pipelines) ─────────────────────────────────────

/**
 * Trial Balance — net debit/credit per account for a property ledger.
 * All non-reversed entries up to asOfDate.
 */
export const getPropertyTrialBalance = async ({ propertyId, asOfDate, includeZeroBalances = false }) => {
  const pid  = toOid(propertyId);
  const asOf = normalizeDate(asOfDate, true) || new Date();

  const pipeline = [
    { $match: { property: pid, date: { $lte: asOf }, isReversed: false } },
    {
      $group: {
        _id: "$account",
        totalDebit:  { $sum: "$debit" },
        totalCredit: { $sum: "$credit" },
      },
    },
    {
      $lookup: {
        from: "chartofaccounts",
        localField: "_id",
        foreignField: "_id",
        as: "acct",
        pipeline: [{ $project: { code: 1, name: 1, type: 1, group: 1 } }],
      },
    },
    { $unwind: "$acct" },
    {
      $addFields: {
        balance: { $subtract: ["$totalDebit", "$totalCredit"] },
      },
    },
    ...(!includeZeroBalances
      ? [{ $match: { $expr: { $ne: [{ $abs: "$balance" }, 0] } } }]
      : []),
    {
      $project: {
        _id: 0,
        accountId:   "$_id",
        code:        "$acct.code",
        name:        "$acct.name",
        type:        "$acct.type",
        group:       "$acct.group",
        totalDebit:  1,
        totalCredit: 1,
        balance:     1,
      },
    },
    { $sort: { code: 1 } },
  ];

  const rows = await PropertyLedgerEntry.aggregate(pipeline).allowDiskUse(false);
  const totalDebit  = rows.reduce((s, r) => s + r.totalDebit,  0);
  const totalCredit = rows.reduce((s, r) => s + r.totalCredit, 0);
  const difference  = Math.abs(totalDebit - totalCredit);

  return {
    rows,
    totals: {
      debit:    totalDebit,
      credit:   totalCredit,
      difference,
      balanced: difference < 0.005,
    },
    asOfDate: asOf,
    count: rows.length,
  };
};

/**
 * Income Statement — income vs expense accounts for a date range.
 * Grouped by account type → group → account name.
 */
export const getPropertyIncomeStatement = async ({ propertyId, startDate, endDate }) => {
  const pid   = toOid(propertyId);
  const start = normalizeDate(startDate)       || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const end   = normalizeDate(endDate, true)   || new Date();

  const pipeline = [
    { $match: { property: pid, date: { $gte: start, $lte: end }, isReversed: false } },
    {
      $lookup: {
        from: "chartofaccounts",
        localField: "account",
        foreignField: "_id",
        as: "acct",
        pipeline: [{ $project: { code: 1, name: 1, type: 1, group: 1, subGroup: 1 } }],
      },
    },
    { $unwind: "$acct" },
    { $match: { "acct.type": { $in: ["income", "expense"] } } },
    {
      $group: {
        _id: {
          type:     "$acct.type",
          group:    "$acct.group",
          subGroup: "$acct.subGroup",
          acctId:   "$account",
          code:     "$acct.code",
          name:     "$acct.name",
        },
        totalDebit:  { $sum: "$debit" },
        totalCredit: { $sum: "$credit" },
      },
    },
    {
      $addFields: {
        // Income: credit-heavy (net = credit - debit). Expense: debit-heavy (net = debit - credit).
        amount: {
          $cond: [
            { $eq: ["$_id.type", "income"] },
            { $subtract: ["$totalCredit", "$totalDebit"] },
            { $subtract: ["$totalDebit",  "$totalCredit"] },
          ],
        },
      },
    },
    { $sort: { "_id.type": 1, "_id.group": 1, "_id.code": 1 } },
  ];

  const rows = await PropertyLedgerEntry.aggregate(pipeline).allowDiskUse(false);

  // Group into income / expense sections
  const incomeRows  = rows.filter((r) => r._id.type === "income");
  const expenseRows = rows.filter((r) => r._id.type === "expense");

  const buildSections = (list) => {
    const byGroup = {};
    for (const r of list) {
      const g = r._id.group || "General";
      if (!byGroup[g]) byGroup[g] = { label: g, rows: [], total: 0 };
      byGroup[g].rows.push({ code: r._id.code, name: r._id.name, amount: r.amount });
      byGroup[g].total += r.amount;
    }
    return Object.values(byGroup);
  };

  const incomeSections  = buildSections(incomeRows);
  const expenseSections = buildSections(expenseRows);
  const totalIncome   = incomeSections.reduce((s, g) => s + g.total, 0);
  const totalExpenses = expenseSections.reduce((s, g) => s + g.total, 0);
  const netProfit     = totalIncome - totalExpenses;

  return {
    income:   { sections: incomeSections,  total: totalIncome,   count: incomeRows.length },
    expenses: { sections: expenseSections, total: totalExpenses, count: expenseRows.length },
    summary: {
      totalIncome,
      totalExpenses,
      netProfit,
      resultLabel: netProfit >= 0 ? "Net Profit" : "Net Loss",
    },
    startDate: start,
    endDate:   end,
  };
};

/**
 * Balance Sheet — asset / liability / equity account balances as at a date.
 */
export const getPropertyBalanceSheet = async ({ propertyId, asOfDate, includeZeroBalances = false }) => {
  const pid  = toOid(propertyId);
  const asOf = normalizeDate(asOfDate, true) || new Date();

  const pipeline = [
    { $match: { property: pid, date: { $lte: asOf }, isReversed: false } },
    {
      $group: {
        _id: "$account",
        totalDebit:  { $sum: "$debit" },
        totalCredit: { $sum: "$credit" },
      },
    },
    {
      $lookup: {
        from: "chartofaccounts",
        localField: "_id",
        foreignField: "_id",
        as: "acct",
        pipeline: [{ $project: { code: 1, name: 1, type: 1, group: 1 } }],
      },
    },
    { $unwind: "$acct" },
    { $match: { "acct.type": { $in: ["asset", "liability", "equity"] } } },
    {
      $addFields: {
        balance: {
          $cond: [
            { $in: ["$acct.type", ["asset"]] },
            { $subtract: ["$totalDebit", "$totalCredit"] },
            { $subtract: ["$totalCredit", "$totalDebit"] },
          ],
        },
      },
    },
    ...(!includeZeroBalances
      ? [{ $match: { $expr: { $ne: [{ $abs: "$balance" }, 0] } } }]
      : []),
    { $sort: { "acct.type": 1, "acct.code": 1 } },
  ];

  const rows = await PropertyLedgerEntry.aggregate(pipeline).allowDiskUse(false);

  const buildSections = (type) => {
    const list = rows.filter((r) => r.acct.type === type);
    const byGroup = {};
    for (const r of list) {
      const g = r.acct.group || "General";
      if (!byGroup[g]) byGroup[g] = { label: g, rows: [], total: 0 };
      byGroup[g].rows.push({ code: r.acct.code, name: r.acct.name, balance: r.balance });
      byGroup[g].total += r.balance;
    }
    const sections = Object.values(byGroup);
    return { sections, total: sections.reduce((s, g) => s + g.total, 0), count: list.length };
  };

  const assets      = buildSections("asset");
  const liabilities = buildSections("liability");
  const equity      = buildSections("equity");
  const totalLiabilitiesAndEquity = liabilities.total + equity.total;
  const difference  = Math.abs(assets.total - totalLiabilitiesAndEquity);

  return {
    assets,
    liabilities,
    equity,
    summary: {
      totalAssets: assets.total,
      totalLiabilities: liabilities.total,
      totalEquity: equity.total,
      totalLiabilitiesAndEquity,
      difference,
      balanced: difference < 0.005,
    },
    asOfDate: asOf,
  };
};

/**
 * Journal Entries — paginated list of grouped entries for a property ledger.
 * Returns one row per groupId with the full set of lines.
 */
export const getPropertyLedgerJournals = async ({
  propertyId,
  startDate,
  endDate,
  page = 1,
  limit = 50,
}) => {
  const pid   = toOid(propertyId);
  const start = normalizeDate(startDate);
  const end   = normalizeDate(endDate, true);
  const skip  = (Math.max(1, page) - 1) * Math.min(limit, 200);

  const dateFilter = {};
  if (start) dateFilter.$gte = start;
  if (end)   dateFilter.$lte = end;

  const matchStage = { property: pid, isReversed: false };
  if (Object.keys(dateFilter).length) matchStage.date = dateFilter;

  const pipeline = [
    { $match: matchStage },
    { $sort: { date: -1, groupId: 1 } },
    // Group lines by logical journal entry
    {
      $group: {
        _id: "$groupId",
        date:      { $first: "$date" },
        narration: { $first: "$narration" },
        reference: { $first: "$reference" },
        category:  { $first: "$category" },
        lines: {
          $push: {
            account:  "$account",
            debit:    "$debit",
            credit:   "$credit",
            tenant:   "$tenant",
            invoice:  "$invoice",
            payment:  "$payment",
          },
        },
        totalDebit: { $sum: "$debit" },
      },
    },
    { $sort: { date: -1 } },
    { $facet: {
      data:  [{ $skip: skip }, { $limit: Math.min(limit, 200) }],
      count: [{ $count: "total" }],
    }},
  ];

  const [result] = await PropertyLedgerEntry.aggregate(pipeline).allowDiskUse(false);
  const total = result?.count?.[0]?.total || 0;

  // Bulk-populate account names in one query
  const accountIds = [...new Set(
    (result?.data || []).flatMap((e) => e.lines.map((l) => l.account)).filter(Boolean)
  )];
  const accounts = await ChartOfAccount.find({ _id: { $in: accountIds } })
    .select("code name").lean();
  const acctMap = Object.fromEntries(accounts.map((a) => [String(a._id), a]));

  const journals = (result?.data || []).map((e) => ({
    groupId:   e._id,
    date:      e.date,
    narration: e.narration,
    reference: e.reference,
    category:  e.category,
    amount:    e.totalDebit,
    lines: e.lines.map((l) => ({
      ...l,
      accountCode: acctMap[String(l.account)]?.code || "",
      accountName: acctMap[String(l.account)]?.name || "",
    })),
  }));

  return { journals, total, page, limit };
};

/**
 * Checks whether a property has Property GL active.
 * Lightweight — single indexed query, lean.
 */
export const isPropertyLedgerActive = async (propertyId) => {
  const p = await Property.findById(toOid(propertyId))
    .select("accountLedgerType propertyLedgerEnabled").lean();
  if (!p) return false;
  const v = String(p.accountLedgerType || "").toLowerCase().trim();
  return (v.startsWith("off") || v === "property-gl") && !!p.propertyLedgerEnabled;
};
