// The single definition of "how much does the client still owe on this invoice". Receipts, the
// statement, dunning and the PDF should all read it from here so a credit-noted invoice can never be
// over-receipted or shown as owing.
//
//   outstanding = total - paidAmount - credit notes + debit notes
//
// invoice.paidAmount stays the field receipts update. Note totals come from the posted notes when
// they are passed in (authoritative), otherwise from the invoice's cached creditedAmount /
// debitedAmount, which note posting/reversal keep in step.
import { round2 } from "../../../utils/math.js";

const LIVE_NOTE_STATUSES = new Set(["posted"]);

export const sumNotes = (notes = []) => {
  let credits = 0;
  let debits = 0;
  for (const note of notes || []) {
    if (!note || !LIVE_NOTE_STATUSES.has(note.status)) continue;
    if (note.noteType === "DEBIT_NOTE") debits += Number(note.total || 0);
    else credits += Number(note.total || 0);
  }
  return { credits: round2(credits), debits: round2(debits) };
};

export const computeClientInvoiceOutstanding = (invoice = {}, notes = null) => {
  if (!invoice || ["draft", "cancelled"].includes(invoice.status)) return 0;
  const { credits, debits } = Array.isArray(notes)
    ? sumNotes(notes)
    : { credits: Number(invoice.creditedAmount || 0), debits: Number(invoice.debitedAmount || 0) };
  return round2(Number(invoice.total || 0) - Number(invoice.paidAmount || 0) - credits + debits);
};

// Status implied by the numbers, for everything except draft/cancelled (which are explicit).
export const deriveClientInvoiceStatus = (invoice = {}, { now = new Date() } = {}) => {
  if (["draft", "cancelled"].includes(invoice.status)) return invoice.status;
  const credited = Number(invoice.creditedAmount || 0);
  const debited = Number(invoice.debitedAmount || 0);
  const paid = Number(invoice.paidAmount || 0);
  const owed = round2(Number(invoice.total || 0) + debited - credited);
  const outstanding = round2(owed - paid);

  if (outstanding <= 0.005) {
    if (paid <= 0.005 && credited > 0) return "credited";
    return "paid";
  }
  if (paid > 0.005) return invoice.dueDate && new Date(invoice.dueDate) < now ? "overdue" : "partial";
  if (invoice.dueDate && new Date(invoice.dueDate) < now) return "overdue";
  return invoice.sentAt ? "sent" : "posted";
};

// Aggregation-pipeline form of the outstanding formula, for $expr guards / reports:
//   { $expr: { $gt: [clientInvoiceOutstandingExpr(), 0] } }
export const clientInvoiceOutstandingExpr = (prefix = "$") => ({
  $round: [{
    $subtract: [
      { $add: [{ $ifNull: [`${prefix}total`, 0] }, { $ifNull: [`${prefix}debitedAmount`, 0] }] },
      { $add: [{ $ifNull: [`${prefix}paidAmount`, 0] }, { $ifNull: [`${prefix}creditedAmount`, 0] }] },
    ],
  }, 2],
});
