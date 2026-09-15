/**
 * GL accounting service for the Client Management module.
 *
 * Mirrors the pattern already established across every other revenue-producing
 * module (PMS, Car Wash, Inventory/POS): every financial event posts a balanced
 * double-entry pair (or triple, when VAT applies), guarded against double-posting,
 * with a try/catch + postReversal rollback if a later leg in the same group fails
 * partway through — the same defensive shape used for landlord receipts, payment
 * vouchers, and journal entries, since this is real customer money too.
 *
 * Accounts used (registered in services/chartOfAccountsService.js):
 *   1260 — Client Receivables      (asset)    debit side on invoice, credit side on payment
 *   4520 — Client Service Income   (income)   net of VAT
 *   2190 — VAT Payable — Output Tax(liability) shared account, same one POS uses
 *   11xx — whichever cashbook the payment was received into (debit side on payment)
 */

import mongoose from "mongoose";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import { postEntry, postReversal } from "../../../services/ledgerPostingService.js";
import { findSystemAccountByCode } from "../../../services/chartOfAccountsService.js";
import { round2 } from "../../../utils/math.js";

const dayRange = (value = new Date()) => {
  const d = value ? new Date(value) : new Date();
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  const start = new Date(safe);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

const resolveClientReceivableAccount = (businessId) => findSystemAccountByCode(businessId, "1260");
const resolveClientIncomeAccount     = (businessId) => findSystemAccountByCode(businessId, "4520");
const resolveOutputVatAccount        = (businessId) => findSystemAccountByCode(businessId, "2190");

// ─── Client Invoice — Dr Client Receivables (gross) / Cr Service Income (net) ──
//                                            Cr VAT Payable (if any)          ──
export const postClientInvoiceLedger = async ({ invoice, userId }) => {
  const total = round2(Number(invoice.total || 0));
  if (total <= 0) return [];

  const existing = await FinancialLedgerEntry.countDocuments({
    business: invoice.business,
    sourceTransactionType: "client_invoice",
    sourceTransactionId: String(invoice._id),
    status: { $ne: "reversed" },
  });
  if (existing > 0) return [];

  const subtotal  = round2(Number(invoice.subtotal || 0));
  const vatAmount = round2(Number(invoice.vatAmount || 0));
  const { start, end } = dayRange(invoice.issueDate);
  const journalGroupId = new mongoose.Types.ObjectId();

  const [receivableAccount, incomeAccount, vatAccount] = await Promise.all([
    resolveClientReceivableAccount(invoice.business),
    resolveClientIncomeAccount(invoice.business),
    vatAmount > 0 ? resolveOutputVatAccount(invoice.business) : Promise.resolve(null),
  ]);

  if (!receivableAccount?._id || !incomeAccount?._id) {
    throw new Error("Client Management chart-of-accounts entries are not available for this business — is the Client Management module enabled?");
  }

  const base = {
    business: invoice.business,
    sourceTransactionType: "client_invoice",
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

  let debitLeg;
  try {
    debitLeg = await postEntry({
      ...base,
      accountId: receivableAccount._id,
      direction: "debit",
      amount: total,
      notes: `Client invoice ${invoice.invoiceNumber} — receivable`,
      metadata: { postingRole: "client_receivable", invoiceNumber: invoice.invoiceNumber },
    });

    const entries = [debitLeg];

    const creditLeg = await postEntry({
      ...base,
      accountId: incomeAccount._id,
      direction: "credit",
      amount: subtotal,
      notes: `Client invoice ${invoice.invoiceNumber} — service income`,
      metadata: {
        postingRole: "client_service_income",
        offsetOfEntryId: String(debitLeg._id),
        invoiceNumber: invoice.invoiceNumber,
      },
    });
    entries.push(creditLeg);

    if (vatAmount > 0 && vatAccount?._id) {
      const taxLeg = await postEntry({
        ...base,
        accountId: vatAccount._id,
        direction: "credit",
        amount: vatAmount,
        notes: `Client invoice ${invoice.invoiceNumber} — output VAT`,
        metadata: {
          postingRole: "client_output_vat",
          offsetOfEntryId: String(debitLeg._id),
          invoiceNumber: invoice.invoiceNumber,
        },
      });
      entries.push(taxLeg);
    }

    return entries;
  } catch (error) {
    if (debitLeg?._id) {
      await postReversal({
        entryId: debitLeg._id,
        reason: `Auto-reversal: GL balance protection for client invoice ${invoice.invoiceNumber}`,
        userId,
      }).catch(() => null);
    }
    throw error;
  }
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
