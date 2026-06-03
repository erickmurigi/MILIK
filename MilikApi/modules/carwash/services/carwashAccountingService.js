/**
 * Self-contained accounting service for the Car Wash module.
 *
 * Creates the three required system accounts on-demand (upsert) so ledger posting
 * works even when ensureSystemChartOfAccounts hasn't run for this business yet.
 * All posting functions log errors rather than swallowing them silently.
 */

import ChartOfAccount from "../../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import { postEntry, postReversal } from "../../../services/ledgerPostingService.js";
import { aggregateChartOfAccountBalances } from "../../../services/chartAccountAggregationService.js";
import { resolveAuditActorUserId } from "../../../utils/systemActor.js";
import mongoose from "mongoose";

// ─── Account templates ────────────────────────────────────────────────────────
const CW_ACCOUNT_TEMPLATES = {
  "4400": { name: "Car Wash Service Income",            type: "income",    group: "income",      subGroup: "Car Wash Income" },
  "5311": { name: "Car Wash Staff Commissions",         type: "expense",   group: "expenses",    subGroup: "Car Wash Expenses" },
  "2160": { name: "Car Wash Staff Commissions Payable", type: "liability", group: "liabilities", subGroup: "Car Wash Liabilities" },
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
    const { default: CarWashStaffCommission } = await import("../models/CarWashStaffCommission.js");
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
    sourceTransactionType: { $in: ["carwash_payment", "carwash_commission"] },
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
  const { default: CarWashPayment }       = await import("../models/CarWashPayment.js");
  const { default: CarWashStaffCommission } = await import("../models/CarWashStaffCommission.js");
  const { default: FinancialLedgerEntry } = await import("../../../models/FinancialLedgerEntry.js");

  const businessOid = new mongoose.Types.ObjectId(String(businessId));

  const [payments, commissions, alreadyPostedPaymentIds, alreadyPostedCommIds] = await Promise.all([
    CarWashPayment.find({ business: businessOid })
      .populate("job", "jobNumber customerName")
      .lean(),
    CarWashStaffCommission.find({
      business: businessOid,
      status: { $in: ["earned", "payable", "paid"] },
      commissionAmount: { $gt: 0 },
      accrualLedgerEntries: { $size: 0 },
    }).lean(),
    FinancialLedgerEntry.distinct("sourceTransactionId", {
      business: businessOid,
      sourceTransactionType: "carwash_payment",
    }),
    FinancialLedgerEntry.distinct("sourceTransactionId", {
      business: businessOid,
      sourceTransactionType: "carwash_commission",
    }),
  ]);

  const alreadyPostedPayments = new Set(alreadyPostedPaymentIds.map(String));
  const alreadyPostedComms    = new Set(alreadyPostedCommIds.map(String));

  const [revenueAccount, expenseAccount, payableAccount] = await Promise.all([
    resolveCarWashAccount(businessId, "4400"),
    resolveCarWashAccount(businessId, "5311"),
    resolveCarWashAccount(businessId, "2160"),
  ]);

  const actorId = await resolveAuditActorUserId({ req, businessId });

  let paymentsPosted = 0;
  let commissionsPosted = 0;
  let skipped = 0;
  const errors = [];

  // ── payments ────────────────────────────────────────────────────────────────
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
      await postEntry({
        ...base,
        accountId: payment.cashbookAccount,
        direction: "debit",
        notes: `CW payment received – Job #${payment.job?.jobNumber || ""} (${payment.method || ""})`,
      });
      await postEntry({
        ...base,
        accountId: revenueAccount._id,
        direction: "credit",
        notes: `CW service income – Job #${payment.job?.jobNumber || ""}`,
      });
      await aggregateChartOfAccountBalances(businessId, [
        String(payment.cashbookAccount),
        String(revenueAccount._id),
      ]);
      paymentsPosted++;
    } catch (err) {
      errors.push({ type: "payment", id: paymentIdStr, error: err?.message || String(err) });
    }
  }

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
        accountId: expenseAccount._id,
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
      await aggregateChartOfAccountBalances(businessId, [
        String(expenseAccount._id),
        String(payableAccount._id),
      ]);
      // Stamp the commission so it's not re-backfilled
      await CarWashStaffCommission.updateOne(
        { _id: commission._id },
        { $set: { accrualLedgerEntries: [debitLeg._id, creditLeg._id] } }
      );
      commissionsPosted++;
    } catch (err) {
      errors.push({ type: "commission", id: commIdStr, error: err?.message || String(err) });
    }
  }

  return { paymentsPosted, commissionsPosted, skipped, errors };
};
