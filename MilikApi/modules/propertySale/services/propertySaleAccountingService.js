/**
 * Self-contained GL accounting service for the Property Sales module.
 *
 * Accounts used:
 *   [cashbook]  — Actual bank/cash account chosen at payment time (Dr side for receipts)
 *   1311 — Property Sale Receipts Control   (asset)    fallback Dr when no cashbook provided
 *   2150 — Buyer Deposit Held               (liability) Dr/Cr for deposit staging; moves to 4410 on deal close
 *   2180 — Agent Commission Payable          (liability) accrued commission owed to agents
 *   2141 — Withholding Tax Payable           (liability) tax held back from the commission at payout (Cr)
 *   4410 — Property Sale Revenue             (income)   credit side for non-deposit payments; recognised from 2150 at close
 *   4420 — Forfeited Deposit Income          (income)   Cr when a non-refundable deposit is retained on deal cancel
 *   5220 — Stamp Duty / Transfer Costs       (expense)  Dr when stamp duty is paid at deal close
 *   5320 — Property Sale Commission Expense  (expense)  debit side for commission accrual (no owner on the deal)
 *   5321 — Agent Commission Disbursements    (liability) fallback Cr when no cashbook provided at payout
 *   2185 — Owner Clearing / Payable          (liability) owner-linked deals: replaces 5320 as the debit side for
 *          both broker commission accrual and the company's own commission recognition
 *   4430 — Commission Income — Agency Fees   (income)   Cr for the company's own commission (owner-linked deals only)
 *   1312 — Broker Commission Clawback Receivable (asset) Dr when a deal cancels after a tier was already paid out
 *   1313 — Owner Expense Recoverable         (asset)    Dr for costs the company pays on an owner's behalf
 *   1314 — Advocate Trust Receivable         (asset)    Dr side for a payment collected into an advocate's own
 *          trust account instead of the company's cash (collectionMethod "advocate_trust"); cleared (Cr) when
 *          the advocate actually remits the money (SaleAdvocateRemittance / postSaleAdvocateRemittance)
 */

import mongoose from "mongoose";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import { postEntry, postEntries, postReversal } from "../../../services/ledgerPostingService.js";
import { resolveWhtPayableAccount } from "../../../services/withholdingTaxService.js";
import { round2 } from "../../../utils/math.js";

const PS_ACCOUNT_TEMPLATES = {
  "1311": { name: "Property Sale Receipts Control",  type: "asset",     group: "assets",      subGroup: "Current Assets" },
  "2150": { name: "Buyer Deposit Held",              type: "liability", group: "liabilities", subGroup: "Buyer Deposits" },
  "2180": { name: "Agent Commission Payable",         type: "liability", group: "liabilities", subGroup: "Agent Payables" },
  "4410": { name: "Property Sale Revenue",            type: "income",    group: "income",      subGroup: "Property Sales" },
  "4420": { name: "Forfeited Deposit Income",         type: "income",    group: "income",      subGroup: "Property Sales" },
  "5220": { name: "Stamp Duty / Transfer Costs",      type: "expense",   group: "expenses",    subGroup: "Sale Costs" },
  "5320": { name: "Property Sale Commission Expense", type: "expense",   group: "expenses",    subGroup: "Sales Commissions" },
  "5321": { name: "Agent Commission Disbursements",   type: "liability", group: "liabilities", subGroup: "Agent Payables" },
  "2185": { name: "Owner Clearing / Payable",          type: "liability", group: "liabilities", subGroup: "Owner Payables" },
  "4430": { name: "Commission Income — Agency Fees",   type: "income",    group: "income",      subGroup: "Property Sales" },
  "1312": { name: "Broker Commission Clawback Receivable", type: "asset", group: "assets",       subGroup: "Current Assets" },
  "1313": { name: "Owner Expense Recoverable",         type: "asset",     group: "assets",       subGroup: "Current Assets" },
  "1314": { name: "Advocate Trust Receivable",         type: "asset",     group: "assets",       subGroup: "Current Assets" },
};


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

// Exported so other modules (e.g. the PMS PaymentVoucher controller's `sale_owner_expense`
// category, which debits 1313 Owner Expense Recoverable) can self-register against the same
// fixed system accounts without duplicating the upsert-and-cache pattern.
export const resolvePSAccount = async (businessId, code) => {
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
  const isAdvocateTrust = payment.collectionMethod === "advocate_trust";
  const { start, end } = dayRange(payment.paymentDate || payment.createdAt);
  const journalGroupId = new mongoose.Types.ObjectId();

  // Money collected into an advocate's own trust account never touches the company's cashbook until
  // remitted — the debit side is the 1314 receivable, regardless of whatever cashbook was chosen.
  const [debitAcc, creditAcc] = await Promise.all([
    isAdvocateTrust
      ? resolvePSAccount(businessId, "1314")
      : cashbookAccountId
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

// ─── Commission accrual — Dr Commission Expense (or Owner Clearing, if the deal has an owner) / Cr Commission Payable ───

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

  const hasOwner = Boolean(commission.owner);
  const [expenseAcc, payableAcc] = await Promise.all([
    resolvePSAccount(businessId, hasOwner ? "2185" : "5320"),
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

  await postEntries([
    { ...base, accountId: expenseAcc._id, direction: "debit",  amount, notes: `Agent commission accrued — ${ref}` },
    { ...base, accountId: payableAcc._id, direction: "credit", amount, notes: `Agent commission payable — ${ref}` },
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

  // The agent is paid the commission less the tax withheld: the cashbook only loses the net, and the tax is owed to KRA (2141).
  const whtAmount = round2(Number(commission.whtAmount || 0));
  if (whtAmount >= amount) throw new Error("Withholding tax must be less than the commission — GL posting aborted");
  const whtAcc = whtAmount > 0 ? await resolveWhtPayableAccount({ businessId }) : null;

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

  await postEntries([
    { ...base, accountId: payableAcc._id, direction: "debit",  amount, notes: `Agent commission payable cleared — ${ref}` },
    { ...base, accountId: creditAcc._id,  direction: "credit", amount: round2(amount - whtAmount), notes: `Agent commission disbursed — ${ref}` },
    ...(whtAcc
      ? [{ ...base, accountId: whtAcc._id, direction: "credit", amount: whtAmount, notes: `Withholding tax on agent commission — ${ref}`, metadata: { postingRole: "wht_payable", whtRate: commission.whtRate } }]
      : []),
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

// ─── Staged/tiered commission release ─────────────────────────────────────────
//
// Used only when a commission's own `releaseSchedule` is non-empty (SaleSettings.commissionReleaseSchedule
// .enabled was on at the time the commission was created). Each tier is its own idempotent posting, keyed
// by `${commission._id}:tier:${tierRelease._id}` so partial accruals on one commission never collide.

const reverseEntriesFor = async ({ businessId, sourceTransactionType, sourceTransactionId, userId, reason }) => {
  const entries = await FinancialLedgerEntry.find({
    business: businessId,
    sourceTransactionType,
    sourceTransactionId,
    status: { $nin: ["reversed", "void"] },
  }).lean();
  if (!entries.length) return;
  await Promise.all(entries.map((entry) => postReversal({ entryId: entry._id, reason, userId })));
};

// Broker commission tier — Dr Commission Expense (or Owner Clearing) / Cr Commission Payable
export const postPropertySaleCommissionTierRelease = async ({ businessId, commission, tierRelease, userId }) => {
  const amount = round2(Number(tierRelease.amount || 0));
  if (amount <= 0) return;

  const sourceTransactionType = "property_sale_commission_tier";
  const sourceTransactionId = `${commission._id}:tier:${tierRelease._id}`;

  const existing = await FinancialLedgerEntry.countDocuments({
    business: businessId, sourceTransactionType, sourceTransactionId,
    status: { $ne: "reversed" }, category: { $ne: "REVERSAL" },
  });
  if (existing > 0) return;

  const { start, end } = dayRange(tierRelease.accruedAt);
  const journalGroupId = new mongoose.Types.ObjectId();
  const hasOwner = Boolean(commission.owner);
  const [expenseAcc, payableAcc] = await Promise.all([
    resolvePSAccount(businessId, hasOwner ? "2185" : "5320"),
    resolvePSAccount(businessId, "2180"),
  ]);
  const ref = commission.commissionNumber || String(commission._id);

  const base = {
    business: businessId, sourceTransactionType, sourceTransactionId,
    transactionDate: tierRelease.accruedAt || new Date(),
    statementPeriodStart: start, statementPeriodEnd: end, journalGroupId,
    category: "PROPERTY_SALE_COMMISSION_TIER_RELEASE", createdBy: userId, allowUnscoped: true,
  };

  await postEntries([
    { ...base, accountId: expenseAcc._id, direction: "debit",  amount, notes: `Agent commission tier released (${tierRelease.thresholdPct}% paid) — ${ref}` },
    { ...base, accountId: payableAcc._id, direction: "credit", amount, notes: `Agent commission payable — ${ref}` },
  ]);
};

export const reversePropertySaleCommissionTierRelease = async ({ businessId, commission, tierRelease, userId, reason }) =>
  reverseEntriesFor({
    businessId,
    sourceTransactionType: "property_sale_commission_tier",
    sourceTransactionId: `${commission._id}:tier:${tierRelease._id}`,
    userId,
    reason: reason || `Commission tier reversed — ${commission.commissionNumber || commission._id}`,
  });

// Company's own commission tier — Dr Owner Clearing / Cr Commission Income. No payout counterpart: this
// is recognized revenue, never disbursed to a third party.
export const postPropertySaleOwnerCommissionTierRelease = async ({ businessId, ownerCommission, tierRelease, userId }) => {
  const amount = round2(Number(tierRelease.amount || 0));
  if (amount <= 0) return;

  const sourceTransactionType = "property_sale_owner_commission_tier";
  const sourceTransactionId = `${ownerCommission._id}:tier:${tierRelease._id}`;

  const existing = await FinancialLedgerEntry.countDocuments({
    business: businessId, sourceTransactionType, sourceTransactionId,
    status: { $ne: "reversed" }, category: { $ne: "REVERSAL" },
  });
  if (existing > 0) return;

  const { start, end } = dayRange(tierRelease.accruedAt);
  const journalGroupId = new mongoose.Types.ObjectId();
  const [clearingAcc, incomeAcc] = await Promise.all([
    resolvePSAccount(businessId, "2185"),
    resolvePSAccount(businessId, "4430"),
  ]);
  const ref = ownerCommission.commissionNumber || String(ownerCommission._id);

  const base = {
    business: businessId, sourceTransactionType, sourceTransactionId,
    transactionDate: tierRelease.accruedAt || new Date(),
    statementPeriodStart: start, statementPeriodEnd: end, journalGroupId,
    category: "PROPERTY_SALE_OWNER_COMMISSION_TIER_RELEASE", createdBy: userId, allowUnscoped: true,
  };

  await postEntries([
    { ...base, accountId: clearingAcc._id, direction: "debit",  amount, notes: `Owner commission tier recognized (${tierRelease.thresholdPct}% paid) — ${ref}` },
    { ...base, accountId: incomeAcc._id,   direction: "credit", amount, notes: `Commission income — ${ref}` },
  ]);
};

export const reversePropertySaleOwnerCommissionTierRelease = async ({ businessId, ownerCommission, tierRelease, userId, reason }) =>
  reverseEntriesFor({
    businessId,
    sourceTransactionType: "property_sale_owner_commission_tier",
    sourceTransactionId: `${ownerCommission._id}:tier:${tierRelease._id}`,
    userId,
    reason: reason || `Owner commission tier reversed — ${ownerCommission.commissionNumber || ownerCommission._id}`,
  });

// ─── Clawback on cancellation — a tier already paid out in cash can't be un-sent ─────────────────────
//
// Dr Broker Commission Clawback Receivable (1312) / Cr Commission Expense or Owner Clearing (whichever the
// original accrual debited). Zeroes out the expense/clearing impact of a commission that should not have
// been earned, and stands up a receivable asset to recover from the broker later — it deliberately does
// NOT touch the original payout's cash leg (that cash really left).

export const postPropertySaleCommissionClawbackReceivable = async ({ businessId, commission, tierRelease, userId, reason }) => {
  const amount = round2(Number(tierRelease.amount || 0));
  if (amount <= 0) return;

  const sourceTransactionType = "property_sale_commission_clawback";
  const sourceTransactionId = `${commission._id}:tier:${tierRelease._id}`;

  const existing = await FinancialLedgerEntry.countDocuments({
    business: businessId, sourceTransactionType, sourceTransactionId,
    status: { $ne: "reversed" }, category: { $ne: "REVERSAL" },
  });
  if (existing > 0) return;

  const { start, end } = dayRange(new Date());
  const journalGroupId = new mongoose.Types.ObjectId();
  const hasOwner = Boolean(commission.owner);
  const [receivableAcc, expenseAcc] = await Promise.all([
    resolvePSAccount(businessId, "1312"),
    resolvePSAccount(businessId, hasOwner ? "2185" : "5320"),
  ]);
  const ref = commission.commissionNumber || String(commission._id);
  const msg = reason || `Commission tier clawed back — deal cancelled after payout — ${ref}`;

  const base = {
    business: businessId, sourceTransactionType, sourceTransactionId,
    transactionDate: new Date(),
    statementPeriodStart: start, statementPeriodEnd: end, journalGroupId,
    category: "PROPERTY_SALE_COMMISSION_CLAWBACK", createdBy: userId, allowUnscoped: true,
  };

  await postEntries([
    { ...base, accountId: receivableAcc._id, direction: "debit",  amount, notes: msg },
    { ...base, accountId: expenseAcc._id,    direction: "credit", amount, notes: msg },
  ]);
};

// ─── Advocate trust remittance — clears 1314 Advocate Trust Receivable ───────────────────────────────
//
// Called when an advocate actually hands over money they collected into their own trust account.
//   Dr [cashbook]  / Cr 1314 Advocate Trust Receivable

export const postSaleAdvocateRemittance = async ({ businessId, remittance, userId, cashbookAccountId }) => {
  const amount = round2(Number(remittance.amount || 0));
  if (amount <= 0) return;

  const sourceTransactionType = "property_sale_advocate_remittance";
  const sourceTransactionId = String(remittance._id);

  const existing = await FinancialLedgerEntry.countDocuments({
    business: businessId, sourceTransactionType, sourceTransactionId,
    status: { $ne: "reversed" }, category: { $ne: "REVERSAL" },
  });
  if (existing > 0) return;

  const { start, end } = dayRange(remittance.date || remittance.createdAt);
  const journalGroupId = new mongoose.Types.ObjectId();

  const [debitAcc, trustAcc] = await Promise.all([
    cashbookAccountId
      ? ChartOfAccount.findById(cashbookAccountId).lean()
      : resolvePSAccount(businessId, "1311"),
    resolvePSAccount(businessId, "1314"),
  ]);
  if (!debitAcc) throw new Error("Cashbook account not found — GL posting aborted");

  const ref = remittance.remittanceNumber || String(remittance._id);

  const base = {
    business: businessId, sourceTransactionType, sourceTransactionId,
    transactionDate: remittance.date || remittance.createdAt || new Date(),
    statementPeriodStart: start, statementPeriodEnd: end, journalGroupId,
    category: "PROPERTY_SALE_ADVOCATE_REMITTANCE", createdBy: userId, allowUnscoped: true,
  };

  await postEntries([
    { ...base, accountId: debitAcc._id, direction: "debit",  amount, notes: `Advocate trust remittance received — ${ref}` },
    { ...base, accountId: trustAcc._id, direction: "credit", amount, notes: `Advocate trust receivable cleared — ${ref}` },
  ]);
};

export const reverseSaleAdvocateRemittance = async ({ businessId, remittance, userId, reason }) =>
  reverseEntriesFor({
    businessId,
    sourceTransactionType: "property_sale_advocate_remittance",
    sourceTransactionId: String(remittance._id),
    userId,
    reason: reason || `Advocate remittance reversed — ${remittance.remittanceNumber || remittance._id}`,
  });
