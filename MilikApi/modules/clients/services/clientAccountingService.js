/**
 * GL accounting service for the Client Management module.
 *
 * Mirrors the pattern already established across every other revenue-producing
 * module (PMS, Car Wash, Inventory/POS): every financial event posts a balanced
 * double-entry journal, guarded against double-posting. Invoice, note and
 * revenue-recognition journals go through postEntries, which writes every leg in
 * one Mongo transaction — a journal is either fully on the ledger or not at all.
 *
 * Accounts used (registered in services/chartOfAccountsService.js):
 *   1260 — Client Receivables      (asset)    debit side on invoice, credit side on payment
 *   4520 — Client Service Income   (income)   net of VAT (a line may override its income account)
 *   2165 — Deferred Revenue — Client Contracts (liability) straight-line / milestone lines
 *   2190 — VAT Payable — Output Tax(liability) shared clients+inventory output VAT, read by the VAT return
 *   11xx — whichever cashbook the payment was received into (debit side on payment)
 */

import mongoose from "mongoose";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import { postEntry, postEntries, postReversal } from "../../../services/ledgerPostingService.js";
import { findSystemAccountByCode } from "../../../services/chartOfAccountsService.js";
import { aggregateChartOfAccountBalances } from "../../../services/chartAccountAggregationService.js";
import { round2 } from "../../../utils/math.js";
import { createError } from "../../../utils/error.js";
import { CLIENT_OUTPUT_VAT_CODE } from "./clientTaxService.js";
import { DEFERRED_RECOGNITION_METHODS, monthEndDate } from "./clientLineMath.js";

const dayRange = (value = new Date()) => {
  const d = value ? new Date(value) : new Date();
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  const start = new Date(safe);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

export const CLIENT_ACCOUNT_CODES = Object.freeze({
  receivable: "1260",
  income: "4520",
  deferredRevenue: "2165",
  outputVat: CLIENT_OUTPUT_VAT_CODE,
});

const resolveClientReceivableAccount = (businessId) => findSystemAccountByCode(businessId, CLIENT_ACCOUNT_CODES.receivable);
const resolveClientIncomeAccount     = (businessId) => findSystemAccountByCode(businessId, CLIENT_ACCOUNT_CODES.income);
const resolveDeferredRevenueAccount  = (businessId) => findSystemAccountByCode(businessId, CLIENT_ACCOUNT_CODES.deferredRevenue);
const resolveOutputVatAccount        = (businessId) => findSystemAccountByCode(businessId, CLIENT_ACCOUNT_CODES.outputVat);

// FinancialLedgerEntry's sourceTransactionType/category are enums owned outside this module. Notes and
// recognition use their own dedicated values once those are added to the model; until then they fall
// back to client_invoice / existing categories and are told apart by metadata.clientDocumentType.
const SOURCE_TYPES = FinancialLedgerEntry.schema.path("sourceTransactionType")?.enumValues || [];
const CATEGORIES = FinancialLedgerEntry.schema.path("category")?.enumValues || [];
const sourceTypeFor = (preferred) => (SOURCE_TYPES.includes(preferred) ? preferred : "client_invoice");
const categoryFor = (preferred, fallback) => (CATEGORIES.includes(preferred) ? preferred : fallback);

export const CLIENT_LEDGER_SOURCES = Object.freeze({
  invoice: "client_invoice",
  note: sourceTypeFor("client_invoice_note"),
  recognition: sourceTypeFor("client_revenue_recognition"),
});

const requireAccounts = (...accounts) => {
  if (accounts.some((a) => !a?._id)) {
    throw new Error("Client Management chart-of-accounts entries are not available for this business — is the Client Management module enabled?");
  }
};

// A line's income account override must be a live posting income account of the same company.
export const validateIncomeAccount = async (businessId, accountId) => {
  if (!accountId) return null;
  if (!mongoose.Types.ObjectId.isValid(String(accountId))) throw createError(400, "Invalid income account");
  const account = await ChartOfAccount.findOne({
    _id: accountId,
    business: businessId,
    type: "income",
    isPosting: { $ne: false },
    isHeader: { $ne: true },
  }).select("_id code name").lean();
  if (!account) throw createError(400, "Income account must be a posting income account in this company's chart");
  return account;
};

const refreshBalances = (businessId, entries = []) =>
  aggregateChartOfAccountBalances(
    businessId,
    [...new Set(entries.map((e) => String(e.accountId)).filter(Boolean))]
  ).catch(() => null);

const assertBalanced = (legs, label) => {
  const debit = round2(legs.filter((l) => l.direction === "debit").reduce((s, l) => s + l.amount, 0));
  const credit = round2(legs.filter((l) => l.direction === "credit").reduce((s, l) => s + l.amount, 0));
  if (Math.abs(debit - credit) > 0.009) {
    throw createError(500, `${label} journal does not balance (Dr ${debit} / Cr ${credit}) — nothing was posted`);
  }
};

const isDeferredLine = (line) => DEFERRED_RECOGNITION_METHODS.has(line?.revenueRecognition);

// ─── Client Invoice — Dr Client Receivables (gross) ───────────────────────────
//                     Cr Service Income per income account (net, recognised now)
//                     Cr Deferred Revenue 2165 (net of straight-line/milestone lines)
//                     Cr Output VAT 2190 (if any)
// Pass `session` to join the caller's transaction (the invoice save + revenue schedules ride on it).
export const postClientInvoiceLedger = async ({ invoice, userId, session = null }) => {
  const total = round2(Number(invoice.total || 0));
  if (total <= 0) return [];

  const existingQuery = FinancialLedgerEntry.countDocuments({
    business: invoice.business,
    sourceTransactionType: CLIENT_LEDGER_SOURCES.invoice,
    sourceTransactionId: String(invoice._id),
    status: { $ne: "reversed" },
  });
  if (session) existingQuery.session(session);
  if ((await existingQuery) > 0) return [];

  const vatAmount = round2(Number(invoice.vatAmount || 0));
  const lineMode = invoice.taxCalculation === "line";
  const lines = Array.isArray(invoice.lineItems) ? invoice.lineItems : [];
  const hasDeferred = lineMode && lines.some(isDeferredLine);

  const [receivableAccount, incomeAccount, vatAccount, deferredAccount] = await Promise.all([
    resolveClientReceivableAccount(invoice.business),
    resolveClientIncomeAccount(invoice.business),
    vatAmount > 0 ? resolveOutputVatAccount(invoice.business) : Promise.resolve(null),
    hasDeferred ? resolveDeferredRevenueAccount(invoice.business) : Promise.resolve(null),
  ]);
  requireAccounts(receivableAccount, incomeAccount, ...(vatAmount > 0 ? [vatAccount] : []), ...(hasDeferred ? [deferredAccount] : []));

  // Net credits grouped by destination account (one leg per account keeps the journal readable).
  const creditsByAccount = new Map();
  const addCredit = (accountId, role, amount) => {
    const key = `${String(accountId)}|${role}`;
    const current = creditsByAccount.get(key) || { accountId, role, amount: 0 };
    current.amount = round2(current.amount + amount);
    creditsByAccount.set(key, current);
  };
  if (lineMode) {
    for (const line of lines) {
      const net = round2(Number(line.amount || 0));
      if (net <= 0) continue;
      if (isDeferredLine(line)) addCredit(deferredAccount._id, "client_deferred_revenue", net);
      else addCredit(line.incomeAccount || incomeAccount._id, "client_service_income", net);
    }
  } else {
    addCredit(incomeAccount._id, "client_service_income", round2(Number(invoice.subtotal || 0)));
  }

  const { start, end } = dayRange(invoice.issueDate);
  const journalGroupId = invoice.journalGroupId || new mongoose.Types.ObjectId();
  const base = {
    business: invoice.business,
    sourceTransactionType: CLIENT_LEDGER_SOURCES.invoice,
    sourceTransactionId: String(invoice._id),
    transactionDate: invoice.issueDate || new Date(),
    statementPeriodStart: invoice.periodStart || start,
    statementPeriodEnd: invoice.periodEnd || end,
    journalGroupId,
    category: "CLIENT_INVOICE",
    payer: "client",
    receiver: "system",
    createdBy: userId,
    approvedBy: userId,
    approvedAt: new Date(),
    status: "approved",
    allowUnscoped: true,
  };
  const meta = { invoiceNumber: invoice.invoiceNumber, clientDocumentType: "invoice", clientId: String(invoice.client?._id || invoice.client) };

  const legs = [
    {
      ...base,
      accountId: receivableAccount._id,
      direction: "debit",
      amount: total,
      notes: `Client invoice ${invoice.invoiceNumber} — receivable`,
      metadata: { ...meta, postingRole: "client_receivable" },
    },
    ...[...creditsByAccount.values()].filter((c) => c.amount > 0).map((c) => ({
      ...base,
      accountId: c.accountId,
      direction: "credit",
      amount: c.amount,
      notes: `Client invoice ${invoice.invoiceNumber} — ${c.role === "client_deferred_revenue" ? "deferred revenue" : "service income"}`,
      metadata: { ...meta, postingRole: c.role },
    })),
  ];
  if (vatAmount > 0) {
    legs.push({
      ...base,
      accountId: vatAccount._id,
      direction: "credit",
      amount: vatAmount,
      notes: `Client invoice ${invoice.invoiceNumber} — output VAT`,
      metadata: { ...meta, postingRole: "client_output_vat" },
    });
  }
  assertBalanced(legs, `Client invoice ${invoice.invoiceNumber}`);

  const entries = await postEntries(legs, { session });
  if (!session) await refreshBalances(invoice.business, entries);
  return entries;
};

// ─── Client Payment — Dr Cashbook / Cr Client Receivables ─────────────────────
export const postClientPaymentLedger = async ({ payment, invoice, userId }) => {
  const amount = round2(Number(payment.amount || 0));
  if (amount <= 0) return [];

  const existing = await FinancialLedgerEntry.countDocuments({
    business: payment.business,
    sourceTransactionType: "client_payment",
    sourceTransactionId: String(payment._id),
    status: { $ne: "reversed" },
  });
  if (existing > 0) return [];

  const { start, end } = dayRange(payment.paymentDate);
  const journalGroupId = new mongoose.Types.ObjectId();

  const [cashbookAccount, receivableAccount] = await Promise.all([
    findSystemAccountByCode(payment.business, payment.cashbookAccountCode),
    resolveClientReceivableAccount(payment.business),
  ]);

  if (!cashbookAccount?._id || !receivableAccount?._id) {
    throw new Error("Client Management chart-of-accounts entries are not available for this business — is the Client Management module enabled?");
  }

  const base = {
    business: payment.business,
    sourceTransactionType: "client_payment",
    sourceTransactionId: String(payment._id),
    transactionDate: payment.paymentDate || new Date(),
    statementPeriodStart: start,
    statementPeriodEnd: end,
    journalGroupId,
    category: "CLIENT_PAYMENT",
    payer: "client",
    receiver: "system",
    createdBy: userId,
    approvedBy: userId,
    approvedAt: new Date(),
    status: "approved",
    allowUnscoped: true,
  };

  const invoiceNumber = invoice?.invoiceNumber || "";

  let debitLeg;
  try {
    debitLeg = await postEntry({
      ...base,
      accountId: cashbookAccount._id,
      direction: "debit",
      amount,
      notes: `Client payment ${payment.paymentReference || String(payment._id).slice(-6)} — received for invoice ${invoiceNumber}`,
      metadata: { postingRole: "client_payment_received", invoiceNumber, cashbookAccountId: String(cashbookAccount._id) },
    });

    const creditLeg = await postEntry({
      ...base,
      accountId: receivableAccount._id,
      direction: "credit",
      amount,
      notes: `Client payment ${payment.paymentReference || String(payment._id).slice(-6)} — receivable settled for invoice ${invoiceNumber}`,
      metadata: {
        postingRole: "client_receivable_settlement",
        offsetOfEntryId: String(debitLeg._id),
        invoiceNumber,
      },
    });

    return [debitLeg, creditLeg];
  } catch (error) {
    if (debitLeg?._id) {
      await postReversal({
        entryId: debitLeg._id,
        reason: `Auto-reversal: GL balance protection for client payment ${payment._id}`,
        userId,
      }).catch(() => null);
    }
    throw error;
  }
};

// ─── Credit / Debit notes ─────────────────────────────────────────────────────
// Credit note: Dr Deferred Revenue (unrecognised part of a deferred line) + Dr Income (rest)
//              + Dr Output VAT / Cr Client Receivables.
// Debit note:  the mirror image, always to income (a debit note bills something new).
export const postClientNoteLedger = async ({ note, userId, session = null }) => {
  const total = round2(Number(note.total || 0));
  if (total <= 0) throw createError(400, "Note total must be greater than zero");
  const isCredit = note.noteType === "CREDIT_NOTE";
  const label = `${isCredit ? "Credit" : "Debit"} note ${note.noteNumber}${note.invoiceNumber ? ` — against ${note.invoiceNumber}` : ""}`;

  const lines = note.lines || [];
  const taxTotal = round2(lines.reduce((s, l) => s + Number(l.taxAmount || 0), 0));
  const hasDeferred = lines.some((l) => Number(l.deferredPortion || 0) > 0);

  const [receivableAccount, incomeAccount, vatAccount, deferredAccount] = await Promise.all([
    resolveClientReceivableAccount(note.business),
    resolveClientIncomeAccount(note.business),
    taxTotal > 0 ? resolveOutputVatAccount(note.business) : Promise.resolve(null),
    hasDeferred ? resolveDeferredRevenueAccount(note.business) : Promise.resolve(null),
  ]);
  requireAccounts(receivableAccount, incomeAccount, ...(taxTotal > 0 ? [vatAccount] : []), ...(hasDeferred ? [deferredAccount] : []));

  const sideFor = (receivableSide) => (receivableSide ? (isCredit ? "credit" : "debit") : (isCredit ? "debit" : "credit"));
  const offsets = new Map();
  const addOffset = (accountId, role, amount) => {
    if (!(amount > 0)) return;
    const key = `${String(accountId)}|${role}`;
    const current = offsets.get(key) || { accountId, role, amount: 0 };
    current.amount = round2(current.amount + amount);
    offsets.set(key, current);
  };
  for (const line of lines) {
    const deferred = isCredit ? round2(Number(line.deferredPortion || 0)) : 0;
    addOffset(deferredAccount?._id, "client_deferred_revenue", deferred);
    addOffset(line.incomeAccount || incomeAccount._id, "client_service_income", round2(Number(line.netAmount || 0) - deferred));
  }
  if (taxTotal > 0) addOffset(vatAccount._id, "client_output_vat", taxTotal);

  const { start, end } = dayRange(note.noteDate);
  const journalGroupId = note.journalGroupId || new mongoose.Types.ObjectId();
  const base = {
    business: note.business,
    sourceTransactionType: CLIENT_LEDGER_SOURCES.note,
    sourceTransactionId: String(note._id),
    transactionDate: note.noteDate || new Date(),
    statementPeriodStart: start,
    statementPeriodEnd: end,
    journalGroupId,
    category: isCredit ? categoryFor("CLIENT_CREDIT_NOTE", "ADJUSTMENT") : categoryFor("CLIENT_DEBIT_NOTE", "CLIENT_INVOICE"),
    payer: "client",
    receiver: "system",
    createdBy: userId,
    approvedBy: userId,
    approvedAt: new Date(),
    status: "approved",
    allowUnscoped: true,
  };
  const meta = {
    clientDocumentType: isCredit ? "credit_note" : "debit_note",
    noteNumber: note.noteNumber,
    invoiceId: String(note.invoice),
    invoiceNumber: note.invoiceNumber || "",
    clientId: String(note.client),
  };

  const legs = [
    {
      ...base,
      accountId: receivableAccount._id,
      direction: sideFor(true),
      amount: total,
      notes: `${label} — receivable`,
      metadata: { ...meta, postingRole: "client_receivable" },
    },
    ...[...offsets.values()].map((o) => ({
      ...base,
      accountId: o.accountId,
      direction: sideFor(false),
      amount: o.amount,
      notes: `${label} — ${o.role.replace("client_", "").replace(/_/g, " ")}`,
      metadata: { ...meta, postingRole: o.role },
    })),
  ];
  assertBalanced(legs, label);

  const entries = await postEntries(legs, { session });
  if (!session) await refreshBalances(note.business, entries);
  return { entries, journalGroupId };
};

// ─── Revenue recognition — Dr Deferred Revenue 2165 / Cr Income ───────────────
export const postClientRevenueRecognitionLedger = async ({ schedule, entry, userId, session = null }) => {
  const amount = round2(Number(entry.amount || 0));
  if (amount <= 0) return { entries: [], journalGroupId: null };
  const deferredAccount = await resolveDeferredRevenueAccount(schedule.business);
  requireAccounts(deferredAccount);

  const txDate = monthEndDate(entry.month);
  const periodStart = new Date(Date.UTC(txDate.getUTCFullYear(), txDate.getUTCMonth(), 1));
  const journalGroupId = new mongoose.Types.ObjectId();
  const base = {
    business: schedule.business,
    sourceTransactionType: CLIENT_LEDGER_SOURCES.recognition,
    sourceTransactionId: String(entry._id),
    transactionDate: txDate,
    statementPeriodStart: periodStart,
    statementPeriodEnd: txDate,
    journalGroupId,
    category: categoryFor("CLIENT_REVENUE_RECOGNITION", "CLIENT_INVOICE"),
    payer: "client",
    receiver: "system",
    createdBy: userId,
    approvedBy: userId,
    approvedAt: new Date(),
    status: "approved",
    allowUnscoped: true,
  };
  const meta = {
    clientDocumentType: "revenue_recognition",
    revenueScheduleId: String(schedule._id),
    invoiceId: String(schedule.invoice),
    invoiceNumber: schedule.invoiceNumber || "",
    month: entry.month,
    clientId: String(schedule.client),
  };
  const label = `Revenue recognition ${entry.month} — ${schedule.invoiceNumber || ""} ${schedule.description || ""}`.trim();
  const legs = [
    { ...base, accountId: deferredAccount._id, direction: "debit", amount, notes: `${label} — release deferred revenue`, metadata: { ...meta, postingRole: "client_deferred_revenue_release" } },
    { ...base, accountId: schedule.incomeAccount, direction: "credit", amount, notes: `${label} — service income`, metadata: { ...meta, postingRole: "client_service_income" } },
  ];
  const entries = await postEntries(legs, { session });
  if (!session) await refreshBalances(schedule.business, entries);
  return { entries, journalGroupId };
};

// Reverses every still-live entry in the list (each reversal is its own balanced counter-entry).
export const reverseClientLedgerEntries = async ({ business, entryIds = [], reason, userId, session = null }) => {
  if (!entryIds?.length) return [];
  const query = FinancialLedgerEntry.find({ _id: { $in: entryIds }, status: "approved" }).select("_id accountId");
  if (session) query.session(session);
  const live = await query.lean();
  const reversed = [];
  for (const entry of live) {
    const { reversalEntry } = await postReversal({ entryId: entry._id, reason, userId, session });
    reversed.push(reversalEntry);
  }
  if (!session && business) await refreshBalances(business, live);
  return reversed;
};

export { refreshBalances as refreshClientLedgerBalances };
