/**
 * Client receipts: one payment settling many invoices, unapplied credit,
 * credit application, refunds and reversal — with the GL posted in the same
 * Mongo transaction as the documents it describes, so a receipt and its
 * journal can never disagree (either both commit or neither does).
 *
 * Accounts (system accounts, resolved by code):
 *   1260 Client Receivables               Cr on allocation, Dr on reversal
 *   2136 Client Unapplied Receipts        Cr for unallocated excess, Dr when applied/refunded
 *   1265 WHT Recoverable — Client Income Tax   Dr for income-tax WHT withheld by the client
 *   1266 VAT Withheld Recoverable — Clients    Dr for VAT withheld (2% agents)
 *   cashbook (any posting asset account)   Dr cash actually received
 *
 * Journals post with sourceTransactionType "client_payment" / category
 * "CLIENT_PAYMENT" (the existing client-payment enums) and are told apart by
 * metadata.documentType: client_receipt | client_credit_application | client_credit_refund.
 */
import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import { round2 } from "../../../utils/math.js";
import { cleanVoucherReference, voucherReferenceKey } from "../../../utils/voucherReference.js";
import { escapeRegex } from "../../../utils/escapeRegex.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import MpesaCollection from "../../../models/MpesaCollection.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import { postEntries, postReversal } from "../../../services/ledgerPostingService.js";
import { findSystemAccountByCode } from "../../../services/chartOfAccountsService.js";
import { aggregateChartOfAccountBalances } from "../../../services/chartAccountAggregationService.js";
import { claimPaymentReference, releasePaymentReference } from "../../../services/paymentReferenceGuard.js";
import Client from "../models/Client.js";
import ClientInvoice, { CLIENT_INVOICE_OPEN_STATUSES } from "../models/ClientInvoice.js";
import ClientReceipt, { RECEIPT_METHODS } from "../models/ClientReceipt.js";
import ClientCreditRefund from "../models/ClientCreditRefund.js";
import ClientWhtCertificate from "../models/ClientWhtCertificate.js";
import ClientInvoiceFlag from "../models/ClientInvoiceFlag.js";
import { nextClientReceiptNumber, nextClientRefundNumber } from "./clientSequenceService.js";
import { computeClientInvoiceOutstanding, clientInvoiceOutstandingExpr } from "./clientInvoiceBalanceService.js";

export const CLIENT_ACCOUNT_CODES = Object.freeze({
  receivable: "1260",
  unapplied: "2136",
  whtIncomeTax: "1265",
  whtVat: "1266",
});

// Open = on the ledger and still owed: draft/cancelled/paid/credited excluded.
export const OPEN_INVOICE_STATUSES = CLIENT_INVOICE_OPEN_STATUSES;
export const VAT_WITHHOLDING_RATE = 2;
const TOLERANCE = 0.01;
// Fields the outstanding formula needs — every open-invoice read selects them.
export const OUTSTANDING_FIELDS = "total paidAmount creditedAmount debitedAmount status dueDate";

// Single definition shared with invoicing/statement/PDF:
// total − paidAmount − credit notes + debit notes.
export const invoiceOutstanding = (invoice) => Math.max(0, computeClientInvoiceOutstanding(invoice));

const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));
const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const dayRange = (value) => {
  const date = value ? new Date(value) : new Date();
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

const parseDate = (value, label) => {
  if (!value) return new Date();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw createError(400, `Invalid ${label}`);
  return date;
};

export const resolveCashbookAccount = async ({ business, cashbookAccountId }) => {
  if (!isObjectId(cashbookAccountId)) return null;
  return ChartOfAccount.findOne({
    _id: cashbookAccountId,
    business,
    isPosting: { $ne: false },
    isHeader: { $ne: true },
    type: "asset",
  }).lean();
};

const ACCOUNT_LABELS = {
  [CLIENT_ACCOUNT_CODES.receivable]: "Client Receivables (1260)",
  [CLIENT_ACCOUNT_CODES.unapplied]: "Client Unapplied Receipts (2136)",
  [CLIENT_ACCOUNT_CODES.whtIncomeTax]: "WHT Recoverable — Client Income Tax (1265)",
  [CLIENT_ACCOUNT_CODES.whtVat]: "VAT Withheld Recoverable — Clients (1266)",
};

// Resolve only the system accounts this posting actually needs, failing with
// a clear message (rather than a half-posted journal) when one is missing.
const resolveSystemAccounts = async (business, codes) => {
  const unique = [...new Set(codes)];
  const accounts = await Promise.all(unique.map((code) => findSystemAccountByCode(business, code)));
  const byCode = {};
  unique.forEach((code, index) => {
    if (!accounts[index]?._id) {
      throw createError(400, `${ACCOUNT_LABELS[code] || code} is not set up in this company's chart of accounts.`);
    }
    byCode[code] = accounts[index];
  });
  return byCode;
};

const assertReceiptReferenceUnused = async ({ business, reference, excludeId = null }) => {
  const key = voucherReferenceKey(reference);
  if (!key) return;
  const legacy = new RegExp(`^\\s*${key.split(" ").map(escapeRegex).join("\\s+")}\\s*$`, "i");
  const clash = await ClientReceipt.findOne({
    business,
    status: { $ne: "reversed" },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    $or: [{ referenceKey: key }, { reference: legacy }],
  }).select("receiptNumber").lean();
  if (clash) {
    throw createError(409, `Reference "${cleanVoucherReference(reference)}" is already used by client receipt ${clash.receiptNumber}. Each receipt must have its own reference.`);
  }
};

const runInTransaction = async (work) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};

const refreshBalances = (business, accountIds) =>
  aggregateChartOfAccountBalances(business, accountIds.filter(Boolean).map(String)).catch((err) =>
    console.error("[clientReceipts] balance refresh failed:", err?.message || err)
  );

const ledgerBase = ({ business, documentId, date, journalGroupId, userId }) => {
  const { start, end } = dayRange(date);
  return {
    business,
    sourceTransactionType: "client_payment",
    sourceTransactionId: String(documentId),
    transactionDate: date,
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
};

// ─── Invoice paid-amount updates ─────────────────────────────────────────────
// Single atomic pipeline update per invoice: the $expr guard refuses to push
// paidAmount past the total, so two receipts racing for the same invoice can
// never overpay it — the loser's transaction aborts instead.
const applyInvoicePayment = async ({ business, invoiceId, amount, date, session }) => {
  const now = new Date();
  const result = await ClientInvoice.updateOne(
    {
      _id: invoiceId,
      business,
      status: { $in: OPEN_INVOICE_STATUSES },
      $expr: { $lte: [amount, { $add: [clientInvoiceOutstandingExpr(), TOLERANCE] }] },
    },
    [
      { $set: { paidAmount: { $round: [{ $add: [{ $ifNull: ["$paidAmount", 0] }, amount] }, 2] } } },
      {
        $set: {
          status: {
            $cond: [
              { $lte: [clientInvoiceOutstandingExpr(), 0.005] },
              "paid",
              { $cond: [{ $lt: ["$dueDate", now] }, "overdue", "partial"] },
            ],
          },
          paidAt: date,
        },
      },
    ],
    { session }
  );
  if (result.matchedCount !== 1) {
    throw createError(409, "An invoice changed while this receipt was being posted (already paid, cancelled or over-allocated). Refresh and try again.");
  }
};

const removeInvoicePayment = async ({ business, invoiceId, amount, session }) => {
  const now = new Date();
  await ClientInvoice.updateOne(
    { _id: invoiceId, business },
    [
      { $set: { paidAmount: { $max: [0, { $round: [{ $subtract: [{ $ifNull: ["$paidAmount", 0] }, amount] }, 2] }] } } },
      {
        $set: {
          status: {
            $cond: [
              { $eq: ["$status", "cancelled"] },
              "cancelled",
              {
                $cond: [
                  { $lte: [clientInvoiceOutstandingExpr(), 0.005] },
                  { $cond: [{ $and: [{ $lte: ["$paidAmount", 0.005] }, { $gt: [{ $ifNull: ["$creditedAmount", 0] }, 0] }] }, "credited", "paid"] },
                  {
                    $cond: [
                      { $lt: ["$dueDate", now] },
                      "overdue",
                      { $cond: [{ $gt: ["$paidAmount", 0.005] }, "partial", { $cond: [{ $ifNull: ["$sentAt", false] }, "sent", "posted"] }] },
                    ],
                  },
                ],
              },
            ],
          },
          paidAt: { $cond: [{ $gt: ["$paidAmount", 0] }, "$paidAt", null] },
        },
      },
    ],
    { session }
  );
};

// ─── Open invoices + allocation suggestions ──────────────────────────────────

export const loadOpenInvoices = async ({ business, clientId, invoiceIds = null }) => {
  const filter = { business, client: clientId, status: { $in: OPEN_INVOICE_STATUSES } };
  if (invoiceIds) filter._id = { $in: invoiceIds };
  const invoices = await ClientInvoice.find(filter)
    .select(`invoiceNumber issueDate subtotal vatRate vatAmount contract ${OUTSTANDING_FIELDS}`)
    .sort({ dueDate: 1, issueDate: 1, _id: 1 })
    .lean();
  return invoices.filter((invoice) => invoiceOutstanding(invoice) > 0);
};

// Expected WHT on settling `share` of an invoice, per the client's tax setup.
// VAT withholding agents withhold 2% of the taxable value (not of the VAT).
const expectedWht = (invoice, client, share = 1) => {
  const behaviour = client?.taxBehaviour || {};
  const vatRate = Number(invoice.vatRate || 0);
  const taxableBase = vatRate > 0 ? round2((Number(invoice.vatAmount || 0) * 100) / vatRate) : 0;
  const whtVat = behaviour.vatWithholdingAgent && taxableBase > 0 ? round2(taxableBase * (VAT_WITHHOLDING_RATE / 100) * share) : 0;
  const rate = Number(behaviour.incomeTaxWhtRate || 0);
  const whtIncomeTax = behaviour.incomeTaxWhtAgent && rate > 0 ? round2(Number(invoice.subtotal || 0) * (rate / 100) * share) : 0;
  return { whtIncomeTax, whtVat };
};

/**
 * Oldest-first allocation suggestion (house rule: the system suggests, the
 * user adjusts). `amount` is cash received; WHT the client is expected to
 * withhold is added on top so a WHT agent's net payment still settles the
 * invoice in full. With no amount, every open invoice is suggested in full.
 * Disputed invoices are listed but not auto-allocated.
 */
export const suggestAllocations = async ({ business, clientId, amount = null }) => {
  const client = await Client.findOne({ _id: clientId, business }).select("name taxBehaviour").lean();
  if (!client) throw createError(404, "Client not found");

  const invoices = await loadOpenInvoices({ business, clientId });
  const flags = invoices.length
    ? await ClientInvoiceFlag.find({ business, invoice: { $in: invoices.map((i) => i._id) }, disputed: true }).select("invoice").lean()
    : [];
  const disputed = new Set(flags.map((f) => String(f.invoice)));

  let cashLeft = amount === null || amount === undefined || amount === "" ? Infinity : Math.max(0, round2(Number(amount)));
  const today = new Date();
  const rows = invoices.map((invoice) => {
    const outstanding = invoiceOutstanding(invoice);
    const share = Number(invoice.total) > 0 ? outstanding / Number(invoice.total) : 0;
    const wht = expectedWht(invoice, client, share);
    const whtTotal = round2(wht.whtIncomeTax + wht.whtVat);
    const isDisputed = disputed.has(String(invoice._id));

    let settle = 0;
    let suggestedWhtIncomeTax = 0;
    let suggestedWhtVat = 0;
    if (!isDisputed && cashLeft > 0) {
      const cashNeeded = round2(outstanding - whtTotal);
      if (cashLeft >= cashNeeded) {
        settle = outstanding;
        suggestedWhtIncomeTax = wht.whtIncomeTax;
        suggestedWhtVat = wht.whtVat;
        cashLeft = cashLeft === Infinity ? Infinity : round2(cashLeft - cashNeeded);
      } else {
        // Part-payment: settle s where s × (1 − whtRate) = cash left.
        const ratio = outstanding > 0 ? whtTotal / outstanding : 0;
        settle = round2(cashLeft / (1 - ratio));
        suggestedWhtIncomeTax = round2(wht.whtIncomeTax * (settle / outstanding));
        suggestedWhtVat = round2(wht.whtVat * (settle / outstanding));
        cashLeft = 0;
      }
    }

    const daysOverdue = Math.max(0, Math.floor((today - new Date(invoice.dueDate)) / 86400000));
    return {
      _id: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      status: invoice.status,
      total: invoice.total,
      paidAmount: invoice.paidAmount || 0,
      outstanding,
      daysOverdue,
      disputed: isDisputed,
      suggestedAmount: settle,
      suggestedWhtIncomeTax,
      suggestedWhtVat,
      suggestedCash: round2(settle - suggestedWhtIncomeTax - suggestedWhtVat),
    };
  });

  const sum = (key) => round2(rows.reduce((total, row) => total + row[key], 0));
  const unappliedCredit = await getClientUnappliedCredit({ business, clientId });
  return {
    invoices: rows,
    totals: {
      outstanding: sum("outstanding"),
      suggestedAllocated: sum("suggestedAmount"),
      suggestedWhtIncomeTax: sum("suggestedWhtIncomeTax"),
      suggestedWhtVat: sum("suggestedWhtVat"),
      suggestedCash: sum("suggestedCash"),
      // Cash beyond what the open invoices need lands on 2136.
      suggestedUnapplied: cashLeft === Infinity ? 0 : round2(cashLeft),
    },
    unappliedCreditAvailable: unappliedCredit,
  };
};

export const getClientUnappliedCredit = async ({ business, clientId }) => {
  const [row] = await ClientReceipt.aggregate([
    { $match: { business: toObjectId(business), client: toObjectId(clientId), status: "posted", unappliedAmount: { $gt: 0 } } },
    { $group: { _id: null, total: { $sum: "$unappliedAmount" } } },
  ]);
  return round2(row?.total || 0);
};

// Merge duplicate invoice lines and validate each against what's open.
const normalizeAllocations = (raw = []) => {
  if (!Array.isArray(raw)) throw createError(400, "allocations must be an array");
  const merged = new Map();
  for (const row of raw) {
    const invoiceId = String(row?.invoice || row?.invoiceId || "");
    const amount = round2(Number(row?.amount || 0));
    if (!amount) continue;
    if (!isObjectId(invoiceId)) throw createError(400, "Each allocation needs a valid invoice");
    if (amount < 0) throw createError(400, "Allocation amounts must be positive");
    merged.set(invoiceId, round2((merged.get(invoiceId) || 0) + amount));
  }
  return [...merged.entries()].map(([invoice, amount]) => ({ invoice, amount }));
};

const validateAllocationsAgainstInvoices = async ({ business, clientId, allocations }) => {
  if (!allocations.length) return [];
  const invoices = await loadOpenInvoices({ business, clientId, invoiceIds: allocations.map((a) => a.invoice) });
  const byId = new Map(invoices.map((invoice) => [String(invoice._id), invoice]));
  return allocations.map((allocation) => {
    const invoice = byId.get(allocation.invoice);
    if (!invoice) throw createError(400, "One of the allocated invoices is not an open invoice of this client");
    const outstanding = invoiceOutstanding(invoice);
    if (allocation.amount > outstanding + TOLERANCE) {
      throw createError(400, `Allocation of ${allocation.amount} to ${invoice.invoiceNumber} exceeds its outstanding balance (${outstanding})`);
    }
    return { ...allocation, invoiceNumber: invoice.invoiceNumber, invoiceDoc: invoice };
  });
};

const oldestFirstAllocations = async ({ business, clientId, settlement, onlyInvoiceId = null }) => {
  const invoices = await loadOpenInvoices({ business, clientId, invoiceIds: onlyInvoiceId ? [onlyInvoiceId] : null });
  const flags = invoices.length
    ? await ClientInvoiceFlag.find({ business, invoice: { $in: invoices.map((i) => i._id) }, disputed: true }).select("invoice").lean()
    : [];
  const disputed = new Set(flags.map((f) => String(f.invoice)));
  let left = settlement;
  const allocations = [];
  for (const invoice of invoices) {
    if (left <= 0) break;
    if (!onlyInvoiceId && disputed.has(String(invoice._id))) continue;
    const amount = round2(Math.min(left, invoiceOutstanding(invoice)));
    if (amount <= 0) continue;
    allocations.push({ invoice: String(invoice._id), amount });
    left = round2(left - amount);
  }
  return allocations;
};

// ─── Create receipt ──────────────────────────────────────────────────────────

/**
 * Posts a client receipt. `input.allocations`:
 *   undefined → allocate oldest-first automatically (M-Pesa, quick receipts)
 *   []        → hold the whole amount as unapplied credit
 *   [{invoice, amount}] → exactly as given (validated)
 */
export const createClientReceipt = async ({ business, userId = null, input = {}, source = "manual", mpesaCollectionId = null, session: outerSession = null }) => {
  const clientId = String(input.client || input.clientId || "");
  if (!isObjectId(clientId)) throw createError(400, "Client is required");
  const client = await Client.findOne({ _id: clientId, business }).select("name clientCode terms").lean();
  if (!client) throw createError(404, "Client not found");

  const method = String(input.method || "").trim();
  if (!RECEIPT_METHODS.includes(method)) throw createError(400, `method must be one of: ${RECEIPT_METHODS.join(", ")}`);

  const amount = round2(Number(input.amount || 0));
  const whtIncomeTax = round2(Number(input.whtIncomeTax?.amount ?? input.whtIncomeTaxAmount ?? 0));
  const whtVat = round2(Number(input.whtVat?.amount ?? input.whtVatAmount ?? 0));
  if (amount < 0 || whtIncomeTax < 0 || whtVat < 0) throw createError(400, "Amounts cannot be negative");
  const settlement = round2(amount + whtIncomeTax + whtVat);
  if (settlement <= 0) throw createError(400, "Receipt amount must be greater than zero");

  const receiptDate = parseDate(input.receiptDate || input.date, "receipt date");
  const reference = cleanVoucherReference(input.reference);

  let chequeFields = {};
  if (method === "cheque") {
    const chequeNumber = String(input.chequeNumber || "").trim();
    if (!chequeNumber) throw createError(400, "Cheque number is required for cheque receipts");
    chequeFields = {
      chequeNumber,
      chequeClearingDate: input.chequeClearingDate ? parseDate(input.chequeClearingDate, "cheque clearing date") : null,
      chequeStatus: "pending",
    };
  }

  const cashbook = await resolveCashbookAccount({ business, cashbookAccountId: input.cashbookAccountId });
  if (!cashbook?._id) throw createError(400, "A valid cashbook (asset) account is required");

  const rawAllocations = input.allocations === undefined
    ? await oldestFirstAllocations({ business, clientId, settlement, onlyInvoiceId: input.preferInvoiceId || null })
    : normalizeAllocations(input.allocations);
  const allocations = await validateAllocationsAgainstInvoices({ business, clientId, allocations: rawAllocations });
  const allocated = round2(allocations.reduce((sum, a) => sum + a.amount, 0));
  if (allocated > settlement + TOLERANCE) {
    throw createError(400, `Allocations (${allocated}) exceed the receipt total including WHT (${settlement})`);
  }
  const unapplied = Math.max(0, round2(settlement - allocated));

  const codes = [];
  if (allocated > 0) codes.push(CLIENT_ACCOUNT_CODES.receivable);
  if (unapplied > 0) codes.push(CLIENT_ACCOUNT_CODES.unapplied);
  if (whtIncomeTax > 0) codes.push(CLIENT_ACCOUNT_CODES.whtIncomeTax);
  if (whtVat > 0) codes.push(CLIENT_ACCOUNT_CODES.whtVat);
  const accounts = await resolveSystemAccounts(business, codes);

  await assertReceiptReferenceUnused({ business, reference });
  const receiptId = new mongoose.Types.ObjectId();
  await claimPaymentReference({ business, reference, sourceModel: "ClientReceipt", sourceId: receiptId });

  const receiptNumber = await nextClientReceiptNumber(business);
  const journalGroupId = new mongoose.Types.ObjectId();
  const base = ledgerBase({ business, documentId: receiptId, date: receiptDate, journalGroupId, userId });
  const meta = { documentType: "client_receipt", receiptNumber, clientId: String(clientId), clientName: client.name };
  const label = `Client receipt ${receiptNumber}${reference ? ` (${reference})` : ""} — ${client.name}`;

  const legs = [];
  if (amount > 0) legs.push({ ...base, accountId: cashbook._id, direction: "debit", amount, notes: `${label} — cash received`, metadata: { ...meta, postingRole: "client_receipt_cash" } });
  if (whtIncomeTax > 0) legs.push({ ...base, accountId: accounts[CLIENT_ACCOUNT_CODES.whtIncomeTax]._id, direction: "debit", amount: whtIncomeTax, notes: `${label} — income tax withheld`, metadata: { ...meta, postingRole: "client_wht_income_tax_recoverable" } });
  if (whtVat > 0) legs.push({ ...base, accountId: accounts[CLIENT_ACCOUNT_CODES.whtVat]._id, direction: "debit", amount: whtVat, notes: `${label} — VAT withheld`, metadata: { ...meta, postingRole: "client_wht_vat_recoverable" } });
  for (const allocation of allocations) {
    legs.push({ ...base, accountId: accounts[CLIENT_ACCOUNT_CODES.receivable]._id, direction: "credit", amount: allocation.amount, notes: `${label} — settles ${allocation.invoiceNumber}`, metadata: { ...meta, postingRole: "client_receivable_settlement", invoiceId: allocation.invoice, invoiceNumber: allocation.invoiceNumber } });
  }
  if (unapplied > 0) legs.push({ ...base, accountId: accounts[CLIENT_ACCOUNT_CODES.unapplied]._id, direction: "credit", amount: unapplied, notes: `${label} — unapplied credit`, metadata: { ...meta, postingRole: "client_unapplied_receipt" } });

  const work = async (session) => {
    const entries = await postEntries(legs, { session });
    for (const allocation of allocations) {
      await applyInvoicePayment({ business, invoiceId: allocation.invoice, amount: allocation.amount, date: receiptDate, session });
    }
    const [receipt] = await ClientReceipt.create([{
      _id: receiptId,
      business,
      client: clientId,
      receiptNumber,
      receiptDate,
      amount,
      method,
      reference,
      ...chequeFields,
      cashbookAccountId: cashbook._id,
      cashbookAccountCode: cashbook.code,
      whtIncomeTax: { amount: whtIncomeTax, certificateNo: String(input.whtIncomeTax?.certificateNo || "").trim() },
      whtVat: { amount: whtVat, certificateNo: String(input.whtVat?.certificateNo || "").trim() },
      allocations: allocations.map((a) => ({ invoice: a.invoice, invoiceNumber: a.invoiceNumber, amount: a.amount, kind: "receipt", appliedAt: receiptDate, appliedBy: userId, journalGroupId })),
      unappliedAmount: unapplied,
      currency: client.terms?.currency || "KES",
      notes: String(input.notes || "").trim(),
      source,
      mpesaCollection: mpesaCollectionId,
      journalGroupId,
      ledgerEntries: entries.map((e) => e._id),
      createdBy: userId,
    }], { session });

    const certificates = [
      ["income_tax", whtIncomeTax, input.whtIncomeTax],
      ["vat", whtVat, input.whtVat],
    ].filter(([, value]) => value > 0).map(([type, value, raw]) => {
      const certificateNo = String(raw?.certificateNo || "").trim();
      return {
        business,
        client: clientId,
        receipt: receiptId,
        receiptNumber,
        invoices: allocations.map((a) => a.invoice),
        type,
        amount: value,
        withheldDate: receiptDate,
        certificateNo,
        certificateDate: certificateNo && raw?.certificateDate ? new Date(raw.certificateDate) : null,
        status: certificateNo ? "received" : "expected",
        receivedAt: certificateNo ? new Date() : null,
        receivedBy: certificateNo ? userId : null,
      };
    });
    if (certificates.length) await ClientWhtCertificate.insertMany(certificates, { session });
    return receipt;
  };

  let receipt;
  try {
    receipt = outerSession ? await work(outerSession) : await runInTransaction(work);
  } catch (error) {
    await releasePaymentReference({ business, reference, sourceModel: "ClientReceipt", sourceId: receiptId }).catch(() => {});
    if (error?.code === 11000 && /referenceKey/.test(String(error?.message))) {
      throw createError(409, `Reference "${reference}" is already used by another client receipt.`);
    }
    throw error;
  }

  refreshBalances(business, legs.map((leg) => leg.accountId));
  return receipt;
};

// ─── Apply unapplied credit to invoices ──────────────────────────────────────

/**
 * Applies a client's unapplied credit to invoices: Dr 2136 / Cr 1260. Credit
 * is drawn from the client's receipts oldest-first (or only `receiptId`), one
 * journal per receipt so every application traces back to the money that
 * funded it — all inside a single transaction.
 */
export const applyClientCredit = async ({ business, userId = null, clientId, allocations: rawAllocations, receiptId = null, date = null }) => {
  if (!isObjectId(clientId)) throw createError(400, "Client is required");
  const appliedAt = parseDate(date, "date");
  const allocations = await validateAllocationsAgainstInvoices({ business, clientId, allocations: normalizeAllocations(rawAllocations) });
  if (!allocations.length) throw createError(400, "Nothing to apply — give at least one invoice and amount");
  const totalToApply = round2(allocations.reduce((sum, a) => sum + a.amount, 0));

  const receiptFilter = { business, client: clientId, status: "posted", unappliedAmount: { $gt: 0 } };
  if (receiptId) receiptFilter._id = receiptId;
  const receipts = await ClientReceipt.find(receiptFilter).select("receiptNumber unappliedAmount receiptDate").sort({ receiptDate: 1, _id: 1 }).lean();
  const available = round2(receipts.reduce((sum, r) => sum + r.unappliedAmount, 0));
  if (totalToApply > available + TOLERANCE) {
    throw createError(400, `Only ${available} of unapplied credit is available; ${totalToApply} was requested`);
  }

  // FIFO plan: which receipt funds how much of which invoice.
  const plan = new Map();
  const pool = receipts.map((r) => ({ ...r, left: r.unappliedAmount }));
  for (const allocation of allocations) {
    let need = allocation.amount;
    for (const source of pool) {
      if (need <= 0) break;
      const take = round2(Math.min(need, source.left));
      if (take <= 0) continue;
      source.left = round2(source.left - take);
      need = round2(need - take);
      const key = String(source._id);
      if (!plan.has(key)) plan.set(key, { receipt: source, parts: [] });
      plan.get(key).parts.push({ invoice: allocation.invoice, invoiceNumber: allocation.invoiceNumber, amount: take });
    }
  }

  const accounts = await resolveSystemAccounts(business, [CLIENT_ACCOUNT_CODES.receivable, CLIENT_ACCOUNT_CODES.unapplied]);
  const client = await Client.findOne({ _id: clientId, business }).select("name").lean();

  const updatedReceipts = await runInTransaction(async (session) => {
    const results = [];
    for (const { receipt, parts } of plan.values()) {
      const sum = round2(parts.reduce((total, part) => total + part.amount, 0));
      const journalGroupId = new mongoose.Types.ObjectId();
      const base = ledgerBase({ business, documentId: receipt._id, date: appliedAt, journalGroupId, userId });
      const meta = { documentType: "client_credit_application", receiptNumber: receipt.receiptNumber, clientId: String(clientId), clientName: client?.name || "" };
      const legs = [
        { ...base, accountId: accounts[CLIENT_ACCOUNT_CODES.unapplied]._id, direction: "debit", amount: sum, notes: `Credit from ${receipt.receiptNumber} applied`, metadata: { ...meta, postingRole: "client_unapplied_applied" } },
        ...parts.map((part) => ({ ...base, accountId: accounts[CLIENT_ACCOUNT_CODES.receivable]._id, direction: "credit", amount: part.amount, notes: `Credit from ${receipt.receiptNumber} applied to ${part.invoiceNumber}`, metadata: { ...meta, postingRole: "client_receivable_settlement", invoiceId: part.invoice, invoiceNumber: part.invoiceNumber } })),
      ];
      const entries = await postEntries(legs, { session });
      const entryIds = entries.map((e) => e._id);
      for (const part of parts) {
        await applyInvoicePayment({ business, invoiceId: part.invoice, amount: part.amount, date: appliedAt, session });
      }
      // Guarded decrement: a concurrent application/refund on the same
      // receipt can't take the unapplied balance below zero.
      const updated = await ClientReceipt.findOneAndUpdate(
        { _id: receipt._id, business, status: "posted", unappliedAmount: { $gte: sum - 0.005 } },
        {
          $inc: { unappliedAmount: -sum },
          $push: { allocations: { $each: parts.map((part) => ({ invoice: part.invoice, invoiceNumber: part.invoiceNumber, amount: part.amount, kind: "credit_application", appliedAt, appliedBy: userId, journalGroupId, ledgerEntries: entryIds })) } },
        },
        { new: true, session }
      );
      if (!updated) throw createError(409, `Receipt ${receipt.receiptNumber} changed while applying credit. Refresh and try again.`);
      // $inc can leave float dust (e.g. 1e-13) — snap to cents.
      if (updated.unappliedAmount !== round2(updated.unappliedAmount)) {
        await ClientReceipt.updateOne({ _id: updated._id }, { $set: { unappliedAmount: round2(updated.unappliedAmount) } }, { session });
        updated.unappliedAmount = round2(updated.unappliedAmount);
      }
      results.push(updated);
    }
    return results;
  });

  refreshBalances(business, [accounts[CLIENT_ACCOUNT_CODES.receivable]._id, accounts[CLIENT_ACCOUNT_CODES.unapplied]._id]);
  return { receipts: updatedReceipts, applied: totalToApply };
};

// Undo one credit application (not the original receipt allocation — that
// is undone by reversing the receipt).
export const reverseCreditApplication = async ({ business, userId = null, receiptId, allocationId, reason = "" }) => {
  const receipt = await ClientReceipt.findOne({ _id: receiptId, business, status: "posted" }).lean();
  if (!receipt) throw createError(404, "Receipt not found or already reversed");
  const allocation = receipt.allocations.find((a) => String(a._id) === String(allocationId));
  if (!allocation) throw createError(404, "Allocation not found");
  if (allocation.kind !== "credit_application") throw createError(400, "Only credit applications can be undone on their own — reverse the receipt to undo its original allocations");
  if (allocation.status === "reversed") throw createError(400, "This credit application is already reversed");

  // Applications made together share a journal; undo the whole group.
  const siblings = receipt.allocations.filter((a) => a.status === "active" && a.kind === "credit_application" && String(a.journalGroupId) === String(allocation.journalGroupId));
  const sum = round2(siblings.reduce((total, a) => total + a.amount, 0));
  const reversalReason = reason || `Credit application reversed on ${receipt.receiptNumber}`;

  await runInTransaction(async (session) => {
    const live = await FinancialLedgerEntry.find({ _id: { $in: allocation.ledgerEntries }, status: "approved" }).select("_id").session(session).lean();
    for (const entry of live) await postReversal({ entryId: entry._id, reason: reversalReason, userId, session });
    for (const sibling of siblings) {
      await removeInvoicePayment({ business, invoiceId: sibling.invoice, amount: sibling.amount, session });
    }
    const siblingIds = siblings.map((s) => s._id);
    await ClientReceipt.updateOne(
      { _id: receipt._id, business },
      {
        $inc: { unappliedAmount: sum },
        $set: { "allocations.$[a].status": "reversed", "allocations.$[a].reversedAt": new Date() },
      },
      { session, arrayFilters: [{ "a._id": { $in: siblingIds } }] }
    );
  });

  return ClientReceipt.findById(receipt._id).lean();
};

// ─── Refund unapplied credit ─────────────────────────────────────────────────

export const refundClientCredit = async ({ business, userId = null, receiptId, input = {} }) => {
  const receipt = await ClientReceipt.findOne({ _id: receiptId, business, status: "posted" }).lean();
  if (!receipt) throw createError(404, "Receipt not found or reversed");
  const amount = round2(Number(input.amount || 0));
  if (amount <= 0) throw createError(400, "Refund amount must be greater than zero");
  if (amount > receipt.unappliedAmount + TOLERANCE) {
    throw createError(400, `Refund (${amount}) exceeds the receipt's unapplied credit (${receipt.unappliedAmount})`);
  }
  const method = String(input.method || "bank_transfer");
  if (!["bank_transfer", "mobile_money", "cheque", "cash", "other"].includes(method)) throw createError(400, "Invalid refund method");
  const cashbook = await resolveCashbookAccount({ business, cashbookAccountId: input.cashbookAccountId });
  if (!cashbook?._id) throw createError(400, "A valid cashbook (asset) account is required");
  const refundDate = parseDate(input.refundDate || input.date, "refund date");
  const reference = cleanVoucherReference(input.reference);
  const accounts = await resolveSystemAccounts(business, [CLIENT_ACCOUNT_CODES.unapplied]);

  const refundId = new mongoose.Types.ObjectId();
  await claimPaymentReference({ business, reference, sourceModel: "ClientCreditRefund", sourceId: refundId });
  const refundNumber = await nextClientRefundNumber(business);
  const journalGroupId = new mongoose.Types.ObjectId();
  const base = ledgerBase({ business, documentId: refundId, date: refundDate, journalGroupId, userId });
  const meta = { documentType: "client_credit_refund", refundNumber, receiptNumber: receipt.receiptNumber, clientId: String(receipt.client) };
  const legs = [
    { ...base, receiver: "client", payer: "system", accountId: accounts[CLIENT_ACCOUNT_CODES.unapplied]._id, direction: "debit", amount, notes: `Refund ${refundNumber} of credit on ${receipt.receiptNumber}`, metadata: { ...meta, postingRole: "client_unapplied_refunded" } },
    { ...base, receiver: "client", payer: "system", accountId: cashbook._id, direction: "credit", amount, notes: `Refund ${refundNumber} paid out`, metadata: { ...meta, postingRole: "client_refund_cash" } },
  ];

  try {
    const refund = await runInTransaction(async (session) => {
      const entries = await postEntries(legs, { session });
      const updated = await ClientReceipt.updateOne(
        { _id: receipt._id, business, status: "posted", unappliedAmount: { $gte: amount - 0.005 } },
        { $inc: { unappliedAmount: -amount, refundedAmount: amount } },
        { session }
      );
      if (updated.matchedCount !== 1) throw createError(409, "The receipt's credit changed while refunding. Refresh and try again.");
      const [doc] = await ClientCreditRefund.create([{
        _id: refundId,
        business,
        client: receipt.client,
        receipt: receipt._id,
        refundNumber,
        refundDate,
        amount,
        method,
        reference,
        cashbookAccountId: cashbook._id,
        cashbookAccountCode: cashbook.code,
        notes: String(input.notes || "").trim(),
        journalGroupId,
        ledgerEntries: entries.map((e) => e._id),
        createdBy: userId,
      }], { session });
      return doc;
    });
    refreshBalances(business, [accounts[CLIENT_ACCOUNT_CODES.unapplied]._id, cashbook._id]);
    return refund;
  } catch (error) {
    await releasePaymentReference({ business, reference, sourceModel: "ClientCreditRefund", sourceId: refundId }).catch(() => {});
    throw error;
  }
};

export const reverseClientCreditRefund = async ({ business, userId = null, refundId, reason = "" }) => {
  const refund = await ClientCreditRefund.findOne({ _id: refundId, business }).lean();
  if (!refund) throw createError(404, "Refund not found");
  if (refund.status === "reversed") throw createError(400, "Refund is already reversed");
  const reversalReason = reason || `Client credit refund ${refund.refundNumber} reversed`;
  await runInTransaction(async (session) => {
    const live = await FinancialLedgerEntry.find({ _id: { $in: refund.ledgerEntries }, status: "approved" }).select("_id").session(session).lean();
    for (const entry of live) await postReversal({ entryId: entry._id, reason: reversalReason, userId, session });
    await ClientCreditRefund.updateOne({ _id: refund._id }, { $set: { status: "reversed", reversedBy: userId, reversedAt: new Date(), reversalReason } }, { session });
    await ClientReceipt.updateOne({ _id: refund.receipt, business }, { $inc: { unappliedAmount: refund.amount, refundedAmount: -refund.amount } }, { session });
  });
  await releasePaymentReference({ business, reference: refund.reference, sourceModel: "ClientCreditRefund", sourceId: refund._id }).catch(() => {});
  return ClientCreditRefund.findById(refund._id).lean();
};

// ─── Reverse receipt ─────────────────────────────────────────────────────────

/**
 * Reverses a receipt and everything hanging off it: its own journal, every
 * still-active credit application, the invoices' paid amounts and its WHT
 * certificates. Refunds must be reversed first — the money has left the bank.
 */
export const reverseClientReceipt = async ({ business, userId = null, receiptId, reason = "" }) => {
  const reversalReason = String(reason || "").trim();
  if (!reversalReason) throw createError(400, "A reversal reason is required");
  const receipt = await ClientReceipt.findOne({ _id: receiptId, business }).lean();
  if (!receipt) throw createError(404, "Receipt not found");
  if (receipt.status === "reversed") throw createError(400, "Receipt is already reversed");
  const liveRefund = await ClientCreditRefund.exists({ business, receipt: receipt._id, status: "posted" });
  if (liveRefund) throw createError(400, "This receipt has refunds paid out of its credit — reverse those refunds first");

  const activeAllocations = receipt.allocations.filter((a) => a.status === "active");
  const entryIds = [
    ...(receipt.ledgerEntries || []),
    ...activeAllocations.filter((a) => a.kind === "credit_application").flatMap((a) => a.ledgerEntries || []),
  ];

  const affectedAccounts = new Set();
  await runInTransaction(async (session) => {
    const live = await FinancialLedgerEntry.find({ _id: { $in: entryIds }, status: "approved" }).select("_id accountId").session(session).lean();
    for (const entry of live) {
      affectedAccounts.add(String(entry.accountId));
      await postReversal({ entryId: entry._id, reason: reversalReason, userId, session });
    }
    for (const allocation of activeAllocations) {
      await removeInvoicePayment({ business, invoiceId: allocation.invoice, amount: allocation.amount, session });
    }
    await ClientReceipt.updateOne(
      { _id: receipt._id, business, status: "posted" },
      {
        $set: {
          status: "reversed",
          referenceKey: null,
          unappliedAmount: 0,
          reversedBy: userId,
          reversedAt: new Date(),
          reversalReason,
          "allocations.$[a].status": "reversed",
          "allocations.$[a].reversedAt": new Date(),
        },
      },
      { session, arrayFilters: [{ "a.status": "active" }] }
    );
    await ClientWhtCertificate.updateMany({ business, receipt: receipt._id }, { $set: { status: "cancelled" } }, { session });
  });

  await releasePaymentReference({ business, reference: receipt.reference, sourceModel: "ClientReceipt", sourceId: receipt._id }).catch(() => {});
  // A reversed M-Pesa receipt (usually matched to the wrong client) goes back
  // to the unmatched queue so it can be matched again.
  if (receipt.mpesaCollection) {
    await MpesaCollection.updateOne(
      { _id: receipt.mpesaCollection, business },
      { $set: { matchingStatus: "unmatched", "metadata.clientReceiptId": "", "metadata.clientReceiptNumber": "", "metadata.clientId": "", "metadata.matchedModule": "" } }
    ).catch(() => {});
  }
  refreshBalances(business, [...affectedAccounts]);
  return ClientReceipt.findById(receipt._id).lean();
};
