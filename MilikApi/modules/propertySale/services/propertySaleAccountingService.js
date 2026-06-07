/**
 * Self-contained GL accounting service for the Property Sales module.
 *
 * Accounts used:
 *   1311 — Property Sale Receipts Control   (asset)    debit side for payments received
 *   2180 — Agent Commission Payable          (liability) accrued commission owed to agents
 *   4410 — Property Sale Revenue             (income)   credit side for payments received
 *   5320 — Property Sale Commission Expense  (expense)  debit side for commission accrual
 */

import mongoose from "mongoose";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import { postEntry, postReversal } from "../../../services/ledgerPostingService.js";

const PS_ACCOUNT_TEMPLATES = {
  "1311": { name: "Property Sale Receipts Control",   type: "asset",     group: "assets",      subGroup: "Current Assets" },
  "2180": { name: "Agent Commission Payable",          type: "liability", group: "liabilities", subGroup: "Agent Payables" },
  "4410": { name: "Property Sale Revenue",             type: "income",    group: "income",      subGroup: "Property Sales" },
  "5320": { name: "Property Sale Commission Expense",  type: "expense",   group: "expenses",    subGroup: "Sales Commissions" },
};

const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;

const dayRange = (value = new Date()) => {
  const d = value ? new Date(value) : new Date();
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  const start = new Date(safe);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

// ─── Account resolution ───────────────────────────────────────────────────────

const resolvePSAccount = async (businessId, code) => {
  const tpl = PS_ACCOUNT_TEMPLATES[code];
  if (!tpl) throw new Error(`resolvePSAccount: unknown code "${code}"`);
  return ChartOfAccount.findOneAndUpdate(
    { business: businessId, code },
    {
      $setOnInsert: {
        business: businessId,
        code,
        name: tpl.name,
        type: tpl.type,
        group: tpl.group,
        subGroup: tpl.subGroup,
        isSystem: true,
        isPosting: true,
        isHeader: false,
        level: 0,
        balance: 0,
        moduleScopes: ["propertySale"],
      },
    },
    { upsert: true, new: true }
  );
};

// ─── Payment received — Dr Receipts / Cr Sale Revenue ────────────────────────

/**
 * Posts when a sale payment is created with status="paid".
 *   Dr 1311 Property Sale Receipts / Cr 4410 Property Sale Revenue
 */
export const postPropertySalePaymentLedger = async ({ businessId, payment, userId }) => {
  const amount = round2(Number(payment.amount || 0));
  if (amount <= 0) return;

  const existing = await FinancialLedgerEntry.countDocuments({
    business: businessId,
    sourceTransactionType: "property_sale_payment",
    sourceTransactionId: String(payment._id),
    status: { $ne: "reversed" },
  });
  if (existing > 0) return;

  const { start, end } = dayRange(payment.paymentDate || payment.createdAt);
  const journalGroupId = new mongoose.Types.ObjectId();

  const [receiptsAcc, revenueAcc] = await Promise.all([
    resolvePSAccount(businessId, "1311"),
    resolvePSAccount(businessId, "4410"),
  ]);

  const typeLabel = payment.paymentType ? payment.paymentType.replace(/_/g, " ") : "payment";
  const ref = payment.paymentNumber || String(payment._id);

  const base = {
    business: businessId,
    sourceTransactionType: "property_sale_payment",
    sourceTransactionId: String(payment._id),
    transactionDate: payment.paymentDate || payment.createdAt || new Date(),
    statementPeriodStart: start,
    statementPeriodEnd: end,
    journalGroupId,
    category: "PROPERTY_SALE_PAYMENT",
    createdBy: userId,
    allowUnscoped: true,
  };

  await Promise.all([
    postEntry({ ...base, accountId: receiptsAcc._id, direction: "debit",  amount, notes: `Property sale ${typeLabel} received — ${ref}` }),
    postEntry({ ...base, accountId: revenueAcc._id,  direction: "credit", amount, notes: `Property sale ${typeLabel} revenue — ${ref}` }),
  ]);
};

// ─── Payment void — reverse GL entries ───────────────────────────────────────

export const reversePropertySalePaymentLedger = async ({ businessId, payment, userId }) => {
  const entries = await FinancialLedgerEntry.find({
    business: businessId,
    sourceTransactionType: "property_sale_payment",
    sourceTransactionId: String(payment._id),
    status: { $nin: ["reversed", "void"] },
  }).lean();

  if (!entries.length) return;

  const reason = `Void of property sale payment ${payment.paymentNumber || payment._id}`;
  for (const entry of entries) {
    await postReversal({ entryId: entry._id, reason, userId });
  }
};

// ─── Commission accrual — Dr Commission Expense / Cr Commission Payable ───────

/**
 * Posted when deal closes and a pending commission becomes approved.
 *   Dr 5320 Commission Expense / Cr 2180 Agent Commission Payable
 */
export const postPropertySaleCommissionAccrual = async ({ businessId, commission, userId }) => {
  const amount = round2(Number(commission.commissionAmount || 0));
  if (amount <= 0) return;

  const existing = await FinancialLedgerEntry.countDocuments({
    business: businessId,
    sourceTransactionType: "property_sale_commission",
    sourceTransactionId: String(commission._id),
    status: { $ne: "reversed" },
  });
  if (existing > 0) return;

  const { start, end } = dayRange(commission.createdAt);
  const journalGroupId = new mongoose.Types.ObjectId();

  const [expenseAcc, payableAcc] = await Promise.all([
    resolvePSAccount(businessId, "5320"),
    resolvePSAccount(businessId, "2180"),
  ]);

  const ref = commission.commissionNumber || String(commission._id);

  const base = {
    business: businessId,
    sourceTransactionType: "property_sale_commission",
    sourceTransactionId: String(commission._id),
    transactionDate: new Date(),
    statementPeriodStart: start,
    statementPeriodEnd: end,
    journalGroupId,
    category: "PROPERTY_SALE_COMMISSION_ACCRUAL",
    createdBy: userId,
    allowUnscoped: true,
  };

  await Promise.all([
    postEntry({ ...base, accountId: expenseAcc._id, direction: "debit",  amount, notes: `Agent commission accrued — ${ref}` }),
    postEntry({ ...base, accountId: payableAcc._id, direction: "credit", amount, notes: `Agent commission payable — ${ref}` }),
  ]);
};

// ─── Commission payout — Dr Commission Payable / Cr Receipts Control ─────────

/**
 * Posted when a commission status moves to "paid".
 * Handles two cases:
 *   - Normal: accrual already posted → just clears the payable
 *   - Skip-approval: posts accrual first, then payout, netting to Dr Expense / Cr Receipts
 */
export const postPropertySaleCommissionPayout = async ({ businessId, commission, userId }) => {
  const amount = round2(Number(commission.commissionAmount || 0));
  if (amount <= 0) return;

  // Ensure accrual exists (posts it if not)
  await postPropertySaleCommissionAccrual({ businessId, commission, userId });

  const existing = await FinancialLedgerEntry.countDocuments({
    business: businessId,
    sourceTransactionType: "property_sale_commission_payout",
    sourceTransactionId: String(commission._id),
    status: { $ne: "reversed" },
  });
  if (existing > 0) return;

  const { start, end } = dayRange(new Date());
  const journalGroupId = new mongoose.Types.ObjectId();

  const [payableAcc, receiptsAcc] = await Promise.all([
    resolvePSAccount(businessId, "2180"),
    resolvePSAccount(businessId, "1311"),
  ]);

  const ref = commission.commissionNumber || String(commission._id);

  const base = {
    business: businessId,
    sourceTransactionType: "property_sale_commission_payout",
    sourceTransactionId: String(commission._id),
    transactionDate: new Date(),
    statementPeriodStart: start,
    statementPeriodEnd: end,
    journalGroupId,
    category: "PROPERTY_SALE_COMMISSION_PAYOUT",
    createdBy: userId,
    allowUnscoped: true,
  };

  await Promise.all([
    postEntry({ ...base, accountId: payableAcc._id,  direction: "debit",  amount, notes: `Agent commission payout — ${ref}` }),
    postEntry({ ...base, accountId: receiptsAcc._id, direction: "credit", amount, notes: `Agent commission paid from receipts — ${ref}` }),
  ]);
};

// ─── Commission reversal — when cancelled after accrual ──────────────────────

export const reversePropertySaleCommissionAccrual = async ({ businessId, commission, userId, reason }) => {
  const entries = await FinancialLedgerEntry.find({
    business: businessId,
    sourceTransactionType: "property_sale_commission",
    sourceTransactionId: String(commission._id),
    status: { $nin: ["reversed", "void"] },
  }).lean();

  if (!entries.length) return;

  const msg = reason || `Commission cancelled — ${commission.commissionNumber || commission._id}`;
  for (const entry of entries) {
    await postReversal({ entryId: entry._id, reason: msg, userId });
  }
};
