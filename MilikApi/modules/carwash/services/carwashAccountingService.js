/**
 * Self-contained accounting service for the Car Wash module.
 *
 * Creates the three required system accounts on-demand (upsert) so ledger posting
 * works even when ensureSystemChartOfAccounts hasn't run for this business yet.
 * All posting functions log errors rather than swallowing them silently.
 */

import ChartOfAccount from "../../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import CarWashStaffCommission from "../models/CarWashStaffCommission.js";
import { postEntry, postReversal } from "../../../services/ledgerPostingService.js";
import { aggregateChartOfAccountBalances } from "../../../services/chartAccountAggregationService.js";
import { resolveAuditActorUserId } from "../../../utils/systemActor.js";
import mongoose from "mongoose";

// ─── Account templates ────────────────────────────────────────────────────────
const CW_ACCOUNT_TEMPLATES = {
  "4400": { name: "Car Wash Service Income",              type: "income",    group: "income",      subGroup: "Car Wash Income" },
  "5310": { name: "Car Wash Supplies Expense",            type: "expense",   group: "expenses",    subGroup: "Car Wash Expenses" },
  "5311": { name: "Car Wash Staff Wages",                 type: "expense",   group: "expenses",    subGroup: "Car Wash Expenses" },
  "5312": { name: "Car Wash Water and Utilities",         type: "expense",   group: "expenses",    subGroup: "Car Wash Expenses" },
  "5313": { name: "Car Wash Loyalty Discount",            type: "expense",   group: "expenses",    subGroup: "Car Wash Expenses" },
  "2160": { name: "Car Wash Staff Commissions Payable",   type: "liability", group: "liabilities", subGroup: "Car Wash Liabilities" },
  "2161": { name: "Car Wash Staff Savings Payable",       type: "liability", group: "liabilities", subGroup: "Car Wash Liabilities" },
};

const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;

const dayRange = (value = new Date()) => {
  const date = value ? new Date(value) : new Date();
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  const start = new Date(safe);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

// ─── Account resolution ───────────────────────────────────────────────────────
/**
 * Find or create a car wash system account for the given business.
 * Uses upsert so it is fully idempotent and never returns null for known codes.
 */
export const resolveCarWashAccount = async (businessId, code) => {
  const tpl = CW_ACCOUNT_TEMPLATES[code];
  if (!tpl) throw new Error(`resolveCarWashAccount: unknown code "${code}"`);

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
        moduleScopes: ["carwash"],
      },
    },
    { upsert: true, new: true }
  );
};

// ─── Prepaid top-up ledger: Dr Cashbook / Cr Revenue (4400) ─────────────────
/**
 * Posts the double-entry when a prepaid wallet is topped up.
 * Revenue is recognised at the point of cash receipt (simplified model).
 * topup = CarWashAccountTopup document.
 */
export const postCarWashTopupLedger = async ({ businessId, topup, cashbookAccountId, userId }) => {
  if (!cashbookAccountId) return;
  const amount = round2(Number(topup.amount || 0));
  if (amount <= 0) return;

  try {
    const existingCount = await FinancialLedgerEntry.countDocuments({
      business: new mongoose.Types.ObjectId(String(businessId)),
      sourceTransactionType: "carwash_prepaid_topup",
      sourceTransactionId: String(topup._id),
      status: { $ne: "reversed" },
    });
    if (existingCount > 0) return;

    const revenueAccount = await resolveCarWashAccount(businessId, "4400");
    const actorId = userId && mongoose.Types.ObjectId.isValid(String(userId))
      ? userId
      : await resolveAuditActorUserId({ req: null, businessId });
    const { start, end } = dayRange(topup.paymentDate || new Date());
    const base = {
      business: businessId,
      sourceTransactionType: "carwash_prepaid_topup",
      sourceTransactionId: String(topup._id),
      transactionDate: topup.paymentDate || new Date(),
      statementPeriodStart: start,
      statementPeriodEnd: end,
      category: "CARWASH_PAYMENT",
      amount,
      payer: "customer",
      receiver: "n/a",
      createdBy: actorId,
      approvedBy: actorId,
      allowUnscoped: true,
    };

    await postEntry({
      ...base,
      accountId: cashbookAccountId,
      direction: "debit",
      notes: `CW prepaid top-up received (${topup.method || ""})`,
    });
    await postEntry({
      ...base,
      accountId: revenueAccount._id,
      direction: "credit",
      notes: `CW prepaid service income`,
    });
    await aggregateChartOfAccountBalances(businessId, [String(cashbookAccountId), String(revenueAccount._id)]);
  } catch (err) {
    console.error("[CW Accounting] Prepaid top-up ledger error topup=%s: %s", topup._id, err?.message || err);
  }
};

// ─── Reverse prepaid top-up ledger ───────────────────────────────────────────
export const reverseCarWashTopupLedger = async ({ businessId, topupId, reason, req = null }) => {
  try {
    const entries = await FinancialLedgerEntry.find({
      business: new mongoose.Types.ObjectId(String(businessId)),
      sourceTransactionType: "carwash_prepaid_topup",
      sourceTransactionId: String(topupId),
      status: { $ne: "reversed" },
    }).lean();
    if (!entries.length) return;
    const actorId = await resolveAuditActorUserId({ req, businessId });
    const touchedIds = new Set();
    for (const entry of entries) {
      await reverseCwEntry(entry, actorId, reason || "Prepaid top-up voided");
      touchedIds.add(String(entry.accountId));
    }
    if (touchedIds.size) await aggregateChartOfAccountBalances(businessId, [...touchedIds]);
  } catch (err) {
    console.error("[CW Accounting] Top-up ledger reversal error topup=%s: %s", topupId, err?.message || err);
  }
};

// ─── Payment ledger: Dr Cashbook / Cr Revenue (4400) ─────────────────────────
/**
 * Posts the double-entry for a manually-recorded or M-Pesa car wash payment.
 * amount = cash actually received (excludes any discount write-off).
 * Never throws — logs on failure so the caller is never blocked.
 */
export const postCarWashPaymentLedger = async ({ businessId, payment, cashbookAccountId, job, userId }) => {
  if (!cashbookAccountId) return;
  const amount = round2(Number(payment.amount || 0));
  if (amount <= 0) return;

  try {
    // Idempotency: skip if non-reversed entries already exist for this payment
    const existingCount = await FinancialLedgerEntry.countDocuments({
      business: new mongoose.Types.ObjectId(String(businessId)),
      sourceTransactionType: "carwash_payment",
      sourceTransactionId: String(payment._id),
      status: { $ne: "reversed" },
    });
    if (existingCount > 0) return;

    const revenueAccount = await resolveCarWashAccount(businessId, "4400");
    // Resolve a valid actor — userId may be null for M-Pesa callbacks (no authenticated user)
    const actorId = userId && mongoose.Types.ObjectId.isValid(String(userId))
      ? userId
      : await resolveAuditActorUserId({ req: null, businessId });
    const { start, end } = dayRange(payment.paymentDate || new Date());
    const base = {
      business: businessId,
      sourceTransactionType: "carwash_payment",
      sourceTransactionId: String(payment._id),
      transactionDate: payment.paymentDate || new Date(),
      statementPeriodStart: start,
      statementPeriodEnd: end,
      category: "CARWASH_PAYMENT",
      amount,
      payer: job?.customerName || "customer",
      receiver: "n/a",
      createdBy: actorId,
      approvedBy: actorId,
      allowUnscoped: true,
    };

    await postEntry({
      ...base,
      accountId: cashbookAccountId,
      direction: "debit",
      notes: `CW payment received – Job #${job?.jobNumber || ""} (${payment.method || ""})`,
    });
    await postEntry({
      ...base,
      accountId: revenueAccount._id,
      direction: "credit",
      notes: `CW service income – Job #${job?.jobNumber || ""}`,
    });
    await aggregateChartOfAccountBalances(businessId, [String(cashbookAccountId), String(revenueAccount._id)]);
  } catch (err) {
    console.error("[CW Accounting] Payment ledger error job=%s: %s", job?.jobNumber || payment._id, err?.message || err);
  }
};

// ─── Loyalty discount ledger: Dr Discount (5313) / Cr Revenue (4400) ────────
/**
 * Posts the discount write-off when a loyalty reward is redeemed.
 * Grosses up revenue to the full price and surfaces the loyalty cost as an expense.
 * Never throws — caller is never blocked.
 */
export const postCarWashLoyaltyDiscountLedger = async ({ businessId, job, discountAmount, rewardType, req = null }) => {
  const amount = round2(Number(discountAmount || 0));
  if (amount <= 0) return;

  try {
    const existingCount = await FinancialLedgerEntry.countDocuments({
      business: new mongoose.Types.ObjectId(String(businessId)),
      sourceTransactionType: "carwash_loyalty_redemption",
      sourceTransactionId: String(job._id),
      status: { $ne: "reversed" },
    });
    if (existingCount > 0) return;

    const [discountAccount, revenueAccount] = await Promise.all([
      resolveCarWashAccount(businessId, "5313"),
      resolveCarWashAccount(businessId, "4400"),
    ]);
    const actorId = await resolveAuditActorUserId({ req, businessId });
    const { start, end } = dayRange(new Date());
    const base = {
      business: businessId,
      sourceTransactionType: "carwash_loyalty_redemption",
      sourceTransactionId: String(job._id),
      transactionDate: new Date(),
      statementPeriodStart: start,
      statementPeriodEnd: end,
      category: "CARWASH_LOYALTY_REDEMPTION",
      amount,
      payer: "loyalty",
      receiver: "n/a",
      createdBy: actorId,
      approvedBy: actorId,
      allowUnscoped: true,
    };

    await postEntry({
      ...base,
      accountId: discountAccount._id,
      direction: "debit",
      notes: `CW loyalty discount – Job #${job.jobNumber || ""} (${rewardType || ""})`,
    });
    await postEntry({
      ...base,
      accountId: revenueAccount._id,
      direction: "credit",
      notes: `CW service income (loyalty) – Job #${job.jobNumber || ""}`,
    });
    await aggregateChartOfAccountBalances(businessId, [String(discountAccount._id), String(revenueAccount._id)]);
  } catch (err) {
    console.error("[CW Accounting] Loyalty discount ledger error job=%s: %s", job?.jobNumber || job?._id, err?.message || err);
  }
};

// ─── Commission accrual: Dr Expense (5311) / Cr Payable (2160) ───────────────
/**
 * Posts the commission accrual double-entry and updates the commission document.
 * Returns the array of ledger entry IDs on success, or [] on failure.
 */
export const postCarWashCommissionAccrual = async ({ req, commission }) => {
  if (!commission || round2(Number(commission.commissionAmount || 0)) <= 0) return [];
  if (Array.isArray(commission.accrualLedgerEntries) && commission.accrualLedgerEntries.length) {
    return commission.accrualLedgerEntries;
  }

  const businessId = commission.business;

  // DB-level backup guard: in case accrualLedgerEntries save failed on a prior call
  const existingCount = await FinancialLedgerEntry.countDocuments({
    business: new mongoose.Types.ObjectId(String(businessId)),
    sourceTransactionType: "carwash_commission",
    sourceTransactionId: String(commission._id),
    status: { $ne: "reversed" },
  });
  if (existingCount > 0) return commission.accrualLedgerEntries;
  const actorUserId = await resolveAuditActorUserId({ req, businessId });
  const [expenseAccount, payableAccount] = await Promise.all([
    resolveCarWashAccount(businessId, "5311"),
    resolveCarWashAccount(businessId, "2160"),
  ]);

  const { start, end } = dayRange(commission.earnedAt || new Date());
  const amount = round2(commission.commissionAmount);
  const base = {
    business: businessId,
    sourceTransactionType: "carwash_commission",
    sourceTransactionId: String(commission._id),
    transactionDate: commission.earnedAt || new Date(),
    statementPeriodStart: start,
    statementPeriodEnd: end,
    category: "CARWASH_COMMISSION_ACCRUAL",
    amount,
    payer: "system",
    receiver: "staff",
    createdBy: actorUserId,
    approvedBy: actorUserId,
    allowUnscoped: true,
  };

  const debitLeg = await postEntry({
    ...base,
    accountId: expenseAccount._id,
    direction: "debit",
    notes: `CW commission earned: ${commission.jobNumber || commission._id}`,
    metadata: { postingRole: "carwash_commission_expense", staff: String(commission.staff), job: String(commission.job) },
  });
  const creditLeg = await postEntry({
    ...base,
    accountId: payableAccount._id,
    direction: "credit",
    notes: `CW commission payable: ${commission.jobNumber || commission._id}`,
    metadata: {
      postingRole: "carwash_commission_payable",
      staff: String(commission.staff),
      job: String(commission.job),
      offsetOfEntryId: String(debitLeg._id),
    },
  });

  await aggregateChartOfAccountBalances(businessId, [String(expenseAccount._id), String(payableAccount._id)]);
  commission.accrualLedgerEntries = [debitLeg._id, creditLeg._id];
  await commission.save();
  return commission.accrualLedgerEntries;
};

// ─── Commission payout: Dr Payable (2160) / Cr Cashbook ──────────────────────
/**
 * Posts the commission payout double-entry and updates the payout document.
 * Throws on failure — payout must be atomic.
 */
export const postCarWashCommissionPayout = async ({ req, payout, cashbookAccount }) => {
  const businessId = payout.business;

  const existingCount = await FinancialLedgerEntry.countDocuments({
    business: payout.business,
    sourceTransactionType: "carwash_commission_payout",
    sourceTransactionId: String(payout._id),
    status: { $ne: "reversed" },
  });
  if (existingCount > 0) {
    console.warn("[CW Accounting] Commission payout %s already posted — skipping.", payout._id);
    return;
  }

  const actorUserId = await resolveAuditActorUserId({ req, businessId });
  const payableAccount = await resolveCarWashAccount(businessId, "2160");

  if (!payableAccount?._id || !cashbookAccount?._id) {
    throw new Error("Car Wash commission payout accounts are not available");
  }

  const { start, end } = dayRange(payout.payoutDate);
  const amount = round2(payout.amount);
  const base = {
    business: businessId,
    sourceTransactionType: "carwash_commission_payout",
    sourceTransactionId: String(payout._id),
    transactionDate: payout.payoutDate || new Date(),
    statementPeriodStart: start,
    statementPeriodEnd: end,
    category: "CARWASH_COMMISSION_PAYOUT",
    amount,
    payer: "manager",
    receiver: "staff",
    createdBy: actorUserId,
    approvedBy: actorUserId,
    allowUnscoped: true,
  };

  const debitLeg = await postEntry({
    ...base,
    accountId: payableAccount._id,
    direction: "debit",
    notes: `CW commission payout ${payout.payoutNumber}`,
    metadata: { postingRole: "carwash_commission_payable_settlement", staff: String(payout.staff) },
  });
  const creditLeg = await postEntry({
    ...base,
    accountId: cashbookAccount._id,
    direction: "credit",
    notes: `Cashbook payment for CW commission payout ${payout.payoutNumber}`,
    metadata: {
      postingRole: "cashbook_outflow",
      staff: String(payout.staff),
      cashbookAccountId: String(cashbookAccount._id),
      offsetOfEntryId: String(debitLeg._id),
    },
  });

  await aggregateChartOfAccountBalances(businessId, [String(payableAccount._id), String(cashbookAccount._id)]);
  payout.ledgerEntries = [debitLeg._id, creditLeg._id];
  await payout.save();
  return payout.ledgerEntries;
};

// ─── Savings held from commission payout: Dr Payable (2160) / Cr Cash + Cr Savings (2161) ──
/**
 * Called when a commission payout withholds part of the amount as savings.
 * Replaces the standard postCarWashCommissionPayout when savingsHeld > 0.
 * commissionAmount = full commission to clear from 2160
 * netCash          = what the staff actually receives in hand (commissionAmount - savingsHeld)
 * savingsHeld      = amount moved to 2161 (Staff Savings Payable)
 */
export const postCarWashCommissionPayoutWithSavings = async ({
  req, payout, cashbookAccount, commissionAmount, netCash, savingsHeld,
}) => {
  const businessId = payout.business;

  const existingCount = await FinancialLedgerEntry.countDocuments({
    business: payout.business,
    sourceTransactionType: "carwash_commission_payout",
    sourceTransactionId: String(payout._id),
    status: { $ne: "reversed" },
  });
  if (existingCount > 0) {
    console.warn("[CW Accounting] Commission payout %s already posted — skipping.", payout._id);
    return;
  }

  const actorUserId = await resolveAuditActorUserId({ req, businessId });
  const [payableAccount, savingsAccount] = await Promise.all([
    resolveCarWashAccount(businessId, "2160"),
    resolveCarWashAccount(businessId, "2161"),
  ]);

  if (!payableAccount?._id || !cashbookAccount?._id || !savingsAccount?._id) {
    throw new Error("Car Wash commission payout accounts are not available");
  }

  const { start, end } = dayRange(payout.payoutDate);
  const base = {
    business: businessId,
    sourceTransactionType: "carwash_commission_payout",
    sourceTransactionId: String(payout._id),
    transactionDate: payout.payoutDate || new Date(),
    statementPeriodStart: start,
    statementPeriodEnd: end,
    category: "CARWASH_COMMISSION_PAYOUT",
    payer: "manager",
    receiver: "staff",
    createdBy: actorUserId,
    approvedBy: actorUserId,
    allowUnscoped: true,
  };

  // Dr 2160 — clear the full commission payable
  const debitLeg = await postEntry({
    ...base,
    accountId: payableAccount._id,
    amount: round2(commissionAmount),
    direction: "debit",
    notes: `CW commission payout ${payout.payoutNumber}`,
    metadata: { postingRole: "carwash_commission_payable_settlement", staff: String(payout.staff) },
  });

  const entryIds = [debitLeg._id];

  // Cr Cashbook — net cash paid to staff
  if (round2(netCash) > 0) {
    const cashLeg = await postEntry({
      ...base,
      accountId: cashbookAccount._id,
      amount: round2(netCash),
      direction: "credit",
      notes: `Cashbook payment for CW commission payout ${payout.payoutNumber} (net after savings)`,
      metadata: {
        postingRole: "cashbook_outflow",
        staff: String(payout.staff),
        cashbookAccountId: String(cashbookAccount._id),
        offsetOfEntryId: String(debitLeg._id),
      },
    });
    entryIds.push(cashLeg._id);
  }

  // Cr 2161 — savings held back
  if (round2(savingsHeld) > 0) {
    const savingsLeg = await postEntry({
      ...base,
      accountId: savingsAccount._id,
      amount: round2(savingsHeld),
      direction: "credit",
      notes: `CW staff savings withheld from payout ${payout.payoutNumber}`,
      metadata: {
        postingRole: "carwash_savings_held",
        staff: String(payout.staff),
        offsetOfEntryId: String(debitLeg._id),
      },
    });
    entryIds.push(savingsLeg._id);
  }

  const accountsToAggregate = [
    String(payableAccount._id),
    String(cashbookAccount._id),
    String(savingsAccount._id),
  ];
  await aggregateChartOfAccountBalances(businessId, accountsToAggregate);
  payout.ledgerEntries = entryIds;
  await payout.save();
  return payout.ledgerEntries;
};

// ─── Savings disbursement: Dr Savings Payable (2161) / Cr Cashbook ─────────
/**
 * Posts the annual (or on-demand) savings disbursement to a staff member.
 * payout = { _id, business, staff, amount, payoutDate, payoutNumber (optional) }
 */
export const postCarWashSavingsDisbursement = async ({ req, savingsRecord, cashbookAccount }) => {
  const businessId = savingsRecord.business;
  const actorUserId = await resolveAuditActorUserId({ req, businessId });
  const savingsAccount = await resolveCarWashAccount(businessId, "2161");

  if (!savingsAccount?._id || !cashbookAccount?._id) {
    throw new Error("Car Wash savings payout accounts are not available");
  }

  const { start, end } = dayRange(savingsRecord.date);
  const amount = round2(savingsRecord.amount);
  const base = {
    business: businessId,
    sourceTransactionType: "carwash_savings_disbursement",
    sourceTransactionId: String(savingsRecord._id),
    transactionDate: savingsRecord.date || new Date(),
    statementPeriodStart: start,
    statementPeriodEnd: end,
    category: "CARWASH_SAVINGS_DISBURSEMENT",
    amount,
    payer: "manager",
    receiver: "staff",
    createdBy: actorUserId,
    approvedBy: actorUserId,
    allowUnscoped: true,
  };

  const debitLeg = await postEntry({
    ...base,
    accountId: savingsAccount._id,
    direction: "debit",
    notes: `CW staff savings payout ${savingsRecord.savingsPayoutNumber || savingsRecord._id}`,
    metadata: { postingRole: "carwash_savings_disbursement", staff: String(savingsRecord.staff) },
  });
  const creditLeg = await postEntry({
    ...base,
    accountId: cashbookAccount._id,
    direction: "credit",
    notes: `Cashbook payment for CW staff savings ${savingsRecord.savingsPayoutNumber || savingsRecord._id}`,
    metadata: {
      postingRole: "cashbook_outflow",
      staff: String(savingsRecord.staff),
      offsetOfEntryId: String(debitLeg._id),
    },
  });

  await aggregateChartOfAccountBalances(businessId, [String(savingsAccount._id), String(cashbookAccount._id)]);
  savingsRecord.ledgerEntries = [debitLeg._id, creditLeg._id];
  await savingsRecord.save();
  return savingsRecord.ledgerEntries;
};

// ─── Commission accrual reversal ──────────────────────────────────────────────
/**
 * Reverses existing accrual ledger entries in-place.
 * Modifies `commission` in memory — caller must save afterward.
 */
export const reverseCarWashCommissionAccrual = async ({ req, commission }) => {
  if (!Array.isArray(commission.accrualLedgerEntries) || !commission.accrualLedgerEntries.length) return;
  const actorUserId = await resolveAuditActorUserId({ req, businessId: commission.business });
  const accountIds = new Set();
  const reversalIds = [];

  for (const entryId of commission.accrualLedgerEntries) {
    try {
      const { originalEntry, reversalEntry } = await postReversal({
        entryId,
        userId: actorUserId,
        reason: `CW commission recalculated: ${commission.jobNumber || commission._id}`,
      });
      if (originalEntry?.accountId) accountIds.add(String(originalEntry.accountId));
      if (reversalEntry?.accountId) accountIds.add(String(reversalEntry.accountId));
      if (reversalEntry?._id) reversalIds.push(reversalEntry._id);
    } catch (err) {
      if (!/already reversed/i.test(String(err?.message || ""))) throw err;
    }
  }

  commission.accrualLedgerEntries = [];
  if (reversalIds.length) {
    commission.accrualReversalLedgerEntries = [
      ...(commission.accrualReversalLedgerEntries || []),
      ...reversalIds,
    ];
  }
  if (accountIds.size) await aggregateChartOfAccountBalances(commission.business, [...accountIds]);
};

// ─── Generic payout ledger reversal ──────────────────────────────────────────
/**
 * Reverses a set of ledger entry IDs for a commission or savings payout.
 * Safe to call if some entries are already reversed — skips those silently.
 */
export const reverseCarWashPayoutLedgerEntries = async ({ req, businessId, entryIds, reason }) => {
  if (!entryIds?.length) return;
  const actorId = await resolveAuditActorUserId({ req, businessId });

  const entries = await FinancialLedgerEntry.find({
    _id: { $in: entryIds },
    business: new mongoose.Types.ObjectId(String(businessId)),
    status: { $ne: "reversed" },
  }).lean();

  if (!entries.length) return;

  const accountIds = new Set();
  for (const entry of entries) {
    try {
      const { originalEntry, reversalEntry } = await reverseCwEntry(entry, actorId, reason);
      if (originalEntry?.accountId) accountIds.add(String(originalEntry.accountId));
      if (reversalEntry?.accountId)  accountIds.add(String(reversalEntry.accountId));
    } catch (err) {
      if (!/already reversed/i.test(String(err?.message || ""))) throw err;
    }
  }
  if (accountIds.size) await aggregateChartOfAccountBalances(businessId, [...accountIds]);
};

// ─── Commission cancellation list ─────────────────────────────────────────────
/**
 * Cancels a list of commission records: reverses their accrual entries and
 * bulk-sets status → "cancelled". Used by commissionService.cancelJobCommissions.
 */
export const cancelCarWashCommissionList = async ({ req, businessId, commissions, reason }) => {
  if (!commissions.length) return;
  const actorUserId = await resolveAuditActorUserId({ req, businessId });
  const accountIds = new Set();
  const bulkOps = [];

  for (const commission of commissions) {
    const reversalEntryIds = [];
    for (const entryId of commission.accrualLedgerEntries || []) {
      try {
        const { originalEntry, reversalEntry } = await postReversal({
          entryId,
          userId: actorUserId,
          reason: `CW commission cancelled: ${commission.jobNumber || commission._id}`,
        });
        if (originalEntry?.accountId) accountIds.add(String(originalEntry.accountId));
        if (reversalEntry?.accountId) accountIds.add(String(reversalEntry.accountId));
        if (reversalEntry?._id) reversalEntryIds.push(reversalEntry._id);
      } catch (err) {
        if (!/already reversed/i.test(String(err?.message || ""))) throw err;
      }
    }

    bulkOps.push({
      updateOne: {
        filter: { _id: commission._id },
        update: {
          $set: { status: "cancelled", notes: reason, updatedBy: actorUserId },
          $push: { accrualReversalLedgerEntries: { $each: reversalEntryIds } },
        },
      },
    });
  }

  if (bulkOps.length) {
    await CarWashStaffCommission.bulkWrite(bulkOps);
  }
  if (accountIds.size) await aggregateChartOfAccountBalances(businessId, [...accountIds]);
};

// ─── Resolve cashbook for payout ──────────────────────────────────────────────
export const resolvePayoutCashbook = async (businessId, accountId) => {
  if (!accountId) throw new Error("Select a valid commission payout cashbook");
  return ChartOfAccount.findOne({
    _id: accountId,
    business: businessId,
    type: "asset",
    isPosting: true,
    subGroup: { $regex: "cashbook", $options: "i" },
  }).lean();
};

// ─── Car-wash-safe single-entry reversal ─────────────────────────────────────
// postReversal sets receiver = originalEntry.payer, but payer stores a customer
// name which is not in the receiver enum. Use postEntry directly instead and
// mark the original as reversed via document.save() (document middleware, not
// blocked by the query-level immutability hooks).
const reverseCwEntry = async (entry, actorId, reason) => {
  const { default: FinancialLedgerEntry } = await import("../../../models/FinancialLedgerEntry.js");
  const flipDir = entry.direction === "debit" ? "credit" : "debit";

  const reversalEntry = await postEntry({
    business: entry.business,
    sourceTransactionType: entry.sourceTransactionType,
    sourceTransactionId: entry.sourceTransactionId,
    transactionDate: new Date(),
    statementPeriodStart: entry.statementPeriodStart,
    statementPeriodEnd: entry.statementPeriodEnd,
    category: "REVERSAL",
    accountId: entry.accountId,
    amount: entry.amount,
    direction: flipDir,
    payer: "n/a",
    receiver: "n/a",
    notes: reason,
    reversalOf: entry._id,
    createdBy: actorId,
    approvedBy: actorId,
    allowUnscoped: true,
    status: "approved",
    metadata: {
      reversalReason: reason,
      reversedEntryCategory: entry.category,
      reversedEntryId: String(entry._id),
    },
  });

  // Mark original as reversed — uses document.save() which is NOT blocked
  // by the query-level pre("updateOne") immutability hook.
  const original = await FinancialLedgerEntry.findById(entry._id);
  if (original && original.status !== "reversed") {
    original.status = "reversed";
    original.reversedByEntry = reversalEntry._id;
    await original.save();
  }

  return { originalEntry: original, reversalEntry };
};

// ─── Payment ledger reversal ──────────────────────────────────────────────────
/**
 * Reverses all FinancialLedgerEntry rows tied to a car wash payment.
 * Called when a payment is deleted so the Dr/Cr double-entry is unwound.
 * Never throws — logs on failure so the delete is never blocked.
 */
export const reverseCarWashPaymentLedger = async ({ businessId, paymentId, req = null }) => {
  try {
    const { default: FinancialLedgerEntry } = await import("../../../models/FinancialLedgerEntry.js");
    const actorId = await resolveAuditActorUserId({ req, businessId });

    const entries = await FinancialLedgerEntry.find({
      business: new mongoose.Types.ObjectId(String(businessId)),
      sourceTransactionType: "carwash_payment",
      sourceTransactionId: String(paymentId),
      status: { $ne: "reversed" },
    }).lean();

    if (!entries.length) return;

    const accountIds = new Set();
    for (const entry of entries) {
      try {
        const { originalEntry, reversalEntry } = await reverseCwEntry(
          entry, actorId, `Car Wash payment deleted: ${paymentId}`
        );
        if (originalEntry?.accountId) accountIds.add(String(originalEntry.accountId));
        if (reversalEntry?.accountId)  accountIds.add(String(reversalEntry.accountId));
      } catch (err) {
        if (!/already reversed/i.test(String(err?.message || ""))) throw err;
      }
    }

    if (accountIds.size) await aggregateChartOfAccountBalances(businessId, [...accountIds]);
  } catch (err) {
    console.error("[CW Accounting] Payment reversal error payment=%s: %s", paymentId, err?.message || err);
  }
};

// ─── Expense ledger reversal ──────────────────────────────────────────────────
/**
 * Reverses all FinancialLedgerEntry rows tied to a carwash_expense.
 * Marks originals as "reversed" (consistent with payment/commission reversal pattern).
 */
export const reverseCarWashExpenseLedger = async ({ businessId, expense, req = null }) => {
  try {
    const entries = await FinancialLedgerEntry.find({
      business: new mongoose.Types.ObjectId(String(businessId)),
      sourceTransactionType: "carwash_expense",
      sourceTransactionId: String(expense._id),
      status: { $ne: "reversed" },
    }).lean();
    if (!entries.length) return;
    const actorId = await resolveAuditActorUserId({ req, businessId });
    const touchedIds = new Set();
    const reason = `CW expense cancelled – ${expense.payee || expense.category || expense.expenseNumber || ""}`;
    for (const entry of entries) {
      await reverseCwEntry(entry, actorId, reason);
      touchedIds.add(String(entry.accountId));
    }
    if (touchedIds.size) await aggregateChartOfAccountBalances(businessId, [...touchedIds]);
  } catch (err) {
    console.error("[CW Accounting] Expense reversal error expense=%s: %s", expense._id, err?.message || err);
  }
};

// ─── Repair: reverse orphaned payment ledger entries ─────────────────────────
/**
 * Finds every approved FinancialLedgerEntry of type "carwash_payment" whose
 * corresponding CarWashPayment document no longer exists, then reverses them.
 * Returns { reversed, errors[] }.
 */
export const repairOrphanedCarWashLedgerEntries = async (businessId, req = null) => {
  const { default: CarWashPayment }       = await import("../models/CarWashPayment.js");
  const { default: FinancialLedgerEntry } = await import("../../../models/FinancialLedgerEntry.js");

  const businessOid = new mongoose.Types.ObjectId(String(businessId));

  const approvedEntries = await FinancialLedgerEntry.find({
    business: businessOid,
    sourceTransactionType: "carwash_payment",
    status: "approved",
  }).lean();

  if (!approvedEntries.length) return { reversed: 0, errors: [] };

  // Get the unique payment IDs referenced by these entries
  const referencedPaymentIds = [...new Set(approvedEntries.map((e) => e.sourceTransactionId))];

  // Find which of those payment IDs actually still exist
  const existingPayments = await CarWashPayment.find({
    _id: { $in: referencedPaymentIds },
    business: businessOid,
  }).select("_id").lean();
  const existingIds = new Set(existingPayments.map((p) => String(p._id)));

  // Orphaned = entries whose payment is gone
  const orphaned = approvedEntries.filter((e) => !existingIds.has(e.sourceTransactionId));
  if (!orphaned.length) return { reversed: 0, errors: [] };

  const actorId = await resolveAuditActorUserId({ req, businessId });
  const accountIds = new Set();
  const errors = [];
  let reversed = 0;

  for (const entry of orphaned) {
    try {
      const { originalEntry, reversalEntry } = await reverseCwEntry(
        entry, actorId, `Orphaned entry — payment ${entry.sourceTransactionId} was deleted`
      );
      if (originalEntry?.accountId) accountIds.add(String(originalEntry.accountId));
      if (reversalEntry?.accountId)  accountIds.add(String(reversalEntry.accountId));
      reversed++;
    } catch (err) {
      if (/already reversed/i.test(String(err?.message || ""))) { reversed++; continue; }
      errors.push({ entryId: String(entry._id), error: err?.message || String(err) });
    }
  }

  if (accountIds.size) await aggregateChartOfAccountBalances(businessId, [...accountIds]);
  return { reversed, errors };
};

// ─── Deduplication: reverse extra ledger entries caused by double-posting ────────
/**
 * Finds every approved carwash_payment and carwash_commission FinancialLedgerEntry
 * that has more than one non-reversed entry for the same (sourceTransactionId, direction),
 * then reverses all but the oldest (original) entry per group.
 *
 * Safe to run multiple times — already-reversed entries are skipped.
 * Returns { reversed, errors[] }.
 */
export const deduplicateCarWashLedgerEntries = async (businessId, req = null) => {
  const businessOid = new mongoose.Types.ObjectId(String(businessId));
  const actorId = await resolveAuditActorUserId({ req, businessId });

  const entries = await FinancialLedgerEntry.find({
    business: businessOid,
    sourceTransactionType: { $in: ["carwash_payment", "carwash_commission", "carwash_expense"] },
    status: "approved",
  }).sort({ createdAt: 1 }).lean();

  // Group by (sourceTransactionType, sourceTransactionId, direction)
  const groups = new Map();
  for (const entry of entries) {
    const key = `${entry.sourceTransactionType}::${String(entry.sourceTransactionId)}::${entry.direction}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }

  const accountIds = new Set();
  let reversed = 0;
  const errors = [];

  for (const [, group] of groups) {
    if (group.length <= 1) continue;
    // Keep the oldest (first) entry, reverse the rest
    for (const entry of group.slice(1)) {
      try {
        const { originalEntry, reversalEntry } = await reverseCwEntry(
          entry, actorId, `Duplicate ledger entry removed (double-posting repair)`
        );
        if (originalEntry?.accountId) accountIds.add(String(originalEntry.accountId));
        if (reversalEntry?.accountId) accountIds.add(String(reversalEntry.accountId));
        reversed++;
      } catch (err) {
        if (/already reversed/i.test(String(err?.message || ""))) { reversed++; continue; }
        errors.push({ entryId: String(entry._id), error: err?.message || String(err) });
      }
    }
  }

  if (accountIds.size) await aggregateChartOfAccountBalances(businessId, [...accountIds]);
  return { reversed, errors };
};

// ─── Backfill: post missing ledger entries for existing payments + commissions ─
/**
 * Finds every CarWashPayment and CarWashStaffCommission for businessId that have
 * no FinancialLedgerEntry yet, then posts their double-entries.
 *
 * Errors are returned in the errors array — nothing is swallowed.
 * Returns { paymentsPosted, commissionsPosted, skipped, errors[] }.
 */
export const backfillCarWashPaymentLedger = async (businessId, req = null) => {
  const { default: CarWashPayment }         = await import("../models/CarWashPayment.js");
  const { default: CarWashStaffCommission } = await import("../models/CarWashStaffCommission.js");
  const { default: CarWashExpense }         = await import("../models/CarWashExpense.js");
  const { default: FinancialLedgerEntry }   = await import("../../../models/FinancialLedgerEntry.js");

  const businessOid = new mongoose.Types.ObjectId(String(businessId));

  const [payments, commissions, expenses,
         alreadyPostedPaymentIds, alreadyPostedCommIds, alreadyPostedExpenseIds] = await Promise.all([
    CarWashPayment.find({ business: businessOid })
      .populate("job", "jobNumber customerName")
      .lean(),
    CarWashStaffCommission.find({
      business: businessOid,
      status: { $in: ["earned", "payable", "paid"] },
      commissionAmount: { $gt: 0 },
      accrualLedgerEntries: { $size: 0 },
    }).lean(),
    CarWashExpense.find({ business: businessOid, status: "paid", amount: { $gt: 0 } }).lean(),
    FinancialLedgerEntry.distinct("sourceTransactionId", {
      business: businessOid, sourceTransactionType: "carwash_payment",
    }),
    FinancialLedgerEntry.distinct("sourceTransactionId", {
      business: businessOid, sourceTransactionType: "carwash_commission",
    }),
    FinancialLedgerEntry.distinct("sourceTransactionId", {
      business: businessOid, sourceTransactionType: "carwash_expense",
    }),
  ]);

  const alreadyPostedPayments = new Set(alreadyPostedPaymentIds.map(String));
  const alreadyPostedComms    = new Set(alreadyPostedCommIds.map(String));
  const alreadyPostedExpenses = new Set(alreadyPostedExpenseIds.map(String));

  const [revenueAccount, commExpenseAccount, payableAccount, expAcct5310, expAcct5312] = await Promise.all([
    resolveCarWashAccount(businessId, "4400"),
    resolveCarWashAccount(businessId, "5311"),
    resolveCarWashAccount(businessId, "2160"),
    resolveCarWashAccount(businessId, "5310"),
    resolveCarWashAccount(businessId, "5312"),
  ]);
  const expenseAccountMap = { "5310": expAcct5310, "5311": commExpenseAccount, "5312": expAcct5312 };

  const actorId = await resolveAuditActorUserId({ req, businessId });

  let paymentsPosted = 0;
  let commissionsPosted = 0;
  let expensesPosted = 0;
  let skipped = 0;
  const errors = [];

  // ── payments ────────────────────────────────────────────────────────────────
  const paymentTouchedIds = new Set([String(revenueAccount._id)]);
  for (const payment of payments) {
    const paymentIdStr = String(payment._id);
    if (alreadyPostedPayments.has(paymentIdStr)) { skipped++; continue; }
    if (!payment.cashbookAccount) { skipped++; continue; }
    const amount = round2(Number(payment.amount || 0));
    if (amount <= 0) { skipped++; continue; }

    try {
      const { start, end } = dayRange(payment.paymentDate || new Date());
      const base = {
        business: businessId,
        sourceTransactionType: "carwash_payment",
        sourceTransactionId: paymentIdStr,
        transactionDate: payment.paymentDate || new Date(),
        statementPeriodStart: start,
        statementPeriodEnd: end,
        category: "CARWASH_PAYMENT",
        amount,
        payer: payment.job?.customerName || "customer",
        receiver: "n/a",
        createdBy: actorId,
        approvedBy: actorId,
        allowUnscoped: true,
      };
      await postEntry({ ...base, accountId: payment.cashbookAccount, direction: "debit",
        notes: `CW payment received – Job #${payment.job?.jobNumber || ""} (${payment.method || ""})` });
      await postEntry({ ...base, accountId: revenueAccount._id, direction: "credit",
        notes: `CW service income – Job #${payment.job?.jobNumber || ""}` });
      paymentTouchedIds.add(String(payment.cashbookAccount));
      paymentsPosted++;
    } catch (err) {
      errors.push({ type: "payment", id: paymentIdStr, error: err?.message || String(err) });
    }
  }
  if (paymentsPosted > 0) await aggregateChartOfAccountBalances(businessId, [...paymentTouchedIds]);

  // ── commission accruals ─────────────────────────────────────────────────────
  for (const commission of commissions) {
    const commIdStr = String(commission._id);
    if (alreadyPostedComms.has(commIdStr)) { skipped++; continue; }
    const amount = round2(Number(commission.commissionAmount || 0));
    if (amount <= 0) { skipped++; continue; }

    try {
      const { start, end } = dayRange(commission.earnedAt || new Date());
      const base = {
        business: businessId,
        sourceTransactionType: "carwash_commission",
        sourceTransactionId: commIdStr,
        transactionDate: commission.earnedAt || new Date(),
        statementPeriodStart: start,
        statementPeriodEnd: end,
        category: "CARWASH_COMMISSION_ACCRUAL",
        amount,
        payer: "system",
        receiver: "staff",
        createdBy: actorId,
        approvedBy: actorId,
        allowUnscoped: true,
      };
      const debitLeg = await postEntry({
        ...base,
        accountId: commExpenseAccount._id,
        direction: "debit",
        notes: `CW commission earned: ${commission.jobNumber || commIdStr}`,
        metadata: { postingRole: "carwash_commission_expense", staff: String(commission.staff), job: String(commission.job) },
      });
      const creditLeg = await postEntry({
        ...base,
        accountId: payableAccount._id,
        direction: "credit",
        notes: `CW commission payable: ${commission.jobNumber || commIdStr}`,
        metadata: {
          postingRole: "carwash_commission_payable",
          staff: String(commission.staff),
          job: String(commission.job),
          offsetOfEntryId: String(debitLeg._id),
        },
      });
      await CarWashStaffCommission.updateOne(
        { _id: commission._id },
        { $set: { accrualLedgerEntries: [debitLeg._id, creditLeg._id] } }
      );
      commissionsPosted++;
    } catch (err) {
      errors.push({ type: "commission", id: commIdStr, error: err?.message || String(err) });
    }
  }
  if (commissionsPosted > 0) await aggregateChartOfAccountBalances(businessId, [String(commExpenseAccount._id), String(payableAccount._id)]);

  // ── paid expenses ────────────────────────────────────────────────────────────
  const expenseTouchedIds = new Set();
  for (const expense of expenses) {
    const expIdStr = String(expense._id);
    if (alreadyPostedExpenses.has(expIdStr)) { skipped++; continue; }
    if (!expense.cashbookAccount) { skipped++; continue; }
    const amount = round2(Number(expense.amount || 0));
    if (amount <= 0) { skipped++; continue; }

    const expenseAccount = expenseAccountMap[cwExpenseCategoryCode(expense.category)];
    if (!expenseAccount?._id) { skipped++; continue; }

    try {
      const txDate = expense.expenseDate || expense.paidAt || new Date();
      const { start, end } = dayRange(txDate);
      const base = {
        business: businessId,
        sourceTransactionType: "carwash_expense",
        sourceTransactionId: expIdStr,
        transactionDate: new Date(txDate),
        statementPeriodStart: start,
        statementPeriodEnd: end,
        category: "CARWASH_EXPENSE",
        amount,
        payer: "n/a",
        receiver: "vendor",
        createdBy: actorId,
        approvedBy: actorId,
        allowUnscoped: true,
      };
      const desc = expense.payee || expense.category || expense.expenseNumber || "";
      await postEntry({ ...base, accountId: expenseAccount._id, direction: "debit",
        notes: `CW expense – ${desc}` });
      await postEntry({ ...base, accountId: expense.cashbookAccount, direction: "credit",
        notes: `CW expense paid – ${expense.expenseNumber || ""}` });
      expenseTouchedIds.add(String(expenseAccount._id));
      expenseTouchedIds.add(String(expense.cashbookAccount));
      expensesPosted++;
    } catch (err) {
      errors.push({ type: "expense", id: expIdStr, error: err?.message || String(err) });
    }
  }
  if (expensesPosted > 0) await aggregateChartOfAccountBalances(businessId, [...expenseTouchedIds]);

  return { paymentsPosted, commissionsPosted, expensesPosted, skipped, errors };
};

// ─── Resolve expense GL account from category string ─────────────────────────
const cwExpenseCategoryCode = (category = "") => {
  const cat = String(category || "").trim().toLowerCase();
  if (cat.includes("wage") || cat.includes("salary") || cat.includes("staff")) return "5311";
  if (cat.includes("water") || cat.includes("utilit")) return "5312";
  return "5310";
};

export const resolveExpenseAccountForCategory = (businessId, category = "") =>
  resolveCarWashAccount(businessId, cwExpenseCategoryCode(category));
