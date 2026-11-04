// Revenue recognition for deferred contract lines (straight_line / milestone).
//
// Invoicing such a line credits 2165 Deferred Revenue (clientAccountingService.postClientInvoiceLedger)
// and creates one ClientRevenueSchedule for it here. The monthly run then releases each month's share
// Dr 2165 / Cr income. Each month is claimed and posted inside one transaction, so a re-run (cron +
// manual, or two clicks) can never recognise the same invoice line and month twice.
import mongoose from "mongoose";
import ClientRevenueSchedule from "../models/ClientRevenueSchedule.js";
import ClientInvoice from "../models/ClientInvoice.js";
import ClientCreditNote from "../models/ClientCreditNote.js";
import { findSystemAccountByCode } from "../../../services/chartOfAccountsService.js";
import { round2 } from "../../../utils/math.js";
import { createError } from "../../../utils/error.js";
import { allocateAcrossMonths, DEFERRED_RECOGNITION_METHODS, monthKeyOf } from "./clientLineMath.js";
import {
  CLIENT_ACCOUNT_CODES,
  postClientRevenueRecognitionLedger,
  refreshClientLedgerBalances,
} from "./clientAccountingService.js";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const assertMonthKey = (value, label = "month") => {
  const key = String(value || "").trim();
  if (!MONTH_RE.test(key)) throw createError(400, `${label} must be in YYYY-MM format`);
  return key;
};

const toObjectId = (v) => new mongoose.Types.ObjectId(String(v));

export const createRevenueSchedulesForInvoice = async ({ invoice, session = null }) => {
  const deferredLines = (invoice.lineItems || []).filter((l) => DEFERRED_RECOGNITION_METHODS.has(l.revenueRecognition) && Number(l.amount || 0) > 0);
  if (!deferredLines.length) return [];
  const defaultIncome = await findSystemAccountByCode(invoice.business, CLIENT_ACCOUNT_CODES.income);

  const docs = deferredLines.map((line) => {
    const from = line.servicePeriodStart || invoice.periodStart || invoice.issueDate;
    const to = line.servicePeriodEnd || invoice.periodEnd || from;
    const net = round2(Number(line.amount || 0));
    return {
      business: invoice.business,
      client: invoice.client?._id || invoice.client,
      contract: line.contract || invoice.contract || null,
      contractLineKey: line.contractLineKey || null,
      invoice: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceLineId: line._id,
      description: line.itemName || line.description,
      method: line.revenueRecognition,
      incomeAccount: line.incomeAccount || defaultIncome._id,
      servicePeriodStart: from,
      servicePeriodEnd: to,
      totalAmount: net,
      entries: line.revenueRecognition === "straight_line"
        ? allocateAcrossMonths({ amount: net, from, to }).filter((e) => e.amount > 0).map((e) => ({ ...e, status: "pending" }))
        : [],
    };
  });
  return ClientRevenueSchedule.insertMany(docs, session ? { session } : {});
};

// Unrecognised = still sitting in 2165 for this schedule.
export const unrecognisedAmount = (schedule) =>
  round2(Number(schedule.totalAmount || 0) - Number(schedule.creditedAmount || 0) - Number(schedule.recognizedAmount || 0));

// A credit note on a deferred line takes the unrecognised part out of 2165 first, removing it from the
// latest pending months backwards. Returns { deferredPortion, reductions } for the note line.
export const reduceScheduleForCredit = async ({ schedule, amount, session = null }) => {
  const available = unrecognisedAmount(schedule);
  let remaining = round2(Math.min(Number(amount || 0), available));
  const deferredPortion = remaining;
  const reductions = [];
  const entries = schedule.entries.map((e) => (e.toObject ? e.toObject() : { ...e }));
  for (let i = entries.length - 1; i >= 0 && remaining > 0; i--) {
    const entry = entries[i];
    if (entry.status !== "pending") continue;
    const cut = round2(Math.min(entry.amount, remaining));
    entry.amount = round2(entry.amount - cut);
    if (entry.amount <= 0) entry.status = "cancelled";
    reductions.push({ month: entry.month, amount: cut });
    remaining = round2(remaining - cut);
  }
  // A milestone schedule has no pending months — the whole unrecognised balance is creditable.
  if (deferredPortion > 0) {
    const update = {
      $inc: { creditedAmount: deferredPortion },
      $set: { entries, ...(round2(available - deferredPortion) <= 0 ? { status: "completed" } : {}) },
    };
    await ClientRevenueSchedule.updateOne({ _id: schedule._id }, update, session ? { session } : {});
  }
  return { deferredPortion, reductions };
};

export const restoreScheduleAfterCreditReversal = async ({ scheduleId, deferredPortion, reductions = [], session = null }) => {
  if (!scheduleId || !(deferredPortion > 0)) return;
  const schedule = await ClientRevenueSchedule.findById(scheduleId).session(session);
  if (!schedule) return;
  for (const r of reductions) {
    const entry = schedule.entries.find((e) => e.month === r.month && ["pending", "cancelled"].includes(e.status));
    if (entry) {
      entry.amount = round2(entry.amount + r.amount);
      entry.status = "pending";
    }
  }
  schedule.creditedAmount = round2(Math.max(0, schedule.creditedAmount - deferredPortion));
  if (schedule.status === "completed" && unrecognisedAmount(schedule) > 0) schedule.status = "active";
  await schedule.save({ session });
};

// ─── Recognition run ─────────────────────────────────────────────────────────

const pendingFilter = ({ business, throughMonth, contractId }) => ({
  business: toObjectId(business),
  status: "active",
  ...(contractId ? { contract: toObjectId(contractId) } : {}),
  entries: { $elemMatch: { status: "pending", month: { $lte: throughMonth } } },
});

export const previewRevenueRecognition = async ({ business, throughMonth, contractId = null }) => {
  const month = assertMonthKey(throughMonth, "throughMonth");
  const schedules = await ClientRevenueSchedule.find(pendingFilter({ business, throughMonth: month, contractId }))
    .populate("client", "name clientCode")
    .lean();
  const items = [];
  for (const s of schedules) {
    for (const e of s.entries) {
      if (e.status !== "pending" || e.month > month || !(e.amount > 0)) continue;
      items.push({
        scheduleId: s._id,
        entryId: e._id,
        month: e.month,
        amount: e.amount,
        invoice: s.invoice,
        invoiceNumber: s.invoiceNumber,
        contract: s.contract,
        client: s.client,
        description: s.description,
        incomeAccount: s.incomeAccount,
      });
    }
  }
  items.sort((a, b) => a.month.localeCompare(b.month));
  return { throughMonth: month, count: items.length, total: round2(items.reduce((s, i) => s + i.amount, 0)), items };
};

// Claims and posts one month inside a transaction: the claim (pending -> recognized) and the journal
// commit or roll back together.
const recognizeEntry = async ({ scheduleId, entryId, userId }) => {
  const session = await mongoose.startSession();
  let result = null;
  try {
    await session.withTransaction(async () => {
      result = null;
      const schedule = await ClientRevenueSchedule.findOne({ _id: scheduleId, status: "active" }).session(session);
      const entry = schedule?.entries.id(entryId);
      if (!entry || entry.status !== "pending" || !(entry.amount > 0)) return;
      const { entries, journalGroupId } = await postClientRevenueRecognitionLedger({ schedule, entry, userId, session });
      entry.status = "recognized";
      entry.recognizedAt = new Date();
      entry.recognizedBy = userId || null;
      entry.journalGroupId = journalGroupId;
      entry.ledgerEntries = entries.map((e) => e._id);
      schedule.recognizedAmount = round2(schedule.recognizedAmount + entry.amount);
      if (unrecognisedAmount(schedule) <= 0 && schedule.method === "straight_line") schedule.status = "completed";
      await schedule.save({ session });
      result = { amount: entry.amount, entries };
    });
  } finally {
    await session.endSession();
  }
  return result;
};

export const runRevenueRecognition = async ({ business, throughMonth, contractId = null, userId = null }) => {
  const preview = await previewRevenueRecognition({ business, throughMonth, contractId });
  let recognized = 0;
  let total = 0;
  const failures = [];
  const touched = [];
  for (const item of preview.items) {
    try {
      const res = await recognizeEntry({ scheduleId: item.scheduleId, entryId: item.entryId, userId });
      if (res) {
        recognized += 1;
        total = round2(total + res.amount);
        touched.push(...res.entries);
      }
    } catch (error) {
      failures.push({ scheduleId: item.scheduleId, month: item.month, invoiceNumber: item.invoiceNumber, message: error.message });
    }
  }
  if (touched.length) await refreshClientLedgerBalances(business, touched);
  return { throughMonth: preview.throughMonth, recognized, total, failures };
};

// Milestone lines are recognised by hand when the milestone is delivered.
export const recognizeMilestone = async ({ business, scheduleId, amount, date = new Date(), description = "", userId = null }) => {
  const schedule = await ClientRevenueSchedule.findOne({ _id: scheduleId, business });
  if (!schedule) throw createError(404, "Revenue schedule not found");
  if (schedule.status !== "active") throw createError(400, `Revenue schedule is ${schedule.status}`);
  const value = round2(Number(amount || 0));
  const pending = round2(schedule.entries.filter((e) => e.status === "pending").reduce((s, e) => s + e.amount, 0));
  const available = round2(unrecognisedAmount(schedule) - pending);
  if (!(value > 0)) throw createError(400, "Amount must be greater than zero");
  if (value > available + 0.005) throw createError(400, `Only ${available} is left to recognise on this line`);

  schedule.entries.push({ month: monthKeyOf(date), amount: value, status: "pending", description: String(description || "").trim() });
  await schedule.save();
  const entry = schedule.entries[schedule.entries.length - 1];
  const res = await recognizeEntry({ scheduleId: schedule._id, entryId: entry._id, userId });
  if (res) await refreshClientLedgerBalances(business, res.entries);
  return ClientRevenueSchedule.findById(schedule._id).lean();
};

// Invoice cancelled before any recognition: its whole deferral was reversed with the invoice journal.
export const cancelRevenueSchedulesForInvoice = async ({ business, invoiceId, session = null }) => {
  const schedules = await ClientRevenueSchedule.find({ business, invoice: invoiceId }).session(session);
  if (schedules.some((s) => s.recognizedAmount > 0 || s.entries.some((e) => e.status === "posting"))) {
    throw createError(400, "Revenue has already been recognised on this invoice — issue a credit note instead of cancelling it");
  }
  await ClientRevenueSchedule.updateMany(
    { business, invoice: invoiceId },
    { $set: { status: "cancelled", "entries.$[e].status": "cancelled" } },
    { arrayFilters: [{ "e.status": "pending" }], ...(session ? { session } : {}) }
  );
};

// ─── Reports ─────────────────────────────────────────────────────────────────

export const deferredRevenueBalance = async ({ business, groupBy = "client" }) => {
  const key = groupBy === "contract" ? "$contract" : "$client";
  const rows = await ClientRevenueSchedule.aggregate([
    { $match: { business: toObjectId(business), status: { $ne: "cancelled" } } },
    {
      $group: {
        _id: key,
        deferred: { $sum: { $subtract: ["$totalAmount", { $add: ["$creditedAmount", "$recognizedAmount"] }] } },
        billed: { $sum: "$totalAmount" },
        recognized: { $sum: "$recognizedAmount" },
        credited: { $sum: "$creditedAmount" },
        schedules: { $sum: 1 },
      },
    },
    { $match: { deferred: { $gt: 0.004 } } },
    {
      $lookup: groupBy === "contract"
        ? { from: "clientcontracts", localField: "_id", foreignField: "_id", as: "ref" }
        : { from: "clients", localField: "_id", foreignField: "_id", as: "ref" },
    },
    { $sort: { deferred: -1 } },
  ]);
  const data = rows.map((r) => ({
    id: r._id,
    ref: r.ref?.[0]
      ? (groupBy === "contract"
        ? { _id: r.ref[0]._id, contractNumber: r.ref[0].contractNumber, client: r.ref[0].client, description: r.ref[0].description }
        : { _id: r.ref[0]._id, name: r.ref[0].name, clientCode: r.ref[0].clientCode })
      : null,
    deferred: round2(r.deferred),
    billed: round2(r.billed),
    recognized: round2(r.recognized),
    credited: round2(r.credited),
    schedules: r.schedules,
  }));
  return { groupBy, rows: data, total: round2(data.reduce((s, r) => s + r.deferred, 0)) };
};

// Pending recognition by month for the next N months; anything later lands in "later".
export const deferredRevenueWaterfall = async ({ business, months = 12, fromMonth = null }) => {
  const start = fromMonth ? assertMonthKey(fromMonth, "fromMonth") : monthKeyOf(new Date());
  const [y, m] = start.split("-").map(Number);
  const buckets = [];
  for (let i = 0; i < Math.min(Math.max(Number(months) || 12, 1), 60); i++) {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    buckets.push(monthKeyOf(d));
  }
  const last = buckets[buckets.length - 1];
  const rows = await ClientRevenueSchedule.aggregate([
    { $match: { business: toObjectId(business), status: "active" } },
    { $unwind: "$entries" },
    { $match: { "entries.status": "pending" } },
    { $group: { _id: "$entries.month", amount: { $sum: "$entries.amount" } } },
  ]);
  const byMonth = new Map(rows.map((r) => [r._id, round2(r.amount)]));
  let overdue = 0;
  let later = 0;
  for (const [month, amount] of byMonth) {
    if (month < start) overdue = round2(overdue + amount);
    else if (month > last) later = round2(later + amount);
  }
  const series = buckets.map((month) => ({ month, amount: byMonth.get(month) || 0 }));
  return { fromMonth: start, months: series, unrecognisedPastMonths: overdue, later, total: round2(overdue + later + series.reduce((s, r) => s + r.amount, 0)) };
};

// Net billed vs recognised income per month. Billed = invoice net (less credit notes, plus debit
// notes) by document month. Recognised = the on-invoice part at invoicing + monthly releases.
export const billedVsRecognised = async ({ business, fromMonth, toMonth }) => {
  const from = assertMonthKey(fromMonth, "fromMonth");
  const to = assertMonthKey(toMonth, "toMonth");
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const start = new Date(Date.UTC(fy, fm - 1, 1));
  const end = new Date(Date.UTC(ty, tm, 0, 23, 59, 59, 999));
  const biz = toObjectId(business);
  const monthExpr = (field) => ({ $dateToString: { format: "%Y-%m", date: field } });

  const [invoiceRows, noteRows, releaseRows] = await Promise.all([
    ClientInvoice.aggregate([
      { $match: { business: biz, status: { $nin: ["draft", "cancelled"] }, issueDate: { $gte: start, $lte: end } } },
      { $group: { _id: monthExpr("$issueDate"), billed: { $sum: "$subtotal" }, deferred: { $sum: { $ifNull: ["$deferredAmount", 0] } } } },
    ]),
    ClientCreditNote.aggregate([
      { $match: { business: biz, status: "posted", noteDate: { $gte: start, $lte: end } } },
      { $unwind: "$lines" },
      {
        $group: {
          _id: { month: monthExpr("$noteDate"), type: "$noteType" },
          net: { $sum: "$lines.netAmount" },
          deferred: { $sum: { $ifNull: ["$lines.deferredPortion", 0] } },
        },
      },
    ]),
    ClientRevenueSchedule.aggregate([
      { $match: { business: biz } },
      { $unwind: "$entries" },
      { $match: { "entries.status": "recognized", "entries.month": { $gte: from, $lte: to } } },
      { $group: { _id: "$entries.month", amount: { $sum: "$entries.amount" } } },
    ]),
  ]);

  const months = new Map();
  const row = (month) => {
    if (!months.has(month)) months.set(month, { month, billed: 0, recognized: 0 });
    return months.get(month);
  };
  for (const r of invoiceRows) {
    const target = row(r._id);
    target.billed = round2(target.billed + r.billed);
    target.recognized = round2(target.recognized + r.billed - r.deferred);
  }
  for (const r of noteRows) {
    const target = row(r._id.month);
    const sign = r._id.type === "DEBIT_NOTE" ? 1 : -1;
    target.billed = round2(target.billed + sign * r.net);
    target.recognized = round2(target.recognized + sign * (r.net - (sign < 0 ? r.deferred : 0)));
  }
  for (const r of releaseRows) {
    const target = row(r._id);
    target.recognized = round2(target.recognized + r.amount);
  }
  const series = [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).map((r) => ({ ...r, deferredMovement: round2(r.billed - r.recognized) }));
  return {
    fromMonth: from,
    toMonth: to,
    months: series,
    totals: {
      billed: round2(series.reduce((s, r) => s + r.billed, 0)),
      recognized: round2(series.reduce((s, r) => s + r.recognized, 0)),
    },
  };
};

// Cron entry point (1st of the month): recognise everything through the month that just ended.
export const runRevenueRecognitionForAllCompanies = async ({ asOf = new Date() } = {}) => {
  const throughMonth = monthKeyOf(new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - 1, 1)));
  const businesses = await ClientRevenueSchedule.distinct("business", { status: "active", "entries.status": "pending" });
  const results = [];
  for (const business of businesses) {
    try {
      const res = await runRevenueRecognition({ business, throughMonth });
      if (res.recognized || res.failures.length) results.push({ business, recognized: res.recognized, total: res.total, failures: res.failures.length });
    } catch (error) {
      results.push({ business, error: error.message });
    }
  }
  return results;
};
