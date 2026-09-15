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
import { findSystemAccountByCode } from "../../../services/chartOfAccountsService.js";
import { round2 } from "../../../utils/math.js";
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
  "4401": { name: "Car Wash Staff Damage Recovery",       type: "income",    group: "income",      subGroup: "Car Wash Income" },
  "2162": { name: "Car Wash Customer Credit Deposits",    type: "liability", group: "liabilities", subGroup: "Car Wash Liabilities" },
  "4402": { name: "Car Wash Unclaimed Customer Credits",  type: "income",    group: "income",      subGroup: "Car Wash Income" },
};


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
// creditAmount — optional excess paid above the job price; split into liability instead of revenue
// taxAmount, jobPrice — optional VAT fields from the job; if provided, VAT is split out of revenue
export const postCarWashPaymentLedger = async ({ businessId, payment, cashbookAccountId, job, userId, creditAmount = 0, taxAmount = 0, jobPrice = 0 }) => {
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

    const credit = round2(Math.max(0, Number(creditAmount || 0)));
    // Revenue-attributable portion (before VAT split)
    const serviceAmount = round2(amount - credit);

    // Inclusive VAT split: VAT is embedded in price — split proportionally per payment
    const jobTax  = round2(Number(taxAmount  || 0));
    const jobGross = round2(Number(jobPrice   || 0));
    const vatFraction = jobTax > 0 && jobGross > 0 ? jobTax / jobGross : 0;
    const vatForPayment = vatFraction > 0 ? round2(serviceAmount * vatFraction) : 0;
    const revenueAmount = round2(serviceAmount - vatForPayment);

    const accountsToResolve = [resolveCarWashAccount(businessId, "4400")];
    if (credit > 0) accountsToResolve.push(resolveCarWashAccount(businessId, "2162"));
    if (vatForPayment > 0) accountsToResolve.push(findSystemAccountByCode(businessId, "2140").catch(() => null));
    const [revenueAccount, creditLiabilityAccountOrVat, vatAccountOrUndef] = await Promise.all(accountsToResolve);
    // Resolve correctly when credit > 0 and vatForPayment > 0
    const creditLiabilityAccount = credit > 0 ? creditLiabilityAccountOrVat : null;
    const vatAccount = vatForPayment > 0 ? (credit > 0 ? vatAccountOrUndef : creditLiabilityAccountOrVat) : null;

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
      payer: job?.customerName || "customer",
      receiver: "n/a",
      createdBy: actorId,
      approvedBy: actorId,
      allowUnscoped: true,
    };

    // Dr Cashbook — full cash received
    await postEntry({ ...base, accountId: cashbookAccountId, amount, direction: "debit",
      notes: `CW payment received – Job #${job?.jobNumber || ""} (${payment.method || ""})` });

    // Cr Revenue — net of VAT
    if (revenueAmount > 0) {
      await postEntry({ ...base, accountId: revenueAccount._id, amount: revenueAmount, direction: "credit",
        notes: `CW service income – Job #${job?.jobNumber || ""}` });
    }

    // Cr VAT Payable (2140) — VAT portion collected
    if (vatForPayment > 0 && vatAccount) {
      await postEntry({ ...base, accountId: vatAccount._id, amount: vatForPayment, direction: "credit",
        notes: `CW output VAT – Job #${job?.jobNumber || ""}` });
    } else if (vatForPayment > 0 && !vatAccount) {
      // VAT account not found — post all to revenue as fallback (no silent loss)
      await postEntry({ ...base, accountId: revenueAccount._id, amount: vatForPayment, direction: "credit",
        notes: `CW output VAT (no VAT acct) – Job #${job?.jobNumber || ""}` });
    }

    // Cr Customer Credit Liability — excess held for customer
    if (credit > 0 && creditLiabilityAccount) {
      await postEntry({ ...base, accountId: creditLiabilityAccount._id, amount: credit, direction: "credit",
        notes: `CW customer credit created – Job #${job?.jobNumber || ""}` });
    }

    const touchedIds = [String(cashbookAccountId), String(revenueAccount._id)];
    if (vatAccount) touchedIds.push(String(vatAccount._id));
    if (creditLiabilityAccount) touchedIds.push(String(creditLiabilityAccount._id));
    await aggregateChartOfAccountBalances(businessId, touchedIds);
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
  req, payout, cashbookAccount, commissionAmount, netCash, savingsHeld, damagesHeld = 0,
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
  const [payableAccount, savingsAccount, damageRecoveryAccount] = await Promise.all([
    resolveCarWashAccount(businessId, "2160"),
    resolveCarWashAccount(businessId, "2161"),
    resolveCarWashAccount(businessId, "4401"),
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

  // Cr 4401 — damages recovered from payout
  if (round2(damagesHeld) > 0 && damageRecoveryAccount?._id) {
    const damageLeg = await postEntry({
      ...base,
      accountId: damageRecoveryAccount._id,
      amount: round2(damagesHeld),
      direction: "credit",
      notes: `CW staff damage recovery withheld from payout ${payout.payoutNumber}`,
      metadata: {
        postingRole: "carwash_damage_recovery",
        staff: String(payout.staff),
        offsetOfEntryId: String(debitLeg._id),
      },
    });
    entryIds.push(damageLeg._id);
  }

  const accountsToAggregate = [
    String(payableAccount._id),
    String(cashbookAccount._id),
    String(savingsAccount._id),
    ...(damageRecoveryAccount?._id ? [String(damageRecoveryAccount._id)] : []),
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

// ─── Resolve expense GL account from category string ─────────────────────────
const cwExpenseCategoryCode = (category = "") => {
  const cat = String(category || "").trim().toLowerCase();
  if (cat.includes("wage") || cat.includes("salary") || cat.includes("staff")) return "5311";
  if (cat.includes("water") || cat.includes("utilit")) return "5312";
  return "5310";
};

export const resolveExpenseAccountForCategory = (businessId, category = "") =>
  resolveCarWashAccount(businessId, cwExpenseCategoryCode(category));

// ─── Reverse a customer credit creation GL entry ─────────────────────────────
// Called when a payment is deleted and its linked CarWashCustomerCredit must be voided.
// Only applies to M-Pesa overpayment credits (GL type "carwash_customer_credit_created").
// Manual overpayment credits are already covered by reverseCarWashPaymentLedger.
export const reverseCarWashCustomerCreditCreationLedger = async ({ businessId, creditDocId, req = null }) => {
  try {
    const { default: FinancialLedgerEntry } = await import("../../../models/FinancialLedgerEntry.js");
    const entries = await FinancialLedgerEntry.find({
      business: new mongoose.Types.ObjectId(String(businessId)),
      sourceTransactionType: "carwash_customer_credit_created",
      sourceTransactionId: String(creditDocId),
      status: { $ne: "reversed" },
    }).lean();
    if (!entries.length) return;
    const actorId = await resolveAuditActorUserId({ req, businessId });
    const touchedIds = new Set();
    for (const entry of entries) {
      await reverseCwEntry(entry, actorId, "Customer credit reversed — source payment deleted");
      touchedIds.add(String(entry.accountId));
    }
    if (touchedIds.size) await aggregateChartOfAccountBalances(businessId, [...touchedIds]);
  } catch (err) {
    console.error("[CW Accounting] Customer credit GL reversal error creditDoc=%s: %s", creditDocId, err?.message || err);
  }
};

// ─── Customer credit created (overpayment): Dr Cashbook / Cr Liability (2162) ──
// Called when cash/M-Pesa overpayment has no prepaid wallet to absorb it.
// Records the liability so the supervisor sees the credit on the next visit.
export const postCarWashCustomerCreditCreationLedger = async ({ businessId, creditDoc, cashbookAccountId, userId }) => {
  const amount = round2(Number(creditDoc.amount || 0));
  if (!cashbookAccountId || amount <= 0) return;

  try {
    const existingCount = await FinancialLedgerEntry.countDocuments({
      business: new mongoose.Types.ObjectId(String(businessId)),
      sourceTransactionType: "carwash_customer_credit_created",
      sourceTransactionId: String(creditDoc._id),
      status: { $ne: "reversed" },
    });
    if (existingCount > 0) return;

    const [cashbookAccount, creditLiabilityAccount] = await Promise.all([
      ChartOfAccount.findOne({ _id: cashbookAccountId, business: businessId }).lean(),
      resolveCarWashAccount(businessId, "2162"),
    ]);
    if (!cashbookAccount) return;

    const { start, end } = dayRange(new Date());
    const actorId = userId && mongoose.Types.ObjectId.isValid(String(userId))
      ? userId : await resolveAuditActorUserId({ req: null, businessId });

    const base = {
      business: businessId,
      sourceTransactionType: "carwash_customer_credit_created",
      sourceTransactionId: String(creditDoc._id),
      transactionDate: new Date(),
      statementPeriodStart: start,
      statementPeriodEnd: end,
      category: "CARWASH_CUSTOMER_CREDIT",
      amount,
      payer: "customer_overpayment",
      receiver: "n/a",
      createdBy: actorId,
      approvedBy: actorId,
      allowUnscoped: true,
    };

    const plate = creditDoc.plates?.[0] || "customer";
    await postEntry({ ...base, accountId: cashbookAccount._id, direction: "debit",
      notes: `CW M-Pesa overpayment received – credit for ${plate}` });
    await postEntry({ ...base, accountId: creditLiabilityAccount._id, direction: "credit",
      notes: `CW customer credit created – ${plate} KES ${amount}` });
    await aggregateChartOfAccountBalances(businessId, [String(cashbookAccount._id), String(creditLiabilityAccount._id)]);
  } catch (err) {
    console.error("[CW Accounting] postCarWashCustomerCreditCreationLedger failed creditDoc=%s: %s", creditDoc._id, err?.message);
  }
};

// ─── Customer credit applied to a job: Dr Liability (2162) / Cr Revenue (4400) ─
export const postCarWashCreditAppliedLedger = async ({ businessId, credit, appliedToJob, userId }) => {
  const amount = round2(Number(credit.amount || 0));
  if (amount <= 0) return;
  // Dr 2162 (Customer Credit Liability) / Cr 4400 (Service Revenue)
  // Recognises revenue at the point the customer uses their credit balance.
  const [creditLiabilityAccount, revenueAccount] = await Promise.all([
    resolveCarWashAccount(businessId, "2162"),
    resolveCarWashAccount(businessId, "4400"),
  ]);
  const actorId = userId && mongoose.Types.ObjectId.isValid(String(userId))
    ? userId : await resolveAuditActorUserId({ req: null, businessId });
  const { start, end } = dayRange(new Date());
  const base = {
    business: businessId,
    sourceTransactionType: "carwash_credit_applied",
    sourceTransactionId: String(credit._id),
    transactionDate: new Date(),
    statementPeriodStart: start,
    statementPeriodEnd: end,
    category: "CARWASH_CREDIT_APPLIED",
    amount,
    payer: "customer_credit",
    receiver: "n/a",
    createdBy: actorId,
    approvedBy: actorId,
    allowUnscoped: true,
  };
  await postEntry({ ...base, accountId: creditLiabilityAccount._id, direction: "debit",
    notes: `CW customer credit applied – Job #${appliedToJob?.jobNumber || ""}` });
  await postEntry({ ...base, accountId: revenueAccount._id, direction: "credit",
    notes: `CW service income (credit applied) – Job #${appliedToJob?.jobNumber || ""}` });
  await aggregateChartOfAccountBalances(businessId, [String(creditLiabilityAccount._id), String(revenueAccount._id)]);
};

// ─── Credit cash refund: Dr Liability (2162) / Cr Cashbook ──────────────────
export const postCarWashCreditRefundLedger = async ({ businessId, credit, cashbookAccountId, userId }) => {
  const amount = round2(Number(credit.amount || 0));
  if (amount <= 0) return;
  // Dr 2162 (Customer Credit Liability) — liability extinguished
  // Cr Cashbook                         — cash physically paid out to customer
  const [creditLiabilityAccount, cashbookAccount] = await Promise.all([
    resolveCarWashAccount(businessId, "2162"),
    ChartOfAccount.findById(cashbookAccountId).lean(),
  ]);
  if (!cashbookAccount) throw new Error(`Cashbook account ${cashbookAccountId} not found`);
  const actorId = userId && mongoose.Types.ObjectId.isValid(String(userId))
    ? userId : await resolveAuditActorUserId({ req: null, businessId });
  const { start, end } = dayRange(new Date());
  const base = {
    business: businessId,
    sourceTransactionType: "carwash_credit_refund",
    sourceTransactionId: String(credit._id),
    transactionDate: new Date(),
    statementPeriodStart: start,
    statementPeriodEnd: end,
    category: "CARWASH_CREDIT_REFUND",
    amount,
    payer: "n/a",
    receiver: "customer_refund",
    createdBy: actorId,
    approvedBy: actorId,
    allowUnscoped: true,
  };
  await postEntry({ ...base, accountId: creditLiabilityAccount._id, direction: "debit",
    notes: `CW customer credit refunded – cash payout` });
  await postEntry({ ...base, accountId: cashbookAccount._id, direction: "credit",
    notes: `CW customer credit cash refund` });
  await aggregateChartOfAccountBalances(businessId, [String(creditLiabilityAccount._id), String(cashbookAccount._id)]);
};

// ─── Credit write-off: Dr Liability (2162) / Cr Unclaimed Income (4402) ────────
// Throws on failure — callers must NOT update document status if this rejects.
export const postCarWashCreditWriteOffLedger = async ({ businessId, credit, userId }) => {
  const amount = round2(Number(credit.amount || 0));
  if (amount <= 0) return [];
  const [creditLiabilityAccount, unclaimedIncomeAccount] = await Promise.all([
    resolveCarWashAccount(businessId, "2162"),
    resolveCarWashAccount(businessId, "4402"),
  ]);
  const actorId = userId && mongoose.Types.ObjectId.isValid(String(userId))
    ? userId : await resolveAuditActorUserId({ req: null, businessId });
  const { start, end } = dayRange(new Date());
  const base = {
    business: businessId,
    sourceTransactionType: "carwash_credit_writeoff",
    sourceTransactionId: String(credit._id),
    transactionDate: new Date(),
    statementPeriodStart: start,
    statementPeriodEnd: end,
    category: "CARWASH_CREDIT_WRITEOFF",
    amount,
    payer: "n/a",
    receiver: "n/a",
    createdBy: actorId,
    approvedBy: actorId,
    allowUnscoped: true,
  };
  const [debitLeg, creditLeg] = await Promise.all([
    postEntry({ ...base, accountId: creditLiabilityAccount._id, direction: "debit",
      notes: `CW customer credit written off – unclaimed` }),
    postEntry({ ...base, accountId: unclaimedIncomeAccount._id, direction: "credit",
      notes: `CW unclaimed customer credit income` }),
  ]);
  await aggregateChartOfAccountBalances(businessId, [String(creditLiabilityAccount._id), String(unclaimedIncomeAccount._id)]);
  return [debitLeg._id, creditLeg._id];
};

// ─── Reverse a credit write-off: Dr Unclaimed Income (4402) / Cr Liability (2162) ─
// Throws on failure — callers must NOT restore document status if this rejects.
export const reverseCarWashCreditWriteOffLedger = async ({ businessId, credit, req = null }) => {
  if (!credit.writeOffLedgerEntries?.length) {
    throw new Error("No write-off ledger entries recorded for this credit — cannot reverse");
  }
  const actorId = await resolveAuditActorUserId({ req, businessId });
  const entries = await FinancialLedgerEntry.find({
    _id: { $in: credit.writeOffLedgerEntries },
    business: new mongoose.Types.ObjectId(String(businessId)),
    status: { $ne: "reversed" },
  }).lean();
  if (!entries.length) {
    throw new Error("Write-off ledger entries already reversed or not found");
  }
  const touchedIds = new Set();
  await Promise.all(entries.map(async (entry) => {
    const { originalEntry, reversalEntry } = await reverseCwEntry(entry, actorId, `CW credit write-off reversed — customer claimed`);
    if (originalEntry?.accountId) touchedIds.add(String(originalEntry.accountId));
    if (reversalEntry?.accountId)  touchedIds.add(String(reversalEntry.accountId));
  }));
  if (touchedIds.size) await aggregateChartOfAccountBalances(businessId, [...touchedIds]);
};
