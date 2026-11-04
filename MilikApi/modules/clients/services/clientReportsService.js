/**
 * Client-module reports. All company-scoped, aggregation-first (one pipeline
 * or one batched query per data set — never a query per client/row).
 *
 * Revenue figures come from documents, not the GL: invoices net of VAT
 * (subtotal) less posted credit-note subtotals plus debit-note subtotals,
 * dated by issue/note date (accrual). This matches the 4520 postings for
 * on-invoice recognition; deferred (straight-line) revenue shows here when
 * billed, and in the GL when recognised.
 */
import mongoose from "mongoose";
import { round2 } from "../../../utils/math.js";
import { escapeRegex } from "../../../utils/escapeRegex.js";
import User from "../../../models/User.js";
import Client from "../models/Client.js";
import ClientContract from "../models/ClientContract.js";
import ClientInvoice from "../models/ClientInvoice.js";
import ClientCreditNote from "../models/ClientCreditNote.js";
import ClientPayment from "../models/ClientPayment.js";
import ClientReceipt from "../models/ClientReceipt.js";
import ClientCreditRefund from "../models/ClientCreditRefund.js";
import ClientWhtCertificate from "../models/ClientWhtCertificate.js";
import ClientBillingSchedule from "../models/ClientBillingSchedule.js";
import { clientInvoiceOutstandingExpr } from "./clientInvoiceBalanceService.js";
import { OPEN_INVOICE_STATUSES } from "./clientReceiptService.js";
import { buildContractSchedule, calculateLineAmounts, computeContractMetrics } from "./clientLineMath.js";

const DAY_MS = 86400000;
const oid = (value) => new mongoose.Types.ObjectId(String(value));
const LIVE_INVOICE = { $nin: ["draft", "cancelled"] };
export const ACTIVE_CONTRACT_STATUSES = ["active", "pending_renewal"];

const startOfDay = (value) => { const d = new Date(value); d.setHours(0, 0, 0, 0); return d; };
const endOfDay = (value) => { const d = new Date(value); d.setHours(23, 59, 59, 999); return d; };
const monthStart = (value = new Date()) => new Date(value.getFullYear(), value.getMonth(), 1);
const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

export const parseRange = ({ from, to } = {}, fallback = "month") => {
  const now = new Date();
  const start = from ? startOfDay(from) : fallback === "year" ? new Date(now.getFullYear(), 0, 1) : monthStart(now);
  const end = to ? endOfDay(to) : endOfDay(now);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    const err = new Error("Invalid date range");
    err.status = 400;
    throw err;
  }
  return { from: start, to: end };
};

const paginate = (rows, { page = 1, limit = 50 } = {}) => {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const safePage = Math.max(Number(page) || 1, 1);
  return {
    rows: rows.slice((safePage - 1) * safeLimit, safePage * safeLimit),
    pagination: { page: safePage, limit: safeLimit, total: rows.length, pages: Math.max(Math.ceil(rows.length / safeLimit), 1) },
  };
};

export const contractMrr = (contract) =>
  Number(contract.mrr) > 0 ? Number(contract.mrr) : computeContractMetrics(contract).mrr;

const loadUserNames = async (ids) => {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const users = await User.find({ _id: { $in: unique } }).select("surname otherNames email").lean();
  return new Map(users.map((u) => [String(u._id), [u.surname, u.otherNames].filter(Boolean).join(" ") || u.email || ""]));
};

// ─── AR aging ────────────────────────────────────────────────────────────────

const BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"];
const bucketExpr = (daysExpr) => ({
  $switch: {
    branches: [
      { case: { $lte: [daysExpr, 0] }, then: "current" },
      { case: { $lte: [daysExpr, 30] }, then: "d1_30" },
      { case: { $lte: [daysExpr, 60] }, then: "d31_60" },
      { case: { $lte: [daysExpr, 90] }, then: "d61_90" },
    ],
    default: "d90_plus",
  },
});

// Paid-to-date as at a past date: receipt allocations and legacy payments
// dated on/before asOf, from documents still live today.
const paidAsOf = async ({ business, invoiceIds, asOf }) => {
  const [receiptRows, paymentRows] = await Promise.all([
    ClientReceipt.aggregate([
      { $match: { business: oid(business), status: "posted", "allocations.invoice": { $in: invoiceIds } } },
      { $unwind: "$allocations" },
      { $match: { "allocations.status": "active", "allocations.invoice": { $in: invoiceIds }, "allocations.appliedAt": { $lte: asOf } } },
      { $group: { _id: "$allocations.invoice", paid: { $sum: "$allocations.amount" } } },
    ]),
    ClientPayment.aggregate([
      { $match: { business: oid(business), status: { $ne: "reversed" }, invoice: { $in: invoiceIds }, paymentDate: { $lte: asOf } } },
      { $group: { _id: "$invoice", paid: { $sum: "$amount" } } },
    ]),
  ]);
  const map = new Map();
  for (const row of [...receiptRows, ...paymentRows]) map.set(String(row._id), (map.get(String(row._id)) || 0) + row.paid);
  return map;
};

const notesAsOf = async ({ business, invoiceIds, asOf }) => {
  const rows = await ClientCreditNote.aggregate([
    { $match: { business: oid(business), status: "posted", invoice: { $in: invoiceIds }, noteDate: { $lte: asOf } } },
    { $group: { _id: { invoice: "$invoice", type: "$noteType" }, total: { $sum: "$total" } } },
  ]);
  const map = new Map();
  for (const row of rows) {
    const key = String(row._id.invoice);
    const sign = row._id.type === "DEBIT_NOTE" ? 1 : -1;
    map.set(key, (map.get(key) || 0) + sign * row.total);
  }
  return map;
};

/**
 * Aged receivables. Today (no asOf) reads the live cached balances in one
 * pipeline; a past asOf rebuilds each invoice's balance from dated
 * allocations/payments/notes (documents reversed since are excluded).
 */
export const getArAging = async ({ business, asOf = null, groupBy = "client", clientId = null, ownerId = null, page = 1, limit = 50 }) => {
  const historical = asOf && endOfDay(asOf) < startOfDay(new Date());
  const cutoff = asOf ? endOfDay(asOf) : new Date();
  const daysExpr = { $floor: { $divide: [{ $subtract: [cutoff, "$dueDate"] }, DAY_MS] } };

  let clientFilterIds = null;
  if (ownerId) {
    clientFilterIds = (await Client.find({ business, accountManager: ownerId }).select("_id").lean()).map((c) => c._id);
  }
  const match = { business: oid(business) };
  if (clientId) match.client = oid(clientId);
  if (clientFilterIds) match.client = { $in: clientFilterIds };

  let invoiceRows;
  if (!historical) {
    invoiceRows = await ClientInvoice.aggregate([
      { $match: { ...match, status: { $in: OPEN_INVOICE_STATUSES } } },
      { $project: { client: 1, outstanding: clientInvoiceOutstandingExpr(), bucket: bucketExpr(daysExpr) } },
      { $match: { outstanding: { $gt: 0.005 } } },
      { $group: { _id: { client: "$client", bucket: "$bucket" }, amount: { $sum: "$outstanding" }, count: { $sum: 1 } } },
    ]);
  } else {
    const invoices = await ClientInvoice.find({ ...match, status: { $nin: ["draft"] }, issueDate: { $lte: cutoff }, $or: [{ cancelledAt: null }, { cancelledAt: { $gt: cutoff } }] })
      .select("client total dueDate status cancelledAt")
      .lean();
    const live = invoices.filter((i) => i.status !== "cancelled" || (i.cancelledAt && i.cancelledAt > cutoff));
    const ids = live.map((i) => i._id);
    const [paid, notes] = await Promise.all([paidAsOf({ business, invoiceIds: ids, asOf: cutoff }), notesAsOf({ business, invoiceIds: ids, asOf: cutoff })]);
    const grouped = new Map();
    for (const invoice of live) {
      const outstanding = round2(invoice.total + (notes.get(String(invoice._id)) || 0) - (paid.get(String(invoice._id)) || 0));
      if (outstanding <= 0.005) continue;
      const days = Math.floor((cutoff - new Date(invoice.dueDate)) / DAY_MS);
      const bucket = days <= 0 ? "current" : days <= 30 ? "d1_30" : days <= 60 ? "d31_60" : days <= 90 ? "d61_90" : "d90_plus";
      const key = `${invoice.client}:${bucket}`;
      const row = grouped.get(key) || { _id: { client: invoice.client, bucket }, amount: 0, count: 0 };
      row.amount += outstanding;
      row.count += 1;
      grouped.set(key, row);
    }
    invoiceRows = [...grouped.values()];
  }

  const clientIds = [...new Set(invoiceRows.map((r) => String(r._id.client)))];
  const [clients, unappliedRows] = await Promise.all([
    Client.find({ _id: { $in: clientIds } }).select("name clientCode accountManager").lean(),
    ClientReceipt.aggregate([
      { $match: { business: oid(business), status: "posted", unappliedAmount: { $gt: 0 }, ...(clientIds.length ? { client: { $in: clientIds.map(oid) } } : {}) } },
      { $group: { _id: "$client", unapplied: { $sum: "$unappliedAmount" } } },
    ]),
  ]);
  const clientById = new Map(clients.map((c) => [String(c._id), c]));
  const unappliedByClient = new Map(unappliedRows.map((r) => [String(r._id), r.unapplied]));
  const ownerNames = await loadUserNames(clients.map((c) => c.accountManager));

  const emptyRow = () => Object.fromEntries([...BUCKETS, "total", "invoiceCount"].map((k) => [k, 0]));
  const byKey = new Map();
  for (const row of invoiceRows) {
    const client = clientById.get(String(row._id.client));
    const ownerKey = client?.accountManager ? String(client.accountManager) : "unassigned";
    const key = groupBy === "owner" ? ownerKey : String(row._id.client);
    if (!byKey.has(key)) {
      byKey.set(key, groupBy === "owner"
        ? { ownerId: ownerKey === "unassigned" ? null : ownerKey, ownerName: ownerNames.get(ownerKey) || "Unassigned", clientCount: 0, _clients: new Set(), ...emptyRow() }
        : { clientId: key, clientName: client?.name || "", clientCode: client?.clientCode || "", ownerId: client?.accountManager || null, ownerName: ownerNames.get(ownerKey) || "", ...emptyRow() });
    }
    const target = byKey.get(key);
    target[row._id.bucket] = round2(target[row._id.bucket] + row.amount);
    target.total = round2(target.total + row.amount);
    target.invoiceCount += row.count;
    if (target._clients) target._clients.add(String(row._id.client));
  }

  const rows = [...byKey.values()].map((row) => {
    if (row._clients) {
      const unapplied = round2([...row._clients].reduce((sum, id) => sum + (unappliedByClient.get(id) || 0), 0));
      const { _clients, ...rest } = row;
      return { ...rest, clientCount: _clients.size, unapplied, net: round2(row.total - unapplied) };
    }
    const unapplied = round2(unappliedByClient.get(row.clientId) || 0);
    return { ...row, unapplied, net: round2(row.total - unapplied) };
  }).sort((a, b) => b.total - a.total);

  const totals = emptyRow();
  for (const row of rows) for (const key of [...BUCKETS, "total", "invoiceCount"]) totals[key] = round2(totals[key] + row[key]);
  totals.unapplied = round2(rows.reduce((s, r) => s + r.unapplied, 0));
  totals.net = round2(totals.total - totals.unapplied);

  const { rows: pageRows, pagination } = paginate(rows, { page, limit });
  return { asOf: cutoff, groupBy, historical: Boolean(historical), rows: pageRows, totals, pagination };
};

// ─── Client statement ────────────────────────────────────────────────────────

/**
 * Running-balance statement. Charges: invoices, debit notes, refunds of
 * credit. Credits: receipts (cash), WHT withheld, credit notes, legacy
 * payments. With `from`, everything earlier collapses into an opening balance.
 * Keeps the TenantStatementTab contract (transactions, totalCharges,
 * totalPayments, operationalOutstanding, unappliedCredits, currentBalance).
 */
export const buildClientStatement = async ({ business, clientId, from = null, to = null }) => {
  const end = to ? endOfDay(to) : null;
  const dateCap = (field) => (end ? { [field]: { $lte: end } } : {});
  const [invoices, notes, payments, receipts, refunds] = await Promise.all([
    ClientInvoice.find({ client: clientId, business, status: LIVE_INVOICE, ...dateCap("issueDate") }).select("invoiceNumber issueDate dueDate total status").lean(),
    ClientCreditNote.find({ client: clientId, business, status: "posted", ...dateCap("noteDate") }).select("noteType noteNumber noteDate total invoiceNumber reason").lean(),
    ClientPayment.find({ client: clientId, business, status: { $ne: "reversed" }, ...dateCap("paymentDate") }).select("invoice amount paymentDate paymentMethod paymentReference").lean(),
    ClientReceipt.find({ client: clientId, business, status: "posted", ...dateCap("receiptDate") }).select("receiptNumber receiptDate amount method reference allocations whtIncomeTax whtVat unappliedAmount").lean(),
    ClientCreditRefund.find({ client: clientId, business, status: "posted", ...dateCap("refundDate") }).select("refundNumber refundDate amount reference").lean(),
  ]);

  const invoiceNumberById = new Map(invoices.map((inv) => [String(inv._id), inv.invoiceNumber]));
  const tx = [];
  for (const inv of invoices) {
    tx.push({ id: String(inv._id), date: inv.issueDate, dueDate: inv.dueDate, description: `Invoice ${inv.invoiceNumber}`, type: "CHARGE", transactionCode: inv.invoiceNumber, amount: inv.total, sourceKind: "invoice", sourceId: String(inv._id) });
  }
  for (const note of notes) {
    const isDebit = note.noteType === "DEBIT_NOTE";
    tx.push({ id: String(note._id), date: note.noteDate, description: `${isDebit ? "Debit" : "Credit"} note ${note.noteNumber}${note.invoiceNumber ? ` — ${note.invoiceNumber}` : ""}`, type: isDebit ? "CHARGE" : "CREDIT", transactionCode: note.noteNumber, amount: note.total, sourceKind: isDebit ? "debit_note" : "credit_note", sourceId: String(note._id) });
  }
  for (const pay of payments) {
    const forInvoice = invoiceNumberById.get(String(pay.invoice));
    tx.push({ id: String(pay._id), date: pay.paymentDate, description: `Payment received${forInvoice ? ` — ${forInvoice}` : ""}`, type: "PAYMENT", transactionCode: pay.paymentReference || "", amount: pay.amount, sourceKind: "receipt", sourceId: String(pay._id) });
  }
  for (const receipt of receipts) {
    const allocations = (receipt.allocations || []).filter((a) => a.status === "active").map((a) => ({ invoiceId: String(a.invoice), invoiceNumber: a.invoiceNumber, amount: a.amount, kind: a.kind, appliedAt: a.appliedAt }));
    const applied = allocations.filter((a) => a.kind === "receipt").map((a) => a.invoiceNumber);
    if (receipt.amount > 0) {
      tx.push({ id: String(receipt._id), date: receipt.receiptDate, description: `Receipt ${receipt.receiptNumber}${applied.length ? ` — ${applied.join(", ")}` : ""}`, type: "PAYMENT", transactionCode: receipt.reference || receipt.receiptNumber, amount: receipt.amount, sourceKind: "client_receipt", sourceId: String(receipt._id), allocations, unapplied: receipt.unappliedAmount });
    }
    for (const [kind, wht, label] of [["wht_income_tax", receipt.whtIncomeTax, "Income tax withheld"], ["wht_vat", receipt.whtVat, "VAT withheld"]]) {
      if (!(wht?.amount > 0)) continue;
      tx.push({ id: `${receipt._id}:${kind}`, date: receipt.receiptDate, description: `${label} — ${receipt.receiptNumber}${wht.certificateNo ? ` (cert ${wht.certificateNo})` : ""}`, type: "PAYMENT", transactionCode: wht.certificateNo || receipt.receiptNumber, amount: wht.amount, sourceKind: kind, sourceId: String(receipt._id) });
    }
  }
  for (const refund of refunds) {
    tx.push({ id: String(refund._id), date: refund.refundDate, description: `Refund of credit ${refund.refundNumber}`, type: "CHARGE", transactionCode: refund.reference || refund.refundNumber, amount: refund.amount, sourceKind: "credit_refund", sourceId: String(refund._id) });
  }

  // Same-day ordering: charges before the money that settles them.
  const order = { CHARGE: 0, CREDIT: 1, PAYMENT: 2 };
  tx.sort((a, b) => new Date(a.date) - new Date(b.date) || order[a.type] - order[b.type]);
  const sign = (t) => (t.type === "CHARGE" ? 1 : -1);

  const start = from ? startOfDay(from) : null;
  let openingBalance = 0;
  const transactions = [];
  for (const t of tx) {
    if (start && new Date(t.date) < start) openingBalance = round2(openingBalance + sign(t) * t.amount);
    else transactions.push(t);
  }
  let running = openingBalance;
  for (const t of transactions) {
    running = round2(running + sign(t) * t.amount);
    t.balance = running;
  }

  const sum = (predicate) => round2(transactions.filter(predicate).reduce((s, t) => s + t.amount, 0));
  const totalCharges = sum((t) => t.type === "CHARGE");
  const totalCredits = sum((t) => t.type === "CREDIT");
  const totalPayments = sum((t) => t.type === "PAYMENT");
  const totalWht = sum((t) => t.sourceKind === "wht_income_tax" || t.sourceKind === "wht_vat");
  const currentBalance = round2(openingBalance + totalCharges - totalCredits - totalPayments);

  return {
    period: { from: start, to: end },
    openingBalance,
    transactions,
    totalCharges,
    totalCredits,
    totalPayments,
    totalWht,
    closingBalance: currentBalance,
    operationalOutstanding: Math.max(0, currentBalance),
    unappliedCredits: Math.max(0, -currentBalance),
    currentBalance,
  };
};

// ─── Dashboard KPIs ──────────────────────────────────────────────────────────

export const getDashboardKpis = async ({ business, from = null, to = null }) => {
  const range = parseRange({ from, to });
  const now = new Date();
  const b = oid(business);
  const in90 = new Date(now.getTime() + 90 * DAY_MS);
  const ninetyAgo = new Date(now.getTime() - 90 * DAY_MS);

  const [activeContracts, renewalRows, billedRows, billed90Rows, receiptRows, paymentRows, arRows, revenueTop, overdueTop, churned, notesRows] = await Promise.all([
    ClientContract.find({ business, status: { $in: ACTIVE_CONTRACT_STATUSES } }).select("mrr lines currentValue baseValue billingCycle taxMode startDate endDate openEnded minimumTermMonths").lean(),
    ClientContract.aggregate([
      { $match: { business: b, status: { $in: ACTIVE_CONTRACT_STATUSES }, openEnded: { $ne: true }, endDate: { $gte: now, $lte: in90 } } },
      { $project: { days: { $divide: [{ $subtract: ["$endDate", now] }, DAY_MS] } } },
      { $group: { _id: null, d30: { $sum: { $cond: [{ $lte: ["$days", 30] }, 1, 0] } }, d60: { $sum: { $cond: [{ $lte: ["$days", 60] }, 1, 0] } }, d90: { $sum: 1 } } },
    ]),
    ClientInvoice.aggregate([
      { $match: { business: b, status: LIVE_INVOICE, issueDate: { $gte: range.from, $lte: range.to } } },
      { $group: { _id: null, total: { $sum: "$total" }, net: { $sum: "$subtotal" }, vat: { $sum: "$vatAmount" }, count: { $sum: 1 } } },
    ]),
    ClientInvoice.aggregate([
      { $match: { business: b, status: LIVE_INVOICE, issueDate: { $gte: ninetyAgo, $lte: now } } },
      { $group: { _id: null, total: { $sum: "$total" } } },
    ]),
    ClientReceipt.aggregate([
      { $match: { business: b, status: "posted", receiptDate: { $gte: range.from, $lte: range.to } } },
      { $group: { _id: null, cash: { $sum: "$amount" }, whtIncomeTax: { $sum: "$whtIncomeTax.amount" }, whtVat: { $sum: "$whtVat.amount" }, count: { $sum: 1 } } },
    ]),
    ClientPayment.aggregate([
      { $match: { business: b, status: { $ne: "reversed" }, paymentDate: { $gte: range.from, $lte: range.to } } },
      { $group: { _id: null, cash: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
    ClientInvoice.aggregate([
      { $match: { business: b, status: { $in: OPEN_INVOICE_STATUSES } } },
      { $project: { outstanding: clientInvoiceOutstandingExpr(), dueDate: 1 } },
      { $group: { _id: null, ar: { $sum: "$outstanding" }, overdue: { $sum: { $cond: [{ $lt: ["$dueDate", now] }, "$outstanding", 0] } }, overdueCount: { $sum: { $cond: [{ $and: [{ $lt: ["$dueDate", now] }, { $gt: ["$outstanding", 0.005] }] }, 1, 0] } } } },
    ]),
    ClientInvoice.aggregate([
      { $match: { business: b, status: LIVE_INVOICE, issueDate: { $gte: range.from, $lte: range.to } } },
      { $group: { _id: "$client", revenue: { $sum: "$subtotal" } } },
      { $sort: { revenue: -1 } },
      { $limit: 10 },
    ]),
    ClientInvoice.aggregate([
      { $match: { business: b, status: { $in: OPEN_INVOICE_STATUSES }, dueDate: { $lt: now } } },
      { $project: { client: 1, outstanding: clientInvoiceOutstandingExpr() } },
      { $match: { outstanding: { $gt: 0.005 } } },
      { $group: { _id: "$client", overdue: { $sum: "$outstanding" } } },
      { $sort: { overdue: -1 } },
      { $limit: 10 },
    ]),
    // Churn: terminated in the period, or ended in the period without a renewal.
    ClientContract.find({
      business,
      $or: [
        { status: "terminated", $or: [{ terminatedAt: { $gte: range.from, $lte: range.to } }, { terminatedAt: null, updatedAt: { $gte: range.from, $lte: range.to } }] },
        { status: { $in: ["expired", "active", "pending_renewal"] }, openEnded: { $ne: true }, endDate: { $gte: range.from, $lte: range.to }, supersededByContractId: null },
      ],
    }).select("mrr lines currentValue baseValue billingCycle taxMode status endDate startDate openEnded minimumTermMonths").lean(),
    ClientCreditNote.aggregate([
      { $match: { business: b, status: "posted", noteDate: { $gte: range.from, $lte: range.to } } },
      { $group: { _id: "$noteType", net: { $sum: "$subtotal" }, total: { $sum: "$total" } } },
    ]),
  ]);

  // An active/pending contract whose end date is still ahead isn't churn yet.
  const churnedContracts = churned.filter((c) => c.status === "terminated" || c.status === "expired" || (c.endDate && c.endDate < now));
  const mrr = round2(activeContracts.reduce((sum, c) => sum + contractMrr(c), 0));
  const lostMrr = round2(churnedContracts.reduce((sum, c) => sum + contractMrr(c), 0));

  const topIds = [...revenueTop, ...overdueTop].map((r) => r._id);
  const names = new Map((await Client.find({ _id: { $in: topIds } }).select("name clientCode").lean()).map((c) => [String(c._id), c]));
  const named = (rows, key) => rows.map((r) => ({ clientId: r._id, clientName: names.get(String(r._id))?.name || "", clientCode: names.get(String(r._id))?.clientCode || "", [key]: round2(r[key]) }));

  const billed = billedRows[0] || { total: 0, net: 0, vat: 0, count: 0 };
  const noteNet = (type) => notesRows.find((r) => r._id === type)?.net || 0;
  const receipts = receiptRows[0] || { cash: 0, whtIncomeTax: 0, whtVat: 0, count: 0 };
  const legacy = paymentRows[0] || { cash: 0, count: 0 };
  const ar = arRows[0] || { ar: 0, overdue: 0, overdueCount: 0 };
  const billed90 = billed90Rows[0]?.total || 0;

  return {
    period: range,
    mrr,
    arr: round2(mrr * 12),
    activeContracts: activeContracts.length,
    renewalsDue: { d30: renewalRows[0]?.d30 || 0, d60: renewalRows[0]?.d60 || 0, d90: renewalRows[0]?.d90 || 0 },
    billed: { total: round2(billed.total), net: round2(billed.net), vat: round2(billed.vat), invoices: billed.count, netAfterNotes: round2(billed.net - noteNet("CREDIT_NOTE") + noteNet("DEBIT_NOTE")) },
    collected: {
      cash: round2(receipts.cash + legacy.cash),
      whtIncomeTax: round2(receipts.whtIncomeTax),
      whtVat: round2(receipts.whtVat),
      total: round2(receipts.cash + legacy.cash + receipts.whtIncomeTax + receipts.whtVat),
      receipts: receipts.count + legacy.count,
    },
    receivables: round2(ar.ar),
    overdue: { total: round2(ar.overdue), invoices: ar.overdueCount },
    // Count-back-free DSO over the trailing 90 days of billing.
    dso: billed90 > 0 ? Math.round((ar.ar / billed90) * 90) : null,
    topClientsByRevenue: named(revenueTop, "revenue"),
    topClientsByOverdue: named(overdueTop, "overdue"),
    churn: {
      contracts: churnedContracts.length,
      lostMrr,
      rate: activeContracts.length + churnedContracts.length > 0 ? round2((churnedContracts.length / (activeContracts.length + churnedContracts.length)) * 100) : 0,
    },
  };
};

// ─── Billing forecast ────────────────────────────────────────────────────────

/**
 * Next N months of billing from active contracts, using the same schedule
 * generator the billing run uses (lines, frequencies, billing day, end dates;
 * legacy contracts as one currentValue line). Periods already invoiced,
 * skipped or cancelled in the stored schedule are excluded. Amounts are net
 * of VAT.
 */
export const getBillingForecast = async ({ business, months = 12, clientId = null }) => {
  const span = Math.min(Math.max(Number(months) || 12, 1), 36);
  const from = monthStart(new Date());
  const to = new Date(from.getFullYear(), from.getMonth() + span, 1);
  const contracts = await ClientContract.find({ business, status: { $in: ACTIVE_CONTRACT_STATUSES }, ...(clientId ? { client: clientId } : {}) })
    .select("client contractNumber lines currentValue baseValue billingCycle taxMode startDate endDate openEnded billingDay prorationRule terminationEffectiveDate version description")
    .lean();
  const done = contracts.length
    ? await ClientBillingSchedule.find({ business, contract: { $in: contracts.map((c) => c._id) }, billingDate: { $gte: from, $lt: to }, status: { $in: ["invoicing", "invoiced", "skipped", "cancelled"] } }).select("idempotencyKey").lean()
    : [];
  const doneKeys = new Set(done.map((d) => d.idempotencyKey));

  const buckets = new Map();
  for (let i = 0; i < span; i += 1) {
    const d = new Date(from.getFullYear(), from.getMonth() + i, 1);
    buckets.set(monthKey(d), { month: monthKey(d), amount: 0, contracts: new Set() });
  }
  for (const contract of contracts) {
    for (const row of buildContractSchedule({ contract, horizonEnd: to })) {
      const date = new Date(row.billingDate);
      if (date < from || date >= to || doneKeys.has(row.idempotencyKey)) continue;
      const { netAmount } = calculateLineAmounts({ quantity: row.quantity, unitPrice: row.unitPrice, discountPercent: row.discountPercent, prorationFactor: row.prorationFactor, taxMode: "exclusive" });
      const bucket = buckets.get(monthKey(date));
      if (!bucket) continue;
      bucket.amount = round2(bucket.amount + netAmount);
      bucket.contracts.add(String(contract._id));
    }
  }
  const rows = [...buckets.values()].map((b) => ({ month: b.month, amount: b.amount, contracts: b.contracts.size }));
  return { from, to, months: rows, total: round2(rows.reduce((s, r) => s + r.amount, 0)) };
};

// ─── Revenue by client / service / owner ─────────────────────────────────────

export const getRevenueBreakdown = async ({ business, from = null, to = null, groupBy = "client", page = 1, limit = 50 }) => {
  const range = parseRange({ from, to }, "year");
  const b = oid(business);
  const invoiceMatch = { business: b, status: LIVE_INVOICE, issueDate: { $gte: range.from, $lte: range.to } };
  const noteMatch = { business: b, status: "posted", noteDate: { $gte: range.from, $lte: range.to } };
  const noteSign = { $cond: [{ $eq: ["$noteType", "DEBIT_NOTE"] }, 1, -1] };

  let invoiceRows;
  let noteRows;
  if (groupBy === "service") {
    const serviceKey = { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ["$lineItems.itemName", ""] } }, 0] }, "$lineItems.itemName", "$lineItems.description"] };
    [invoiceRows, noteRows] = await Promise.all([
      ClientInvoice.aggregate([{ $match: invoiceMatch }, { $unwind: "$lineItems" }, { $group: { _id: serviceKey, net: { $sum: "$lineItems.amount" }, count: { $sum: 1 } } }]),
      ClientCreditNote.aggregate([{ $match: noteMatch }, { $unwind: "$lines" }, { $group: { _id: "$lines.description", net: { $sum: { $multiply: ["$lines.netAmount", noteSign] } } } }]),
    ]);
  } else {
    [invoiceRows, noteRows] = await Promise.all([
      ClientInvoice.aggregate([{ $match: invoiceMatch }, { $group: { _id: "$client", net: { $sum: "$subtotal" }, vat: { $sum: "$vatAmount" }, count: { $sum: 1 } } }]),
      ClientCreditNote.aggregate([{ $match: noteMatch }, { $group: { _id: "$client", net: { $sum: { $multiply: ["$subtotal", noteSign] } } } }]),
    ]);
  }

  const merged = new Map();
  for (const row of invoiceRows) merged.set(String(row._id), { key: row._id, invoiced: round2(row.net), adjustments: 0, invoices: row.count || 0 });
  for (const row of noteRows) {
    const entry = merged.get(String(row._id)) || { key: row._id, invoiced: 0, adjustments: 0, invoices: 0 };
    entry.adjustments = round2(entry.adjustments + row.net);
    merged.set(String(row._id), entry);
  }

  let rows = [...merged.values()].map((r) => ({ ...r, revenue: round2(r.invoiced + r.adjustments) }));
  if (groupBy === "service") {
    rows = rows.map(({ key, ...r }) => ({ service: key || "(unnamed)", ...r }));
  } else {
    const clients = await Client.find({ _id: { $in: rows.map((r) => r.key) } }).select("name clientCode accountManager").lean();
    const byId = new Map(clients.map((c) => [String(c._id), c]));
    const owners = await loadUserNames(clients.map((c) => c.accountManager));
    rows = rows.map(({ key, ...r }) => {
      const client = byId.get(String(key));
      return { clientId: key, clientName: client?.name || "", clientCode: client?.clientCode || "", ownerId: client?.accountManager || null, ownerName: owners.get(String(client?.accountManager)) || "Unassigned", ...r };
    });
    if (groupBy === "owner") {
      const byOwner = new Map();
      for (const row of rows) {
        const key = String(row.ownerId || "unassigned");
        const entry = byOwner.get(key) || { ownerId: row.ownerId, ownerName: row.ownerName, invoiced: 0, adjustments: 0, revenue: 0, invoices: 0, clients: 0 };
        entry.invoiced = round2(entry.invoiced + row.invoiced);
        entry.adjustments = round2(entry.adjustments + row.adjustments);
        entry.revenue = round2(entry.revenue + row.revenue);
        entry.invoices += row.invoices;
        entry.clients += 1;
        byOwner.set(key, entry);
      }
      rows = [...byOwner.values()];
    }
  }
  rows.sort((a, b) => b.revenue - a.revenue);
  const total = round2(rows.reduce((s, r) => s + r.revenue, 0));
  const { rows: pageRows, pagination } = paginate(rows, { page, limit });
  return { period: range, groupBy, basis: "invoices net of VAT, adjusted by posted credit/debit notes (accrual, by document date)", rows: pageRows, total, pagination };
};

// ─── Contract register / renewals ────────────────────────────────────────────

export const getContractRegister = async ({ business, status = null, clientId = null, search = "", page = 1, limit = 50 }) => {
  const filter = { business };
  if (status) filter.status = status;
  if (clientId) filter.client = clientId;
  if (search) {
    const pattern = new RegExp(escapeRegex(String(search).trim()), "i");
    filter.$or = [{ contractNumber: pattern }, { description: pattern }];
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safePage = Math.max(Number(page) || 1, 1);
  const [contracts, total, statusTotals] = await Promise.all([
    ClientContract.find(filter)
      .select("client contractNumber description contractType status startDate endDate openEnded billingCycle currentValue baseValue mrr tcv acv lines taxMode currency owner renewalStage autoRenew minimumTermMonths")
      .populate("client", "name clientCode")
      .sort({ startDate: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    ClientContract.countDocuments(filter),
    ClientContract.aggregate([{ $match: { business: oid(business) } }, { $group: { _id: "$status", count: { $sum: 1 }, tcv: { $sum: "$tcv" } } }]),
  ]);
  const rows = contracts.map(({ lines, ...c }) => ({ ...c, lineCount: lines?.length || 0, mrr: contractMrr({ ...c, lines }) }));
  return {
    rows,
    byStatus: statusTotals.map((s) => ({ status: s._id, count: s.count, tcv: round2(s.tcv || 0) })),
    pagination: { page: safePage, limit: safeLimit, total, pages: Math.max(Math.ceil(total / safeLimit), 1) },
  };
};

export const getRenewalsAndExpiries = async ({ business, days = 90, pastDays = 30, page = 1, limit = 50 }) => {
  const now = new Date();
  const ahead = new Date(now.getTime() + Math.min(Number(days) || 90, 730) * DAY_MS);
  const behind = new Date(now.getTime() - Math.min(Number(pastDays) || 30, 365) * DAY_MS);
  const contracts = await ClientContract.find({
    business,
    openEnded: { $ne: true },
    endDate: { $gte: behind, $lte: ahead },
    status: { $in: ["active", "pending_renewal", "expired", "suspended"] },
    supersededByContractId: null,
  })
    .select("client contractNumber description status endDate noticePeriodDays autoRenew renewalStage currentValue mrr lines taxMode billingCycle startDate minimumTermMonths")
    .populate("client", "name clientCode")
    .sort({ endDate: 1 })
    .lean();
  const rows = contracts.map(({ lines, ...c }) => {
    const daysToEnd = Math.ceil((new Date(c.endDate) - now) / DAY_MS);
    const noticeDeadline = new Date(new Date(c.endDate).getTime() - Number(c.noticePeriodDays || 0) * DAY_MS);
    return { ...c, mrr: contractMrr({ ...c, lines }), daysToEnd, expired: daysToEnd < 0, noticeDeadline, noticePassed: noticeDeadline < now };
  });
  const summary = {
    expiredNotRenewed: rows.filter((r) => r.expired).length,
    d30: rows.filter((r) => !r.expired && r.daysToEnd <= 30).length,
    d60: rows.filter((r) => !r.expired && r.daysToEnd <= 60).length,
    d90: rows.filter((r) => !r.expired && r.daysToEnd <= 90).length,
    mrrAtRisk: round2(rows.filter((r) => !r.autoRenew).reduce((s, r) => s + r.mrr, 0)),
  };
  const { rows: pageRows, pagination } = paginate(rows, { page, limit });
  return { summary, rows: pageRows, pagination };
};

// ─── Sales VAT report ────────────────────────────────────────────────────────

/**
 * Output VAT on client sales for a period: one row per invoice/note with the
 * buyer's PIN (what KRA's VAT3 sales schedule asks for), split into standard
 * rated, zero-rated/exempt and VAT. Notes reduce (credit) or add (debit).
 */
export const getSalesVatReport = async ({ business, from = null, to = null, page = 1, limit = 100 }) => {
  const range = parseRange({ from, to });
  const [invoices, notes] = await Promise.all([
    ClientInvoice.find({ business, status: LIVE_INVOICE, issueDate: { $gte: range.from, $lte: range.to } })
      .select("client invoiceNumber issueDate subtotal vatAmount total lineItems.amount lineItems.taxRate lineItems.taxType lineItems.taxable vatRate taxCalculation etimsCuInvoiceNumber")
      .sort({ issueDate: 1 })
      .lean(),
    ClientCreditNote.find({ business, status: "posted", noteDate: { $gte: range.from, $lte: range.to } })
      .select("client noteType noteNumber noteDate invoiceNumber subtotal taxAmount total lines.netAmount lines.taxAmount")
      .sort({ noteDate: 1 })
      .lean(),
  ]);
  const clients = await Client.find({ _id: { $in: [...new Set([...invoices, ...notes].map((d) => String(d.client)))] } }).select("name taxPin").lean();
  const byId = new Map(clients.map((c) => [String(c._id), c]));

  const rows = [];
  for (const inv of invoices) {
    // Standard-rated = lines that carried VAT; the rest is zero-rated/exempt.
    const vatable = round2((inv.lineItems || []).reduce((s, l) => {
      const carriesVat = inv.taxCalculation === "line" ? Number(l.taxRate || 0) > 0 && String(l.taxType || "").toLowerCase() === "vat" : l.taxable !== false && Number(inv.vatRate || 0) > 0;
      return s + (carriesVat ? Number(l.amount || 0) : 0);
    }, 0));
    const client = byId.get(String(inv.client));
    rows.push({ documentType: "invoice", documentId: inv._id, documentNumber: inv.invoiceNumber, date: inv.issueDate, clientName: client?.name || "", clientPin: client?.taxPin || "", standardRated: vatable, zeroOrExempt: round2(inv.subtotal - vatable), vat: round2(inv.vatAmount), total: round2(inv.total), etimsCuInvoiceNumber: inv.etimsCuInvoiceNumber || "" });
  }
  for (const note of notes) {
    const sign = note.noteType === "DEBIT_NOTE" ? 1 : -1;
    const vatable = round2((note.lines || []).reduce((s, l) => s + (Number(l.taxAmount || 0) > 0 ? Number(l.netAmount || 0) : 0), 0));
    const client = byId.get(String(note.client));
    rows.push({ documentType: note.noteType === "DEBIT_NOTE" ? "debit_note" : "credit_note", documentId: note._id, documentNumber: note.noteNumber, relatedInvoice: note.invoiceNumber, date: note.noteDate, clientName: client?.name || "", clientPin: client?.taxPin || "", standardRated: round2(sign * vatable), zeroOrExempt: round2(sign * (note.subtotal - vatable)), vat: round2(sign * note.taxAmount), total: round2(sign * note.total) });
  }
  rows.sort((a, b) => new Date(a.date) - new Date(b.date));
  const totals = rows.reduce((t, r) => ({ standardRated: round2(t.standardRated + r.standardRated), zeroOrExempt: round2(t.zeroOrExempt + r.zeroOrExempt), vat: round2(t.vat + r.vat), total: round2(t.total + r.total) }), { standardRated: 0, zeroOrExempt: 0, vat: 0, total: 0 });
  totals.missingPin = rows.filter((r) => !r.clientPin).length;
  const { rows: pageRows, pagination } = paginate(rows, { page, limit });
  return { period: range, rows: pageRows, totals, pagination };
};

// ─── WHT certificates outstanding ────────────────────────────────────────────

export const getWhtCertificatesReport = async ({ business, status = "expected", clientId = null, type = null, page = 1, limit = 50 }) => {
  const match = { business: oid(business) };
  if (status && status !== "all") match.status = status;
  if (clientId) match.client = oid(clientId);
  if (type) match.type = type;
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safePage = Math.max(Number(page) || 1, 1);
  const [rows, total, byClient, totals] = await Promise.all([
    ClientWhtCertificate.find(match).populate("client", "name clientCode taxPin").sort({ withheldDate: 1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
    ClientWhtCertificate.countDocuments(match),
    ClientWhtCertificate.aggregate([
      { $match: match },
      { $group: { _id: "$client", incomeTax: { $sum: { $cond: [{ $eq: ["$type", "income_tax"] }, "$amount", 0] } }, vat: { $sum: { $cond: [{ $eq: ["$type", "vat"] }, "$amount", 0] } }, count: { $sum: 1 }, oldest: { $min: "$withheldDate" } } },
      { $sort: { oldest: 1 } },
      { $limit: 500 },
    ]),
    ClientWhtCertificate.aggregate([{ $match: match }, { $group: { _id: "$type", amount: { $sum: "$amount" }, count: { $sum: 1 } } }]),
  ]);
  const names = new Map((await Client.find({ _id: { $in: byClient.map((r) => r._id) } }).select("name clientCode").lean()).map((c) => [String(c._id), c]));
  const now = Date.now();
  return {
    rows: rows.map((r) => ({ ...r, daysOutstanding: r.status === "expected" ? Math.floor((now - new Date(r.withheldDate)) / DAY_MS) : null })),
    byClient: byClient.map((r) => ({ clientId: r._id, clientName: names.get(String(r._id))?.name || "", clientCode: names.get(String(r._id))?.clientCode || "", incomeTax: round2(r.incomeTax), vat: round2(r.vat), total: round2(r.incomeTax + r.vat), count: r.count, oldest: r.oldest })),
    totals: {
      incomeTax: round2(totals.find((t) => t._id === "income_tax")?.amount || 0),
      vat: round2(totals.find((t) => t._id === "vat")?.amount || 0),
      count: totals.reduce((s, t) => s + t.count, 0),
    },
    pagination: { page: safePage, limit: safeLimit, total, pages: Math.max(Math.ceil(total / safeLimit), 1) },
  };
};
