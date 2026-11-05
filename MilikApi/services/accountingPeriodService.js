// Accounting periods: generating a fiscal year, the close checklist, close / lock / reopen in order,
// and closing a fiscal year.
//
// Rules, as in NetSuite / Sage:
//   - periods close and lock oldest first, and reopen newest first;
//   - a locked period is final;
//   - closing a fiscal year locks all of its periods. It posts nothing: the Balance Sheet works out
//     retained earnings (profit before the fiscal year) and current-year earnings from the dates,
//     the way Xero and QuickBooks do, so the books can't be unbalanced by a closing journal.
import mongoose from "mongoose";
import AccountingPeriod from "../models/AccountingPeriod.js";
import Company from "../models/Company.js";
import User from "../models/User.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import PaymentVoucher from "../models/PaymentVoucher.js";
import JournalEntry from "../models/JournalEntry.js";
import RentPayment from "../models/RentPayment.js";
import BankReconciliation from "../models/BankReconciliation.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import FixedAsset from "../models/FixedAsset.js";
import ClientRevenueSchedule from "../modules/clients/models/ClientRevenueSchedule.js";
import ClientBillingSchedule from "../modules/clients/models/ClientBillingSchedule.js";
import { createError } from "../utils/error.js";
import { logAuditEvent } from "../utils/auditLogger.js";
import {
  dayEnd, dayStart, fiscalStartMonthIndex, fiscalYearFromStart, fiscalYearOf, isYmd, monthlyPeriodsOf, nextDayYmd, toYmd,
} from "../utils/fiscalPeriods.js";

const REPORT_STATUSES = ["approved", "reversed"];
const HALF_DAY_MS = 12 * 60 * 60 * 1000;

const oid = (id) => new mongoose.Types.ObjectId(String(id));

const fiscalMonthOf = async (businessId) =>
  fiscalStartMonthIndex(await Company.findById(businessId).select("fiscalStartMonth").lean());

// Who did it, as stored on the period: a user id when there is one, and always a readable name.
export const resolveActor = async (user = {}) => {
  const id = String(user?.id || user?._id || "");
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return { by: null, byName: user?.name || (user?.isSystemAdmin ? "Milik Admin" : user?.email || "") };
  }
  const record = await User.findById(id).select("surname otherNames email").lean();
  const byName = [record?.surname, record?.otherNames].filter(Boolean).join(" ").trim() || record?.email || user?.email || "";
  return { by: oid(id), byName };
};

const auditPeriod = (req, businessId, period, action, message, metadata = {}) =>
  logAuditEvent({
    req, company: businessId, action: `accounting_period.${action}`, category: "finance",
    severity: action === "reopened" || action === "year_closed" || action === "locked" ? "critical" : "important",
    targetType: "AccountingPeriod", targetId: period?._id || "", targetName: period?.name || "", message, metadata,
  });

const parseRange = ({ startDate, endDate }) => {
  const startYmd = isYmd(startDate) ? startDate : toYmd(startDate);
  const endYmd = isYmd(endDate) ? endDate : toYmd(endDate);
  if (!startYmd || !endYmd) throw createError(400, "Start and end dates are required");
  if (endYmd < startYmd) throw createError(400, "The end date must be on or after the start date");
  return { start: dayStart(startYmd), end: dayEnd(endYmd) };
};

// A period can't close before it has ended: closing the running month would block today's postings.
const notEndedMessage = (name, end) => (end.getTime() > Date.now() ? `${name} runs until ${toYmd(end)}. Close it after it has ended` : null);

const findOverlap = (businessId, start, end, excludeId = null) =>
  AccountingPeriod.findOne({
    business: businessId,
    startDate: { $lte: end },
    endDate: { $gte: start },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  }).select("name status").lean();

// ─── List ─────────────────────────────────────────────────────────────────────
// Every period with its ledger activity (one aggregation for all of them), grouped by fiscal year,
// plus the date gaps between periods — dates no period covers stay open for posting.
export const listPeriods = async (businessId) => {
  const [periods, startMonth] = await Promise.all([
    AccountingPeriod.find({ business: businessId }).sort({ startDate: 1 }).lean(),
    fiscalMonthOf(businessId),
  ]);

  const stats = new Map();
  if (periods.length) {
    // $bucket boundaries: each period's start, plus the day after any period followed by a gap
    const edges = new Set();
    for (const p of periods) {
      edges.add(p.startDate.getTime());
      edges.add(p.endDate.getTime() + 1);
    }
    // sorted and unique, as $bucket requires (periods saved before overlaps were blocked may cross)
    const bounds = [...edges].sort((a, b) => a - b);
    const rows = await FinancialLedgerEntry.aggregate([
      { $match: { business: oid(businessId), status: { $in: REPORT_STATUSES }, transactionDate: { $gte: new Date(bounds[0]), $lt: new Date(bounds[bounds.length - 1]) } } },
      {
        $bucket: {
          groupBy: "$transactionDate",
          boundaries: bounds.map((t) => new Date(t)),
          default: "outside",
          output: { entries: { $sum: 1 }, debit: { $sum: { $ifNull: ["$debit", 0] } }, credit: { $sum: { $ifNull: ["$credit", 0] } } },
        },
      },
    ]).allowDiskUse(true);
    for (const row of rows) if (row._id instanceof Date) stats.set(row._id.getTime(), row);
  }

  const gaps = [];
  const years = new Map();
  periods.forEach((p, i) => {
    const s = stats.get(p.startDate.getTime()) || {};
    const fy = fiscalYearOf(p.startDate, startMonth);
    if (!years.has(fy.key)) years.set(fy.key, { ...fy, periods: [] });
    years.get(fy.key).periods.push({
      ...p,
      postingWindows: (p.postingWindows || []).filter((w) => new Date(w.until).getTime() > Date.now()),
      startYmd: toYmd(p.startDate),
      endYmd: toYmd(p.endDate),
      entries: s.entries || 0,
      debit: Math.round((s.debit || 0) * 100) / 100,
      credit: Math.round((s.credit || 0) * 100) / 100,
    });
    const next = periods[i + 1];
    if (next && next.startDate.getTime() > p.endDate.getTime() + 1) {
      gaps.push({ fromYmd: nextDayYmd(toYmd(p.endDate)), toYmd: toYmd(new Date(next.startDate.getTime() - 1)) });
    }
  });

  const fiscalYears = [...years.values()].reverse().map((fy) => {
    const statuses = fy.periods.map((p) => p.status);
    return {
      key: fy.key, label: fy.label, startYmd: fy.startYmd, endYmd: fy.endYmd,
      periods: fy.periods.reverse(),
      counts: { open: statuses.filter((s) => s === "open").length, closed: statuses.filter((s) => s === "closed").length, locked: statuses.filter((s) => s === "locked").length },
      yearClosed: fy.periods.length > 0 && fy.periods.every((p) => p.yearEndClosed),
    };
  });

  const current = fiscalYearOf(new Date(), startMonth);
  // the years Generate can offer (the last two, the current one and the next) while any of their
  // months has no period; generating fills just those months
  const suggestions = [-2, -1, 0, 1]
    .map((offset) => fiscalYearFromStart(current.startYear + offset, startMonth))
    .map((fy) => {
      const missing = monthlyPeriodsOf(fy).filter((m) => {
        const start = dayStart(m.startYmd).getTime();
        const end = dayEnd(m.endYmd).getTime();
        return !periods.some((p) => p.startDate.getTime() <= end && p.endDate.getTime() >= start);
      }).length;
      return { key: fy.key, label: fy.label, startYmd: fy.startYmd, endYmd: fy.endYmd, missing };
    })
    .filter((fy) => fy.missing > 0);

  // flat list for the mobile app, which shows the first one: the period covering today, then newest first
  const now = Date.now();
  const flat = fiscalYears.flatMap((fy) => fy.periods);
  const periodsFlat = [...flat.filter((p) => p.startDate.getTime() <= now && p.endDate.getTime() >= now), ...flat.filter((p) => !(p.startDate.getTime() <= now && p.endDate.getTime() >= now))];

  return { fiscalStartMonth: startMonth, currentFiscalYear: current.key, fiscalYears, gaps, suggestions, periods: periodsFlat };
};

// ─── Create / generate / edit / delete ───────────────────────────────────────
export const createPeriod = async ({ businessId, name, startDate, endDate, notes = "", user, req }) => {
  if (!String(name || "").trim()) throw createError(400, "A period name is required");
  const { start, end } = parseRange({ startDate, endDate });
  const overlap = await findOverlap(businessId, start, end);
  if (overlap) throw createError(409, `These dates overlap "${overlap.name}" (${overlap.status})`);
  const actor = await resolveActor(user);
  const period = await AccountingPeriod.create({
    business: businessId, name: String(name).trim(), startDate: start, endDate: end, notes, status: "open",
    history: [{ action: "created", ...actor }],
  });
  await auditPeriod(req, businessId, period, "created", `Created accounting period ${period.name}`);
  return period;
};

// The twelve monthly periods of a fiscal year. Months already covered by a period are skipped.
export const generateFiscalYear = async ({ businessId, fiscalYearStart, user, req }) => {
  if (!isYmd(fiscalYearStart)) throw createError(400, "Choose the fiscal year to generate");
  const startMonth = await fiscalMonthOf(businessId);
  const fy = fiscalYearOf(fiscalYearStart, startMonth);
  if (fy.key !== fiscalYearStart) throw createError(400, "That date is not the start of a fiscal year for this company");

  const existing = await AccountingPeriod.find({ business: businessId, startDate: { $lte: fy.endDate }, endDate: { $gte: fy.startDate } })
    .select("startDate endDate").lean();
  const actor = await resolveActor(user);
  const docs = monthlyPeriodsOf(fy)
    .map((m) => ({ ...m, start: dayStart(m.startYmd), end: dayEnd(m.endYmd) }))
    .filter((m) => !existing.some((e) => e.startDate <= m.end && e.endDate >= m.start))
    .map((m) => ({ business: businessId, name: m.name, startDate: m.start, endDate: m.end, status: "open", history: [{ action: "created", ...actor }] }));
  if (!docs.length) throw createError(409, `${fy.label} is already covered by periods`);

  await AccountingPeriod.insertMany(docs);
  await logAuditEvent({
    req, company: businessId, action: "accounting_period.generated", category: "finance", severity: "important",
    targetType: "AccountingPeriod", targetName: fy.label, message: `Generated ${docs.length} monthly periods for ${fy.label}`,
  });
  return { fiscalYear: fy.label, created: docs.length, skipped: 12 - docs.length };
};

export const updatePeriod = async ({ businessId, id, name, notes, startDate, endDate, user, req }) => {
  const period = await AccountingPeriod.findOne({ _id: id, business: businessId });
  if (!period) throw createError(404, "Period not found");
  if (period.status === "locked") throw createError(400, "A locked period cannot be edited");

  if (startDate !== undefined || endDate !== undefined) {
    if (period.status !== "open") throw createError(400, "Reopen the period before changing its dates");
    const { start, end } = parseRange({ startDate: startDate ?? period.startDate, endDate: endDate ?? period.endDate });
    const overlap = await findOverlap(businessId, start, end, period._id);
    if (overlap) throw createError(409, `These dates overlap "${overlap.name}" (${overlap.status})`);
    period.startDate = start;
    period.endDate = end;
  }
  if (name !== undefined) {
    if (!String(name).trim()) throw createError(400, "A period name is required");
    period.name = String(name).trim();
  }
  if (notes !== undefined) period.notes = String(notes || "");
  period.history.push({ action: "edited", ...(await resolveActor(user)) });
  await period.save();
  await auditPeriod(req, businessId, period, "edited", `Edited accounting period ${period.name}`);
  return period;
};

// Only an open period: deleting it changes no entry, its dates just stop being covered.
export const deletePeriod = async ({ businessId, id, req }) => {
  const period = await AccountingPeriod.findOne({ _id: id, business: businessId });
  if (!period) throw createError(404, "Period not found");
  if (period.status !== "open") throw createError(400, "Only an open period can be deleted");
  await period.deleteOne();
  await auditPeriod(req, businessId, period, "deleted", `Deleted accounting period ${period.name}`);
};

// ─── Close checklist ──────────────────────────────────────────────────────────
// Unfinished work dated inside a date range. Warnings, not blockers: the accountant decides.
export const buildCloseChecklist = async ({ businessId, start, end }) => {
  const business = oid(businessId);
  const endMonth = toYmd(end).slice(0, 7);

  const cashbooks = ChartOfAccount.find({ business, type: "asset", subGroup: "Cashbooks", isPosting: true, isHeader: { $ne: true }, isActive: { $ne: false } })
    .select("_id code name").lean();

  const [vouchers, journals, receipts, assets, revenue, billing, cashAccounts] = await Promise.all([
    PaymentVoucher.countDocuments({ business, status: { $in: ["draft", "approved"] }, dueDate: { $gte: start, $lte: end } }),
    JournalEntry.countDocuments({ business, status: "draft", date: { $gte: start, $lte: end } }),
    RentPayment.countDocuments({ business, isConfirmed: false, paymentDate: { $gte: start, $lte: end } }),
    FixedAsset.countDocuments({
      business, status: "active", purchaseDate: { $lte: end },
      $or: [{ lastDepreciationDate: null }, { lastDepreciationDate: { $lt: new Date(end.getTime() - 2 * HALF_DAY_MS - 1) } }],
    }),
    ClientRevenueSchedule.aggregate([
      { $match: { business, status: "active", "entries.month": { $lte: endMonth } } },
      { $unwind: "$entries" },
      { $match: { "entries.month": { $lte: endMonth }, "entries.status": "pending" } },
      { $count: "n" },
    ]),
    ClientBillingSchedule.countDocuments({ business, status: "scheduled", billingDate: { $lte: end } }),
    cashbooks,
  ]);

  // cash and bank accounts that moved up to the period end but were not reconciled to it
  let unreconciled = [];
  if (cashAccounts.length) {
    const ids = cashAccounts.map((a) => a._id);
    const [active, reconciled] = await Promise.all([
      FinancialLedgerEntry.distinct("accountId", { business, accountId: { $in: ids }, status: { $in: REPORT_STATUSES }, transactionDate: { $lte: end } }),
      BankReconciliation.distinct("account", { business, account: { $in: ids }, status: "reconciled", periodEnd: { $gte: new Date(end.getTime() - HALF_DAY_MS) } }),
    ]);
    const done = new Set(reconciled.map(String));
    const moved = new Set(active.map(String));
    unreconciled = cashAccounts.filter((a) => moved.has(String(a._id)) && !done.has(String(a._id)));
  }

  return [
    { key: "vouchers", label: "Payment vouchers not yet paid", count: vouchers, link: "/accounts/payment-vouchers" },
    { key: "journals", label: "Draft journals", count: journals, link: "/accounts/journals" },
    { key: "receipts", label: "Unconfirmed receipts", count: receipts, link: "/receipts" },
    { key: "bank", label: "Cash / bank accounts not reconciled to the period end", count: unreconciled.length, detail: unreconciled.map((a) => `${a.code} ${a.name}`), link: "/accounts/bank-reconciliation" },
    { key: "depreciation", label: "Fixed assets not depreciated to the period end", count: assets, link: "/accounts/fixed-assets" },
    { key: "revenue", label: "Client revenue not yet recognised", count: revenue[0]?.n || 0, link: "/clients/revenue" },
    { key: "billing", label: "Client billing due but not invoiced", count: billing, link: "/clients/billing/run" },
  ];
};

export const periodChecklist = async ({ businessId, id }) => {
  const period = await AccountingPeriod.findOne({ _id: id, business: businessId }).lean();
  if (!period) throw createError(404, "Period not found");
  const [items, earlierOpen] = await Promise.all([
    buildCloseChecklist({ businessId, start: period.startDate, end: period.endDate }),
    AccountingPeriod.findOne({ business: businessId, status: "open", startDate: { $lt: period.startDate } }).sort({ startDate: 1 }).select("name").lean(),
  ]);
  const blocker = notEndedMessage(period.name, period.endDate) || (earlierOpen ? `Close ${earlierOpen.name} first: periods close oldest first` : null);
  return { period: { _id: period._id, name: period.name }, items, blocker };
};

// ─── Close / lock / reopen ───────────────────────────────────────────────────
export const closePeriod = async ({ businessId, id, user, req }) => {
  const period = await AccountingPeriod.findOne({ _id: id, business: businessId });
  if (!period) throw createError(404, "Period not found");
  if (period.status !== "open") throw createError(400, `Period is already ${period.status}`);
  const earlierOpen = await AccountingPeriod.findOne({ business: businessId, status: "open", startDate: { $lt: period.startDate } }).sort({ startDate: 1 }).select("name").lean();
  if (earlierOpen) throw createError(409, `Close ${earlierOpen.name} first: periods close oldest first`);
  const notEnded = notEndedMessage(period.name, period.endDate);
  if (notEnded) throw createError(409, notEnded);

  const actor = await resolveActor(user);
  period.status = "closed";
  period.closedBy = actor.by;
  period.closedAt = new Date();
  period.history.push({ action: "closed", ...actor });
  await period.save();
  await auditPeriod(req, businessId, period, "closed", `Closed accounting period ${period.name}`);
  return period;
};

export const lockPeriod = async ({ businessId, id, user, req }) => {
  const period = await AccountingPeriod.findOne({ _id: id, business: businessId });
  if (!period) throw createError(404, "Period not found");
  if (period.status === "locked") throw createError(400, "Period is already locked");
  if (period.status === "open") throw createError(400, "Close the period before locking it");
  const earlierUnlocked = await AccountingPeriod.findOne({ business: businessId, status: { $ne: "locked" }, startDate: { $lt: period.startDate } }).sort({ startDate: 1 }).select("name").lean();
  if (earlierUnlocked) throw createError(409, `Lock ${earlierUnlocked.name} first: periods lock oldest first`);

  const actor = await resolveActor(user);
  period.status = "locked";
  period.lockedBy = actor.by;
  period.lockedAt = new Date();
  period.postingWindows = [];
  period.history.push({ action: "locked", ...actor });
  await period.save();
  await auditPeriod(req, businessId, period, "locked", `Locked accounting period ${period.name}`);
  return period;
};

export const reopenPeriod = async ({ businessId, id, reason, user, req }) => {
  const why = String(reason || "").trim();
  if (why.length < 5) throw createError(400, "Give a reason for reopening (at least 5 characters)");
  const period = await AccountingPeriod.findOne({ _id: id, business: businessId });
  if (!period) throw createError(404, "Period not found");
  if (period.status === "locked") throw createError(400, "A locked period cannot be reopened");
  if (period.status === "open") throw createError(400, "Period is already open");
  const laterClosed = await AccountingPeriod.findOne({ business: businessId, status: { $ne: "open" }, startDate: { $gt: period.startDate } }).sort({ startDate: -1 }).select("name").lean();
  if (laterClosed) throw createError(409, `Reopen ${laterClosed.name} first: periods reopen newest first`);

  const actor = await resolveActor(user);
  period.status = "open";
  period.reopenedBy = actor.by;
  period.reopenedAt = new Date();
  period.postingWindows = [];
  period.history.push({ action: "reopened", ...actor, reason: why });
  await period.save();
  await auditPeriod(req, businessId, period, "reopened", `Reopened accounting period ${period.name}: ${why}`, { reason: why });
  return period;
};

// ─── Posting window ───────────────────────────────────────────────────────────
// Lets the user who opens it post into a closed period for a few minutes without reopening it
// (QuickBooks' closing-date override). The period stays closed for everyone else, and every window
// is in the history and audit log. Not for locked periods: those are final.
export const POSTING_WINDOW_MINUTES = [15, 30, 60];

export const openPostingWindow = async ({ businessId, id, minutes, reason, user, req }) => {
  const why = String(reason || "").trim();
  if (why.length < 5) throw createError(400, "Give a reason for posting into a closed period (at least 5 characters)");
  const mins = Number(minutes);
  if (!POSTING_WINDOW_MINUTES.includes(mins)) throw createError(400, `Choose ${POSTING_WINDOW_MINUTES.join(", ")} minutes`);
  const period = await AccountingPeriod.findOne({ _id: id, business: businessId });
  if (!period) throw createError(404, "Period not found");
  if (period.status !== "closed") throw createError(400, period.status === "locked" ? "A locked period is final: nothing can be posted into it" : "The period is open: no window is needed");

  const userKey = String(user?.id || user?._id || "");
  if (!userKey) throw createError(401, "Sign in again to open a posting window");
  const actor = await resolveActor(user);
  const until = new Date(Date.now() + mins * 60 * 1000);
  const now = Date.now();
  // one window per user; expired ones are dropped
  period.postingWindows = (period.postingWindows || []).filter((w) => w.userKey !== userKey && new Date(w.until).getTime() > now);
  period.postingWindows.push({ userKey, userName: actor.byName, until, reason: why });
  period.history.push({ action: "posting_opened", ...actor, reason: `${mins} min: ${why}` });
  await period.save();
  await auditPeriod(req, businessId, period, "posting_opened", `Opened a ${mins}-minute posting window on closed period ${period.name}: ${why}`, { minutes: mins, reason: why, until });
  return period;
};

export const endPostingWindow = async ({ businessId, id, user, req }) => {
  const period = await AccountingPeriod.findOne({ _id: id, business: businessId });
  if (!period) throw createError(404, "Period not found");
  const userKey = String(user?.id || user?._id || "");
  const before = (period.postingWindows || []).length;
  period.postingWindows = (period.postingWindows || []).filter((w) => w.userKey !== userKey);
  if (period.postingWindows.length === before) throw createError(404, "You have no posting window on this period");
  period.history.push({ action: "posting_ended", ...(await resolveActor(user)) });
  await period.save();
  await auditPeriod(req, businessId, period, "posting_ended", `Ended posting window on ${period.name}`);
  return period;
};

// ─── Fiscal year close ────────────────────────────────────────────────────────
const loadYear = async (businessId, fiscalYearStart) => {
  if (!isYmd(fiscalYearStart)) throw createError(400, "Choose the fiscal year to close");
  const startMonth = await fiscalMonthOf(businessId);
  const fy = fiscalYearOf(fiscalYearStart, startMonth);
  if (fy.key !== fiscalYearStart) throw createError(400, "That date is not the start of a fiscal year for this company");
  const periods = await AccountingPeriod.find({ business: businessId, startDate: { $gte: fy.startDate }, endDate: { $lte: fy.endDate } }).sort({ startDate: 1 });
  return { fy, periods };
};

// Dates of the year no period covers. A closed year must leave none: they would stay open for posting.
const uncoveredDays = (fy, periods) => {
  const gaps = [];
  let cursor = fy.startDate.getTime();
  for (const p of periods) {
    if (p.startDate.getTime() > cursor) gaps.push({ fromYmd: toYmd(new Date(cursor)), toYmd: toYmd(new Date(p.startDate.getTime() - 1)) });
    cursor = Math.max(cursor, p.endDate.getTime() + 1);
  }
  if (cursor <= fy.endDate.getTime()) gaps.push({ fromYmd: toYmd(new Date(cursor)), toYmd: fy.endYmd });
  return gaps;
};

export const yearCloseChecklist = async ({ businessId, fiscalYearStart }) => {
  const { fy, periods } = await loadYear(businessId, fiscalYearStart);
  const [items, earlierUnlocked] = await Promise.all([
    buildCloseChecklist({ businessId, start: fy.startDate, end: fy.endDate }),
    AccountingPeriod.findOne({ business: businessId, status: { $ne: "locked" }, startDate: { $lt: fy.startDate } }).sort({ startDate: 1 }).select("name").lean(),
  ]);
  const gaps = uncoveredDays(fy, periods);
  const blockers = [];
  if (!periods.length) blockers.push(`${fy.label} has no periods yet. Generate them first`);
  else if (gaps.length) blockers.push(`Some dates have no period: ${gaps.map((g) => (g.fromYmd === g.toYmd ? g.fromYmd : `${g.fromYmd} to ${g.toYmd}`)).join(", ")}`);
  if (earlierUnlocked) blockers.push(`Lock ${earlierUnlocked.name} first: earlier periods must be locked`);
  const notEnded = notEndedMessage(fy.label, fy.endDate);
  if (notEnded) blockers.push(notEnded);
  if (periods.length && periods.every((p) => p.yearEndClosed)) blockers.push(`${fy.label} is already closed`);
  return { fiscalYear: { key: fy.key, label: fy.label, startYmd: fy.startYmd, endYmd: fy.endYmd }, periods: periods.length, items, blockers };
};

// Locks every period of the year, oldest first. Nothing is posted to the ledger.
export const closeFiscalYear = async ({ businessId, fiscalYearStart, user, req }) => {
  const check = await yearCloseChecklist({ businessId, fiscalYearStart });
  if (check.blockers.length) throw createError(409, check.blockers.join(". "));
  const { periods } = await loadYear(businessId, fiscalYearStart);

  const actor = await resolveActor(user);
  const now = new Date();
  await AccountingPeriod.bulkWrite(periods.map((p) => ({
    updateOne: {
      filter: { _id: p._id },
      update: {
        $set: {
          status: "locked",
          yearEndClosed: true,
          postingWindows: [],
          ...(p.status === "open" ? { closedBy: actor.by, closedAt: now } : {}),
          ...(p.status !== "locked" ? { lockedBy: actor.by, lockedAt: now } : {}),
        },
        $push: { history: { action: "year_closed", ...actor, at: now } },
      },
    },
  })));
  await logAuditEvent({
    req, company: businessId, action: "accounting_period.year_closed", category: "finance", severity: "critical",
    targetType: "AccountingPeriod", targetName: check.fiscalYear.label,
    message: `Closed ${check.fiscalYear.label}: ${periods.length} periods locked`,
    metadata: { fiscalYearStart, periods: periods.length },
  });
  return { fiscalYear: check.fiscalYear.label, locked: periods.length };
};
