// Turning a draft client invoice into a posted one: GL journal, revenue schedules for deferred lines
// and the status change commit in ONE Mongo transaction — a failure anywhere leaves the invoice a
// draft with nothing on the ledger, rather than a "posted" invoice with half a journal.
import mongoose from "mongoose";
import ClientInvoice from "../models/ClientInvoice.js";
import { round2 } from "../../../utils/math.js";
import { createError } from "../../../utils/error.js";
import { postClientInvoiceLedger, refreshClientLedgerBalances, validateIncomeAccount } from "./clientAccountingService.js";
import { createRevenueSchedulesForInvoice } from "./clientRevenueService.js";
import { applyClientTaxToLines } from "./clientTaxService.js";
import { DEFERRED_RECOGNITION_METHODS, REVENUE_RECOGNITION_METHODS, toUTCDate } from "./clientLineMath.js";
import { submitCreditNote, submitInvoice } from "./etimsService.js";

// KRA eTIMS submission after a document is on the ledger. Fire-and-forget: eTIMS outages are
// retried by the eTIMS retry cron, so a failure here must never undo or fail the posting.
export const queueEtimsSubmission = ({ business, invoiceId = null, noteId = null }) => {
  const task = invoiceId ? () => submitInvoice({ business, invoiceId }) : () => submitCreditNote({ business, noteId });
  Promise.resolve()
    .then(task)
    .catch((error) => console.error("[clients] eTIMS submission failed (will retry):", error?.message || error));
};

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const dateOrNull = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

// Normalises invoice line input (new per-line shape and the legacy {description, quantity, unitPrice,
// taxable} shape) and stamps each line with its resolved tax code.
export const buildInvoiceLines = async ({ business, items = [], taxCtx, legacyVatRate }) => {
  if (!Array.isArray(items)) return [];
  const cleaned = items
    .filter((item) => item && String(item.description || item.itemName || "").trim())
    .map((item) => ({
      itemName: String(item.itemName || "").trim(),
      description: String(item.description || item.itemName || "").trim(),
      quantity: Math.max(0, num(item.quantity, 1)),
      unitPrice: Math.max(0, num(item.unitPrice, 0)),
      discountPercent: Math.min(100, Math.max(0, num(item.discountPercent, 0))),
      prorationFactor: Math.max(0, num(item.prorationFactor, 1)),
      taxable: item.taxable !== false,
      taxCodeKey: item.taxCodeKey ? String(item.taxCodeKey).trim() : null,
      servicePeriodStart: dateOrNull(item.servicePeriodStart),
      servicePeriodEnd: dateOrNull(item.servicePeriodEnd),
      revenueRecognition: REVENUE_RECOGNITION_METHODS.includes(item.revenueRecognition) ? item.revenueRecognition : "on_invoice",
      incomeAccount: item.incomeAccount || null,
      contract: item.contract || null,
      contractLineKey: item.contractLineKey || null,
      scheduleRow: item.scheduleRow || null,
      scheduleKey: item.scheduleKey || null,
    }));

  for (const line of cleaned) {
    if (line.incomeAccount) line.incomeAccount = (await validateIncomeAccount(business, line.incomeAccount))._id;
    if (DEFERRED_RECOGNITION_METHODS.has(line.revenueRecognition) && line.revenueRecognition === "straight_line"
      && (!line.servicePeriodStart || !line.servicePeriodEnd || toUTCDate(line.servicePeriodEnd) < toUTCDate(line.servicePeriodStart))) {
      throw createError(400, `Line "${line.description}" is recognised straight-line and needs a valid service period`);
    }
  }
  return applyClientTaxToLines(taxCtx, cleaned, { vatRate: legacyVatRate });
};

const restoreDraftState = (invoice, before) => {
  invoice.status = before.status;
  invoice.ledgerEntries = before.ledgerEntries;
  invoice.journalGroupId = before.journalGroupId;
  invoice.deferredAmount = before.deferredAmount;
  invoice.postedAt = before.postedAt;
  invoice.postedBy = before.postedBy;
  invoice.sentAt = before.sentAt;
  invoice.$locals.originalStatus = before.status;
};

// targetStatus: "posted" (on the ledger, not yet sent) or "sent" (legacy send flow).
export const postClientInvoice = async ({ invoice, userId, targetStatus = "posted", sentAt = null }) => {
  if (!(invoice instanceof ClientInvoice)) throw createError(500, "postClientInvoice needs a hydrated invoice document");
  if (invoice.status !== "draft") throw createError(400, `Invoice is already ${invoice.status}`);
  if (!invoice.lineItems?.length || !(Number(invoice.total) > 0)) throw createError(400, "Invoice has no billable amount");

  const before = {
    status: invoice.status,
    ledgerEntries: [...(invoice.ledgerEntries || [])],
    journalGroupId: invoice.journalGroupId,
    deferredAmount: invoice.deferredAmount,
    postedAt: invoice.postedAt,
    postedBy: invoice.postedBy,
    sentAt: invoice.sentAt,
  };

  const session = await mongoose.startSession();
  let entries = [];
  try {
    await session.withTransaction(async () => {
      restoreDraftState(invoice, before);
      entries = await postClientInvoiceLedger({ invoice, userId, session });
      invoice.ledgerEntries = entries.map((e) => e._id);
      invoice.journalGroupId = entries[0]?.journalGroupId || null;
      invoice.deferredAmount = round2((invoice.lineItems || [])
        .filter((l) => DEFERRED_RECOGNITION_METHODS.has(l.revenueRecognition))
        .reduce((s, l) => s + Number(l.amount || 0), 0));
      invoice.status = targetStatus;
      invoice.postedAt = new Date();
      invoice.postedBy = userId || null;
      if (targetStatus === "sent") invoice.sentAt = sentAt || new Date();
      await invoice.save({ session });
      await createRevenueSchedulesForInvoice({ invoice, session });
    });
  } catch (error) {
    restoreDraftState(invoice, before);
    throw error;
  } finally {
    await session.endSession();
  }

  await refreshClientLedgerBalances(invoice.business, entries);
  queueEtimsSubmission({ business: invoice.business, invoiceId: invoice._id });
  return { invoice, entries };
};
