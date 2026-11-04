// Credit / debit notes on posted client invoices. A note, its GL journal, the revenue-schedule
// adjustment and the invoice's running note totals commit in one transaction.
import mongoose from "mongoose";
import ClientInvoice from "../models/ClientInvoice.js";
import ClientCreditNote from "../models/ClientCreditNote.js";
import ClientRevenueSchedule from "../models/ClientRevenueSchedule.js";
import CompanySettings from "../../../models/CompanySettings.js";
import { round2 } from "../../../utils/math.js";
import { createError } from "../../../utils/error.js";
import { nextCreditNoteNumber, nextDebitNoteNumber } from "./clientSequenceService.js";
import { postClientNoteLedger, reverseClientLedgerEntries, refreshClientLedgerBalances, validateIncomeAccount } from "./clientAccountingService.js";
import { reduceScheduleForCredit, restoreScheduleAfterCreditReversal } from "./clientRevenueService.js";
import { computeClientInvoiceOutstanding, deriveClientInvoiceStatus } from "./clientInvoiceBalanceService.js";
import { getClientTaxContext, resolveClientLineTax } from "./clientTaxService.js";
import { DEFERRED_RECOGNITION_METHODS } from "./clientLineMath.js";
import { queueEtimsSubmission } from "./clientInvoicePostingService.js";
import { buildLateInterestDebitNotePayloads, markLateInterestCharged } from "./lateInterestService.js";

const NOTEABLE_STATUSES = ["posted", "sent", "partial", "partially_paid", "paid", "overdue", "credited"];

const taxOn = (net, line) => (line.taxType === "vat" && Number(line.taxRate) > 0 ? round2((net * Number(line.taxRate)) / 100) : 0);

// Already-credited net/tax per invoice line, from live credit notes.
const creditedByLine = (notes) => {
  const map = new Map();
  for (const note of notes) {
    if (note.status !== "posted" || note.noteType !== "CREDIT_NOTE") continue;
    for (const l of note.lines || []) {
      // Keyed by line position: lines are frozen once posted, and pre-tax-code invoice lines have no
      // persisted _id to key on.
      const key = `idx:${l.invoiceLineIndex}`;
      const cur = map.get(key) || { net: 0, tax: 0 };
      cur.net = round2(cur.net + Number(l.netAmount || 0));
      cur.tax = round2(cur.tax + Number(l.taxAmount || 0));
      map.set(key, cur);
    }
  }
  return map;
};

const findInvoiceLine = (invoice, input) => {
  const lines = invoice.lineItems || [];
  if (input.invoiceLineId) {
    const idx = lines.findIndex((l) => String(l._id) === String(input.invoiceLineId));
    if (idx >= 0) return { line: lines[idx], index: idx };
  }
  const index = Number(input.invoiceLineIndex);
  if (Number.isInteger(index) && index >= 0 && index < lines.length) return { line: lines[index], index };
  return null;
};

// Pre-tax-code invoices have no per-line tax snapshot: rebuild it from the flat rate.
const lineTax = (invoice, line) => (invoice.taxCalculation === "line"
  ? { taxCodeKey: line.taxCodeKey, taxType: line.taxType, taxRate: Number(line.taxRate || 0), taxAmount: Number(line.taxAmount || 0) }
  : {
      taxCodeKey: line.taxable && invoice.vatRate > 0 ? "vat_standard" : "no_tax",
      taxType: line.taxable && invoice.vatRate > 0 ? "vat" : "none",
      taxRate: line.taxable ? Number(invoice.vatRate || 0) : 0,
      taxAmount: line.taxable ? round2((Number(line.amount || 0) * Number(invoice.vatRate || 0)) / 100) : 0,
    });

const buildCreditLines = ({ invoice, inputLines, full, existingNotes }) => {
  const credited = creditedByLine(existingNotes);
  const lines = invoice.lineItems || [];
  const targets = full
    ? lines.map((line, index) => ({ line, index, input: {} }))
    : (inputLines || []).map((input) => {
        const found = findInvoiceLine(invoice, input);
        if (!found) throw createError(400, "Each credit note line must reference an invoice line (invoiceLineId or invoiceLineIndex)");
        return { ...found, input };
      });

  const result = [];
  for (const { line, index, input } of targets) {
    const tax = lineTax(invoice, line);
    const already = credited.get(`idx:${index}`) || { net: 0, tax: 0 };
    const remainingNet = round2(Number(line.amount || 0) - already.net);
    const remainingTax = round2(tax.taxAmount - already.tax);
    if (remainingNet <= 0) {
      if (full) continue;
      throw createError(400, `Invoice line "${line.description}" is already fully credited`);
    }
    const requested = full || input.amount === undefined || input.amount === null || input.amount === ""
      ? remainingNet
      : round2(Number(input.amount));
    if (!(requested > 0)) throw createError(400, "Credit amount must be greater than zero");
    if (requested > remainingNet + 0.005) {
      throw createError(400, `Cannot credit ${requested} on "${line.description}" — only ${remainingNet} (net of VAT) is left to credit`);
    }
    // Crediting the whole remainder takes the remaining tax exactly, so a full credit nets to zero.
    const net = round2(Math.min(requested, remainingNet));
    const taxAmount = Math.abs(net - remainingNet) < 0.005 ? remainingTax : taxOn(net, tax);
    result.push({
      invoiceLineId: line._id || null,
      invoiceLineIndex: index,
      description: String(input.description || line.description || "").trim(),
      quantity: Number(input.quantity ?? 1),
      unitPrice: net,
      netAmount: net,
      taxCodeKey: tax.taxCodeKey,
      taxType: tax.taxType,
      taxRate: tax.taxRate,
      taxAmount,
      totalAmount: round2(net + taxAmount),
      incomeAccount: line.incomeAccount || null,
      _deferred: DEFERRED_RECOGNITION_METHODS.has(line.revenueRecognition),
    });
  }
  if (!result.length) throw createError(400, "Nothing left to credit on this invoice");
  return result;
};

const buildDebitLines = async ({ invoice, inputLines }) => {
  if (!Array.isArray(inputLines) || !inputLines.length) throw createError(400, "A debit note needs at least one line");
  const ctx = await getClientTaxContext(invoice.business);
  const result = [];
  for (const input of inputLines) {
    const ref = findInvoiceLine(invoice, input);
    const net = round2(Number(input.amount || 0));
    if (!(net > 0)) throw createError(400, "Debit note line amount must be greater than zero");
    const description = String(input.description || ref?.line?.description || "").trim();
    if (!description) throw createError(400, "Debit note lines need a description");
    const tax = resolveClientLineTax(ctx, input.taxCodeKey || (ref ? lineTax(invoice, ref.line).taxCodeKey : null));
    const incomeAccount = input.incomeAccount
      ? (await validateIncomeAccount(invoice.business, input.incomeAccount))._id
      : ref?.line?.incomeAccount || null;
    const taxAmount = taxOn(net, tax);
    result.push({
      invoiceLineId: ref?.line?._id || null,
      invoiceLineIndex: ref ? ref.index : null,
      description,
      quantity: 1,
      unitPrice: net,
      netAmount: net,
      taxCodeKey: tax.taxCodeKey,
      taxType: tax.taxType,
      taxRate: tax.taxRate,
      taxAmount,
      totalAmount: round2(net + taxAmount),
      incomeAccount,
    });
  }
  return result;
};

export const createClientNote = async ({ business, invoiceId, noteType, lines: inputLines, full = false, reason = "", noteDate = null, userId }) => {
  const type = String(noteType || "").toUpperCase();
  if (!["CREDIT_NOTE", "DEBIT_NOTE"].includes(type)) throw createError(400, "noteType must be CREDIT_NOTE or DEBIT_NOTE");
  if (!String(reason || "").trim()) throw createError(400, "A reason is required for a credit or debit note");

  const invoice = await ClientInvoice.findOne({ _id: invoiceId, business });
  if (!invoice) throw createError(404, "Invoice not found");
  if (!NOTEABLE_STATUSES.includes(invoice.status)) {
    throw createError(400, `Notes can only be raised on posted invoices (this one is ${invoice.status})`);
  }

  const existingNotes = await ClientCreditNote.find({ business, invoice: invoice._id, status: "posted" }).lean();
  const isCredit = type === "CREDIT_NOTE";
  const lines = isCredit
    ? buildCreditLines({ invoice, inputLines, full: Boolean(full), existingNotes })
    : await buildDebitLines({ invoice, inputLines });

  const total = round2(lines.reduce((s, l) => s + l.totalAmount, 0));
  if (isCredit) {
    const outstanding = computeClientInvoiceOutstanding(invoice.toObject(), existingNotes);
    if (total > outstanding + 0.01) {
      throw createError(400, `Credit (${total}) exceeds what is still owed on the invoice (${outstanding}). Reverse or reallocate the receipt first, then credit.`);
    }
  }

  const settings = await CompanySettings.findOne({ company: business }).select("clientBilling").lean();
  const noteNumber = isCredit
    ? await nextCreditNoteNumber(business, settings?.clientBilling?.creditNotePrefix)
    : await nextDebitNoteNumber(business, settings?.clientBilling?.debitNotePrefix);

  const session = await mongoose.startSession();
  let note;
  let entries = [];
  try {
    await session.withTransaction(async () => {
      const noteLines = [];
      for (const line of lines) {
        const { _deferred, ...stored } = line;
        if (isCredit && _deferred && line.invoiceLineId) {
          const schedule = await ClientRevenueSchedule.findOne({ business, invoice: invoice._id, invoiceLineId: line.invoiceLineId }).session(session);
          if (schedule) {
            const { deferredPortion, reductions } = await reduceScheduleForCredit({ schedule, amount: line.netAmount, session });
            stored.deferredPortion = deferredPortion;
            stored.deferredReductions = reductions;
            stored.revenueSchedule = schedule._id;
          }
        }
        noteLines.push(stored);
      }

      [note] = await ClientCreditNote.create([{
        business,
        client: invoice.client,
        invoice: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
        contract: invoice.contract || null,
        noteType: type,
        noteNumber,
        noteDate: noteDate ? new Date(noteDate) : new Date(),
        reason: String(reason).trim(),
        isFullCredit: Boolean(full) && isCredit,
        lines: noteLines,
        subtotal: round2(noteLines.reduce((s, l) => s + l.netAmount, 0)),
        taxAmount: round2(noteLines.reduce((s, l) => s + l.taxAmount, 0)),
        total,
        currency: invoice.currency || "KES",
        createdBy: userId || null,
      }], { session });

      const posting = await postClientNoteLedger({ note, userId, session });
      entries = posting.entries;
      note.journalGroupId = posting.journalGroupId;
      note.ledgerEntries = entries.map((e) => e._id);
      await note.save({ session });

      const fresh = await ClientInvoice.findById(invoice._id).session(session);
      if (isCredit) fresh.creditedAmount = round2(Number(fresh.creditedAmount || 0) + total);
      else fresh.debitedAmount = round2(Number(fresh.debitedAmount || 0) + total);
      fresh.status = deriveClientInvoiceStatus(fresh);
      await fresh.save({ session });
    });
  } finally {
    await session.endSession();
  }

  await refreshClientLedgerBalances(business, entries);
  if (isCredit) queueEtimsSubmission({ business, noteId: note._id });
  const updatedInvoice = await ClientInvoice.findById(invoice._id).lean();
  return { note, invoice: updatedInvoice };
};

export const reverseClientNote = async ({ business, noteId, reason = "", userId }) => {
  const note = await ClientCreditNote.findOne({ _id: noteId, business });
  if (!note) throw createError(404, "Note not found");
  if (note.status === "reversed") throw createError(400, "Note is already reversed");
  if (!String(reason || "").trim()) throw createError(400, "A reason is required to reverse a note");

  const invoice = await ClientInvoice.findOne({ _id: note.invoice, business });
  if (!invoice) throw createError(404, "Invoice not found");
  if (note.noteType === "DEBIT_NOTE") {
    // Taking a debit away must not leave the client having paid more than they owe.
    const after = computeClientInvoiceOutstanding({ ...invoice.toObject(), debitedAmount: Number(invoice.debitedAmount || 0) - note.total });
    if (after < -0.01) throw createError(400, "Receipts already cover this debit note — reverse or reallocate the receipt first");
  }

  const session = await mongoose.startSession();
  let reversals = [];
  try {
    await session.withTransaction(async () => {
      reversals = await reverseClientLedgerEntries({ business, entryIds: note.ledgerEntries, reason: `${note.noteNumber} reversed: ${reason}`, userId, session });
      for (const line of note.lines || []) {
        if (line.revenueSchedule && line.deferredPortion > 0) {
          await restoreScheduleAfterCreditReversal({ scheduleId: line.revenueSchedule, deferredPortion: line.deferredPortion, reductions: line.deferredReductions, session });
        }
      }
      note.status = "reversed";
      note.reversedAt = new Date();
      note.reversedBy = userId || null;
      note.reversalReason = String(reason).trim();
      await note.save({ session });

      const fresh = await ClientInvoice.findById(invoice._id).session(session);
      if (note.noteType === "CREDIT_NOTE") fresh.creditedAmount = round2(Math.max(0, Number(fresh.creditedAmount || 0) - note.total));
      else fresh.debitedAmount = round2(Math.max(0, Number(fresh.debitedAmount || 0) - note.total));
      fresh.status = deriveClientInvoiceStatus(fresh);
      await fresh.save({ session });
    });
  } finally {
    await session.endSession();
  }
  await refreshClientLedgerBalances(business, reversals);
  return { note, invoice: await ClientInvoice.findById(invoice._id).lean() };
};

// Raises the late-payment interest debit notes computed by lateInterestService (exempt supply),
// then records how far interest has been charged so the next run starts from there.
export const raiseLateInterestDebitNotes = async ({ business, asOf = new Date(), clientId = null, userId = null }) => {
  const payloads = await buildLateInterestDebitNotePayloads({ business, asOf, clientId });
  const raised = [];
  const failures = [];
  for (const p of payloads) {
    try {
      const { note } = await createClientNote({
        business,
        invoiceId: p.invoice,
        noteType: "DEBIT_NOTE",
        reason: "Late payment interest",
        noteDate: p.issueDate || asOf,
        lines: p.lineItems.map((l) => ({ description: l.description, amount: round2(Number(l.unitPrice || 0) * Number(l.quantity || 1)), taxCodeKey: "vat_exempt" })),
        userId,
      });
      await markLateInterestCharged({ business, invoiceId: p.invoice, through: p.interestThrough || asOf });
      raised.push({ noteId: note._id, noteNumber: note.noteNumber, invoice: p.invoice, total: note.total });
    } catch (error) {
      failures.push({ invoice: p.invoice, message: error.message });
    }
  }
  return { raised, failures, total: round2(raised.reduce((s, r) => s + r.total, 0)) };
};
