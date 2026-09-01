/**
 * Self-contained GL accounting service for the Property Sales module.
 *
 * Accounts used:
 *   [cashbook]  — Actual bank/cash account chosen at payment time (Dr side for receipts)
 *   1311 — Property Sale Receipts Control   (asset)    fallback Dr when no cashbook provided
 *   2150 — Buyer Deposit Held               (liability) Dr/Cr for deposit staging; moves to 4410 on deal close
 *   2180 — Agent Commission Payable          (liability) accrued commission owed to agents
 *   4410 — Property Sale Revenue             (income)   credit side for non-deposit payments; recognised from 2150 at close
 *   4420 — Forfeited Deposit Income          (income)   Cr when a non-refundable deposit is retained on deal cancel
 *   5220 — Stamp Duty / Transfer Costs       (expense)  Dr when stamp duty is paid at deal close
 *   5320 — Property Sale Commission Expense  (expense)  debit side for commission accrual
 *   5321 — Agent Commission Disbursements    (liability) fallback Cr when no cashbook provided at payout
 */

import mongoose from "mongoose";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import { postEntry, postReversal } from "../../../services/ledgerPostingService.js";

const PS_ACCOUNT_TEMPLATES = {
  "1311": { name: "Property Sale Receipts Control",  type: "asset",     group: "assets",      subGroup: "Current Assets" },
  "2150": { name: "Buyer Deposit Held",              type: "liability", group: "liabilities", subGroup: "Buyer Deposits" },
  "2180": { name: "Agent Commission Payable",         type: "liability", group: "liabilities", subGroup: "Agent Payables" },
  "4410": { name: "Property Sale Revenue",            type: "income",    group: "income",      subGroup: "Property Sales" },
  "4420": { name: "Forfeited Deposit Income",         type: "income",    group: "income",      subGroup: "Property Sales" },
  "5220": { name: "Stamp Duty / Transfer Costs",      type: "expense",   group: "expenses",    subGroup: "Sale Costs" },
  "5320": { name: "Property Sale Commission Expense", type: "expense",   group: "expenses",    subGroup: "Sales Commissions" },
  "5321": { name: "Agent Commission Disbursements",   type: "liability", group: "liabilities", subGroup: "Agent Payables" },
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
//
// These are fixed system accounts (one per business+code) whose _id never
// changes once created, so the resolved id is cached in-process — closing a
// deal with N pending commissions/deposits otherwise re-upserts the same two
// or three ChartOfAccount docs N times.

const accountIdCache = new Map(); // `${businessId}:${code}` -> ObjectId

const resolvePSAccount = async (businessId, code) => {
  const cacheKey = `${businessId}:${code}`;
  const cachedId = accountIdCache.get(cacheKey);
  if (cachedId) return { _id: cachedId };

  const tpl = PS_ACCOUNT_TEMPLATES[code];
  if (!tpl) throw new Error(`resolvePSAccount: unknown code "${code}"`);
  const acc = await ChartOfAccount.findOneAndUpdate(
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
  accountIdCache.set(cacheKey, acc._id);
  return acc;
};

// ─── Payment received ─────────────────────────────────────────────────────────
//
// Deposits:  Dr Cashbook (or 1311) / Cr 2150 Buyer Deposit Held
// All other: Dr Cashbook (or 1311) / Cr 4410 Property Sale Revenue

export const postPropertySalePaymentLedger = async ({ businessId, payment, userId, cashbookAccountId }) => {
  const amount = round2(Number(payment.amount || 0));
  if (amount <= 0) return;

  const existing = await FinancialLedgerEntry.countDocuments({
    business: businessId,
    sourceTransactionType: "property_sale_payment",
    sourceTransactionId: String(payment._id),
    status: { $ne: "reversed" },
    category: { $ne: "REVERSAL" },
  });
  if (existing > 0) return;

  const isDeposit = payment.paymentType === "deposit";
  const { start, end } = dayRange(payment.paymentDate || payment.createdAt);
  const journalGroupId = new mongoose.Types.ObjectId();

  const [debitAcc, creditAcc] = await Promise.all([
    cashbookAccountId
      ? ChartOfAccount.findById(cashbookAccountId).lean()
      : resolvePSAccount(businessId, "1311"),
    resolvePSAccount(businessId, isDeposit ? "2150" : "4410"),
  ]);

  if (!debitAcc) throw new Error("Cashbook account not found — GL posting aborted");

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
    postEntry({ ...base, accountId: debitAcc._id,  direction: "debit",  amount, notes: `Property sale ${typeLabel} received — ${ref}` }),
    postEntry({ ...base, accountId: creditAcc._id, direction: "credit", amount, notes: isDeposit ? `Buyer deposit held — ${ref}` : `Property sale ${typeLabel} revenue — ${ref}` }),
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
  await Promise.all(entries.map((entry) => postReversal({ entryId: entry._id, reason, userId })));
};

// ─── Deposit transfer to revenue — called at deal close ───────────────────────
//
// Moves a deposit from Buyer Deposit Held (2150) to Property Sale Revenue (4410).
// Skips silently if the deposit was posted to 4410 directly (pre-fix legacy entries).
//   Dr 2150 Buyer Deposit Held / Cr 4410 Property Sale Revenue

export const transferDepositToRevenue = async ({ businessId, payment, userId }) => {
  const amount = round2(Number(payment.amount || 0));
  if (amount <= 0) return;

  // Verify this deposit was actually posted to 2150 (not old-style 4410)
  const depositHeldAcc = await resolvePSAccount(businessId, "2150");
  const depositHeldEntry = await FinancialLedgerEntry.findOne({
    business: businessId,
    sourceTransactionType: "property_sale_payment",
    sourceTransactionId: String(payment._id),
    accountId: depositHeldAcc._id,
    status: { $nin: ["reversed", "void"] },
  }).lean();
  if (!depositHeldEntry) return; // legacy entry posted directly to 4410 — skip

  const existing = await FinancialLedgerEntry.countDocuments({
    business: businessId,
    sourceTransactionType: "property_sale_deposit_transfer",
    sourceTransactionId: String(payment._id),
    status: { $ne: "reversed" },
  });
  if (existing > 0) return;

  const revenueAcc = await resolvePSAccount(businessId, "4410");

  const { start, end } = dayRange(new Date());
  const journalGroupId = new mongoose.Types.ObjectId();
  const ref = payment.paymentNumber || String(payment._id);

  const base = {
    business: businessId,
    sourceTransactionType: "property_sale_deposit_transfer",
    sourceTransactionId: String(payment._id),
    transactionDate: new Date(),
    statementPeriodStart: start,
    statementPeriodEnd: end,
    journalGroupId,
    category: "PROPERTY_SALE_DEPOSIT_TRANSFER",
    createdBy: userId,
    allowUnscoped: true,
  };

  await Promise.all([
    postEntry({ ...base, accountId: depositHeldAcc._id, direction: "debit",  amount, notes: `Deposit released to revenue on deal close — ${ref}` }),
    postEntry({ ...base, accountId: revenueAcc._id,     direction: "credit", amount, notes: `Property sale revenue recognised from deposit — ${ref}` }),
  ]);
};

// ─── Deposit forfeiture — called when non-refundable deposit is retained ──────
//
// Converts held deposit to forfeited income on deal cancellation.
//   Dr 2150 Buyer Deposit Held / Cr 4420 Forfeited Deposit Income

export const forfeitDepositIncome = async ({ businessId, payment, userId, reason }) => {
  const amount = round2(Number(payment.amount || 0));
  if (amount <= 0) return;

  // Only forfeit if the deposit was actually posted to 2150
  const depositHeldAcc = await resolvePSAccount(businessId, "2150");
  const depositHeldEntry = await FinancialLedgerEntry.findOne({
    business: businessId,
    sourceTransactionType: "property_sale_payment",
    sourceTransactionId: String(payment._id),
    accountId: depositHeldAcc._id,
    status: { $nin: ["reversed", "void"] },
  }).lean();
  if (!depositHeldEntry) return; // nothing posted to 2150 — skip

  const [existing, forfeitAcc] = await Promise.all([
    FinancialLedgerEntry.countDocuments({
      business: businessId,
      sourceTransactionType: "property_sale_deposit_forfeit",
      sourceTransactionId: String(payment._id),
      status: { $ne: "reversed" },
    }),
    resolvePSAccount(businessId, "4420"),
  ]);
  if (existing > 0) return;

  const { start, end } = dayRange(new Date());
  const journalGroupId = new mongoose.Types.ObjectId();
  const ref = payment.paymentNumber || String(payment._id);
  const msg = reason || `Deposit forfeited on deal cancellation — ${ref}`;

  const base = {
    business: businessId,
    sourceTransactionType: "property_sale_deposit_forfeit",
    sourceTransactionId: String(payment._id),
    transactionDate: new Date(),
    statementPeriodStart: start,
    statementPeriodEnd: end,
    journalGroupId,
    category: "PROPERTY_SALE_DEPOSIT_FORFEIT",
    createdBy: userId,
    allowUnscoped: true,
  };

  await Promise.all([
    postEntry({ ...base, accountId: depositHeldAcc._id, direction: "debit",  amount, notes: msg }),
    postEntry({ ...base, accountId: forfeitAcc._id,     direction: "credit", amount, notes: msg }),
  ]);
};

// ─── Stamp duty / transfer costs — called at deal close ───────────────────────
//
//   Dr 5220 Stamp Duty / Transfer Costs / Cr Cashbook (or 1311 fallback)

export const postStampDutyEntry = async ({ businessId, dealId, amount, cashbookAccountId, userId, date }) => {
  const amountRounded = round2(Number(amount || 0));
  if (amountRounded <= 0) return;

  const existing = await FinancialLedgerEntry.countDocuments({
    business: businessId,
    sourceTransactionType: "property_sale_stamp_duty",
    sourceTransactionId: String(dealId),
    status: { $ne: "reversed" },
  });
  if (existing > 0) return;

  const effectiveDate = date ? new Date(date) : new Date();
  const { start, end } = dayRange(effectiveDate);
  const journalGroupId = new mongoose.Types.ObjectId();

  const [stampDutyAcc, creditAcc] = await Promise.all([
    resolvePSAccount(businessId, "5220"),
    cashbookAccountId
      ? ChartOfAccount.findById(cashbookAccountId).lean()
      : resolvePSAccount(businessId, "1311"),
  ]);

  if (!creditAcc) throw new Error("Cashbook account not found for stamp duty posting");

  const base = {
    business: businessId,
    sourceTransactionType: "property_sale_stamp_duty",
    sourceTransactionId: String(dealId),
    transactionDate: effectiveDate,
    statementPeriodStart: start,
    statementPeriodEnd: end,
    journalGroupId,
    category: "PROPERTY_SALE_STAMP_DUTY",
    createdBy: userId,
    allowUnscoped: true,
  };

  await Promise.all([
    postEntry({ ...base, accountId: stampDutyAcc._id, direction: "debit",  amount: amountRounded, notes: `Stamp duty / transfer costs — deal ${dealId}` }),
    postEntry({ ...base, accountId: creditAcc._id,    direction: "credit", amount: amountRounded, notes: `Stamp duty payment — deal ${dealId}` }),
  ]);
};

// ─── Commission accrual — Dr Commission Expense / Cr Commission Payable ───────

export const postPropertySaleCommissionAccrual = async ({ businessId, commission, userId }) => {
  const amount = round2(Number(commission.commissionAmount || 0));
  if (amount <= 0) return;

  const existing = await FinancialLedgerEntry.countDocuments({
    business: businessId,
    sourceTransactionType: "property_sale_commission",
    sourceTransactionId: String(commission._id),
    status: { $ne: "reversed" },
    category: { $ne: "REVERSAL" },
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
    transactionDate: commission.createdAt || new Date(),
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

// ─── Commission payout — accrual + payable clearance ─────────────────────────

export const postPropertySaleCommissionPayout = async ({ businessId, commission, userId, payoutDate, cashbookAccountId }) => {
  await postPropertySaleCommissionAccrual({ businessId, commission, userId });

  const amount = round2(Number(commission.commissionAmount || 0));
  if (amount <= 0) return;

  const existingPayout = await FinancialLedgerEntry.countDocuments({
    business: businessId,
    sourceTransactionType: "property_sale_commission_payout",
    sourceTransactionId: String(commission._id),
    status: { $ne: "reversed" },
    category: { $ne: "REVERSAL" },
  });
  if (existingPayout > 0) return;

  const effectiveDate = payoutDate ? new Date(payoutDate) : new Date();
  const { start, end } = dayRange(effectiveDate);
  const journalGroupId = new mongoose.Types.ObjectId();

  const [payableAcc, creditAcc] = await Promise.all([
    resolvePSAccount(businessId, "2180"),
    cashbookAccountId
      ? ChartOfAccount.findById(cashbookAccountId).lean()
      : resolvePSAccount(businessId, "5321"),
  ]);

  if (!creditAcc) throw new Error("Commission payout cashbook account not found — GL posting aborted");

  const ref = commission.commissionNumber || String(commission._id);

  const base = {
    business: businessId,
    sourceTransactionType: "property_sale_commission_payout",
    sourceTransactionId: String(commission._id),
    transactionDate: effectiveDate,
    statementPeriodStart: start,
    statementPeriodEnd: end,
    journalGroupId,
    category: "PROPERTY_SALE_COMMISSION_PAYOUT",
    createdBy: userId,
    allowUnscoped: true,
  };

  await Promise.all([
    postEntry({ ...base, accountId: payableAcc._id, direction: "debit",  amount, notes: `Agent commission payable cleared — ${ref}` }),
    postEntry({ ...base, accountId: creditAcc._id,  direction: "credit", amount, notes: `Agent commission disbursed — ${ref}` }),
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
  await Promise.all(entries.map((entry) => postReversal({ entryId: entry._id, reason: msg, userId })));
};

// ─── Commission payout reversal ───────────────────────────────────────────────

export const reversePropertySaleCommissionPayout = async ({ businessId, commission, userId, reason }) => {
  const payoutEntries = await FinancialLedgerEntry.find({
    business: businessId,
    sourceTransactionType: "property_sale_commission_payout",
    sourceTransactionId: String(commission._id),
    status: { $nin: ["reversed", "void"] },
  }).lean();

  if (!payoutEntries.length) return;

  const msg = reason || `Commission payout reversed — ${commission.commissionNumber || commission._id}`;
  await Promise.all(payoutEntries.map((entry) => postReversal({ entryId: entry._id, reason: msg, userId })));
};
