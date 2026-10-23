/**
 * Self-contained GL accounting service for the Property Sales module.
 *
 * Every account below is resolved through the single resolvePSAccount(businessId, code) choke point,
 * which checks SaleSettings.accountingDefaults for a per-business override before auto-creating its own
 * system account — so a company can redirect any of these codes to its own ChartOfAccount numbering
 * (Settings > Property Sales > Accounting Defaults) without touching any of the posting logic below.
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
 *   4430 — Commission Income — Agency Fees   (income)   Cr for the company's own commission — immediately, for a
 *          tier whose deal has no advocate-trust money (the company already holds the cash); deferred via 2186
 *          for a tier whose deal DOES have advocate-trust money, until postAgencyCommissionPayout
 *   2186 — Agency Commission Payable (Unremitted) (liability) Cr at tier release instead of 4430 when deferred
 *          (see 4430 above); cleared (Dr) by postAgencyCommissionPayout, which recognizes the deferred 4430
 *          income AND clears the corresponding slice of 1314 in the same posting — an advocate-trust-funded
 *          agency commission is never recognized as the company's own income until the advocate actually pays it
 *   1312 — Broker Commission Clawback Receivable (asset) Dr when a deal cancels after a tier was already paid out
 *   1313 — Owner Expense Recoverable         (asset)    Dr for costs the company pays on an owner's behalf;
 *          cleared (Cr) by postAdvocateRechargeRemittance — real cash the advocate sends specifically to
 *          recover it, Dr cashbook / Cr 1313
 *   1314 — Advocate Trust Receivable         (asset)    Dr side for a payment collected into an advocate's own
 *          trust account instead of the company's cash (collectionMethod "advocate_trust"); cleared (Cr) when
 *          the advocate pays the broker/owner/company directly from trust (postPropertySaleCommissionPayout /
 *          postSaleOwnerPayout / postAgencyCommissionPayout)
 */

import mongoose from "mongoose";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import SaleSettings from "../models/SaleSettings.js";
import { postEntry, postEntries, postReversal } from "../../../services/ledgerPostingService.js";
import { resolveWhtPayableAccount } from "../../../services/withholdingTaxService.js";
import { round2 } from "../../../utils/math.js";
import { dealAdvocateTrustBalance } from "./dealProgress.js";

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
  "2186": { name: "Agency Commission Payable (Unremitted)", type: "liability", group: "liabilities", subGroup: "Owner Payables" },
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

// Exported so a settings-save can drop a stale cached id the moment a business reconfigures which real
// ChartOfAccount backs a code — resolvePSAccount's cache otherwise never expires, so without this an
// override wouldn't take effect until the process restarted. Called with just `businessId` to clear
// every code at once (simplest correct choice for a bulk accounting-defaults save).
export const clearPSAccountCache = (businessId, code = null) => {
  if (code) { accountIdCache.delete(`${businessId}:${code}`); return; }
  for (const key of accountIdCache.keys()) {
    if (key.startsWith(`${businessId}:`)) accountIdCache.delete(key);
  }
};

// Exported so other modules (e.g. the PMS PaymentVoucher controller's `sale_owner_expense`
// category, which debits 1313 Owner Expense Recoverable) can self-register against the same
// fixed system accounts without duplicating the upsert-and-cache pattern.
export const resolvePSAccount = async (businessId, code) => {
  const cacheKey = `${businessId}:${code}`;
  const cachedId = accountIdCache.get(cacheKey);
  if (cachedId) return { _id: cachedId };

  const tpl = PS_ACCOUNT_TEMPLATES[code];
  if (!tpl) throw new Error(`resolvePSAccount: unknown code "${code}"`);

  // A business can redirect this code to one of its own ChartOfAccount rows instead of the
  // auto-created system default (SaleSettings.accountingDefaults, set via Settings > Accounting
  // Defaults) — same override-then-fallback shape as PMS's companyAccountingDefaultsService, but
  // reached through this single choke point so every account in the module picks it up uniformly.
  const settings = await SaleSettings.findOne({ business: businessId }).select("accountingDefaults").lean();
  const overrideId = settings?.accountingDefaults?.get ? settings.accountingDefaults.get(code) : settings?.accountingDefaults?.[code];
  if (overrideId) {
    const overrideAcc = await ChartOfAccount.findOne({
      _id: overrideId, business: businessId, type: tpl.type, isPosting: { $ne: false }, isHeader: { $ne: true },
    }).lean();
    if (overrideAcc) {
      accountIdCache.set(cacheKey, overrideAcc._id);
      return overrideAcc;
    }
  }

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

// Exposed so the settings controller can build the "which accounts can be overridden" UI from the exact
// same registry resolvePSAccount uses — never a second, hand-maintained copy that could drift out of sync.
export const listPSAccountTemplates = () =>
  Object.entries(PS_ACCOUNT_TEMPLATES).map(([code, tpl]) => ({ code, name: tpl.name, type: tpl.type }));

// Validates a submitted override before it's saved — must resolve to a real, postable ChartOfAccount of
// the EXACT type the code's role requires (an income code can never be redirected to a liability account,
// etc.), same guard PMS's validateAccountingDefaultAccount applies to its own overrides.
export const validatePSAccountOverride = async ({ businessId, code, rawValue }) => {
  const tpl = PS_ACCOUNT_TEMPLATES[code];
  if (!tpl) throw new Error(`Unknown property-sale account code "${code}"`);
  const normalized = String(rawValue || "").trim();
  if (!normalized) return null;

  const query = { business: businessId, type: tpl.type, isPosting: { $ne: false }, isHeader: { $ne: true } };
  if (/^[a-f\d]{24}$/i.test(normalized)) query._id = normalized;
  else query.code = normalized;

  const account = await ChartOfAccount.findOne(query).select("_id code name type").lean();
  if (!account) throw new Error(`${tpl.name} selection is invalid, the wrong account type, or no longer available for this company.`);
  return account;
};

// ─── WHT handling responsibility ──────────────────────────────────────────────
//
// Who withholds/remits WHT when an advocate physically pays a broker's commission out of trust
// funds: "advocate" (self-remits to KRA under their own registration — no 2141 leg on our books)
// or "agent" (forwards the withheld amount to the company, which remits via the existing WHT
// machinery — 2141 gets credited, exactly like a normal direct-pay commission). A per-advocate
// override (SaleAdvocate.whtHandledBy) wins; otherwise falls back to the company-wide default
// (SaleSettings.advocateDefaults.whtHandledBy, itself defaulting to "agent" — today's behavior).
export const resolveWhtHandler = async (businessId, advocateDoc) => {
  if (advocateDoc?.whtHandledBy) return advocateDoc.whtHandledBy;
  const settings = await SaleSettings.findOne({ business: businessId }).select("advocateDefaults").lean();
  return settings?.advocateDefaults?.whtHandledBy || "agent";
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
  // A staged commission (non-empty releaseSchedule) accrues ONLY via postPropertySaleCommissionTierRelease,
  // one entry per tier (sourceTransactionType "property_sale_commission_tier") — never this lump type.
  // This guard lives here, not just in each caller, because two separate callers (closeDeal's pending-
  // commission sweep, and postPropertySaleCommissionPayout's lazy-accrual-on-payout) have independently
  // called this function for a staged commission without checking releaseSchedule first, and this
  // function's own idempotency check below only ever looks for the LUMP type — it can't see tier entries
  // and would happily post a second, full, duplicate accrual on top of what the tiers already posted.
  if (commission.releaseSchedule?.length) return;

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
//
// `source` ("company_cashbook", default) / `whtHandledBy` ("agent", default) are additive —
// omitting both reproduces today's exact posting (Dr 2180 / Cr cashbook-or-5321(net) / Cr 2141(wht)).
//
//   source "advocate_trust": the credit leg goes to 1314 Advocate Trust Receivable instead of the
//   cashbook/5321 fallback — the advocate is paying the broker directly out of trust funds.
//
//   whtHandledBy "advocate" (only meaningful together with source "advocate_trust"): the advocate
//   self-remits the withheld tax to KRA under their own registration, so no 2141 leg is posted on
//   our books at all. The full gross commission amount is then treated as having left the trust
//   pool in one leg (Dr 2180 / Cr 1314, both for the full amount) — this keeps the journal balanced
//   and matches dealAdvocateTrustBalance's own treatment of an advocate-trust-sourced commission's
//   gross commissionAmount as what left the trust pool (see dealProgress.js).
// `payout` is one entry already pushed onto commission.payouts — its own slice of commissionAmount
// (gross), with whtAmount already computed proportionally by the caller (commissionsController.js).
// Keyed per-payout (`${commission._id}:payout:${payout._id}`) so a commission paid off across several
// partial disbursements posts — and can be reversed — one clean journal per disbursement, not one
// shared idempotency guard that only ever allowed a single lump-sum payout.
export const postPropertySaleCommissionPayout = async ({ businessId, commission, userId, payout, whtHandledBy = "agent" }) => {
  // A staged commission's accrual was already posted tier-by-tier (sourceTransactionType
  // "property_sale_commission_tier", one entry per tier) — postPropertySaleCommissionAccrual's own
  // idempotency guard only ever looks for the LUMP type ("property_sale_commission") and would never
  // see those, so calling it here for a staged commission posts a second, full, duplicate accrual on
  // top of what the tiers already posted. Only a non-staged (immediate-release) commission still needs
  // the lump accrual posted lazily here, on its first payout.
  if (!commission.releaseSchedule?.length) {
    await postPropertySaleCommissionAccrual({ businessId, commission, userId });
  }

  const amount = round2(Number(payout.amount || 0));
  if (amount <= 0) return;

  const sourceTransactionType = "property_sale_commission_payout";
  const sourceTransactionId = `${commission._id}:payout:${payout._id}`;

  const existing = await FinancialLedgerEntry.countDocuments({
    business: businessId,
    sourceTransactionType,
    sourceTransactionId,
    status: { $ne: "reversed" },
    category: { $ne: "REVERSAL" },
  });
  if (existing > 0) return;

  const effectiveDate = payout.date ? new Date(payout.date) : new Date();
  const { start, end } = dayRange(effectiveDate);
  const journalGroupId = new mongoose.Types.ObjectId();

  const isAdvocateTrust = payout.source === "advocate_trust";
  // Self-remitting WHT only changes anything when the advocate is the one physically disbursing the
  // cash — a company_cashbook payout always remits via 2141, same as before, regardless of this flag.
  const advocateSelfRemitsWht = isAdvocateTrust && whtHandledBy === "advocate";

  const [payableAcc, creditAcc] = await Promise.all([
    resolvePSAccount(businessId, "2180"),
    isAdvocateTrust
      ? resolvePSAccount(businessId, "1314")
      : payout.cashbook
        ? ChartOfAccount.findById(payout.cashbook).lean()
        : resolvePSAccount(businessId, "5321"),
  ]);

  if (!creditAcc) throw new Error("Commission payout cashbook account not found — GL posting aborted");

  // This slice's own proportional WHT, already computed by the caller — the cashbook only loses the
  // net, and the tax owed to KRA (2141) is this slice's share, not the whole commission's.
  const whtAmount = round2(Number(payout.whtAmount || 0));
  if (whtAmount >= amount) throw new Error("Withholding tax must be less than the payout amount — GL posting aborted");
  const whtAcc = whtAmount > 0 && !advocateSelfRemitsWht ? await resolveWhtPayableAccount({ businessId }) : null;
  const creditAmount = whtAcc ? round2(amount - whtAmount) : amount;

  const ref = commission.commissionNumber || String(commission._id);

  const base = {
    business: businessId,
    sourceTransactionType,
    sourceTransactionId,
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
    { ...base, accountId: creditAcc._id,  direction: "credit", amount: creditAmount, notes: `Agent commission disbursed — ${ref}` },
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

// Reverses every payout journal for the commission — only reachable once status is "paid" (fully
// disbursed), so this is still an all-or-nothing undo, not a per-partial-payout correction. Falls back
// to the bare commission id for a commission paid off in one shot before partial payouts existed, whose
// entries were keyed that way (no `payouts` array to derive per-payout ids from).
export const reversePropertySaleCommissionPayout = async ({ businessId, commission, userId, reason }) => {
  const sourceTransactionIds = commission.payouts?.length
    ? commission.payouts.map((p) => `${commission._id}:payout:${p._id}`)
    : [String(commission._id)];

  const payoutEntries = await FinancialLedgerEntry.find({
    business: businessId,
    sourceTransactionType: "property_sale_commission_payout",
    sourceTransactionId: { $in: sourceTransactionIds },
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

// Company's own commission tier — Dr Owner Clearing / Cr [Commission Income, or Agency Commission
// Payable if deferred]. The owner's balance is reduced immediately either way (the cost is real the
// moment it's earned) — what's deferred is only whether the COMPANY recognizes it as its own income
// right away, which depends on whether the deal's proceeds are sitting in an advocate's trust account
// (not yet in the company's hands) or were collected directly. Sets tierRelease.deferred on the passed
// subdocument so the caller's own .save() persists which branch was taken — read later by
// outstandingAgencyCommissions() and the payout cap, and by the owner statement's red/green status.
export const postPropertySaleOwnerCommissionTierRelease = async ({ businessId, ownerCommission, tierRelease, userId }) => {
  const amount = round2(Number(tierRelease.amount || 0));
  if (amount <= 0) return;

  // Deferral only applies to a STAGED commission (a releaseSchedule), where a tier fires AFTER real
  // payment progress — by then, the deal's trust balance (if any) genuinely reflects what's been
  // collected so far. An immediate-release commission (no schedule) fires its one tier at DEAL CREATION,
  // before any payment exists at all — there's nothing yet to check, and immediate-release's whole
  // defining behavior is recognizing eagerly regardless of payment status, so it keeps doing exactly
  // that rather than silently gaining a deferral it was never designed to have.
  const isDeferred = Boolean(ownerCommission.releaseSchedule?.length) && (await dealAdvocateTrustBalance(businessId, ownerCommission.deal)).collected > 0;
  tierRelease.deferred = isDeferred;

  const sourceTransactionType = "property_sale_owner_commission_tier";
  const sourceTransactionId = `${ownerCommission._id}:tier:${tierRelease._id}`;

  const existing = await FinancialLedgerEntry.countDocuments({
    business: businessId, sourceTransactionType, sourceTransactionId,
    status: { $ne: "reversed" }, category: { $ne: "REVERSAL" },
  });
  if (existing > 0) return;

  const { start, end } = dayRange(tierRelease.accruedAt);
  const journalGroupId = new mongoose.Types.ObjectId();
  const [clearingAcc, creditAcc] = await Promise.all([
    resolvePSAccount(businessId, "2185"),
    resolvePSAccount(businessId, isDeferred ? "2186" : "4430"),
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
    { ...base, accountId: creditAcc._id,   direction: "credit", amount, notes: isDeferred ? `Commission income deferred pending advocate payout — ${ref}` : `Commission income — ${ref}` },
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

// ─── Agency commission payout — the one event that finally recognizes deferred commission income ────
//
// Only ever settles DEFERRED tiers (tierReleases[].deferred === true — a deal with advocate-trust
// money). A single 4-leg entry does both things at once: recognizes the income that was deferred at
// release time, AND clears the matching slice of the advocate's trust receivable, since the cash is
// always coming out of the advocate's trust holdings (deferral only ever happens when it is):
//   Dr 2186 Agency Commission Payable (Unremitted)   [amount]   — clears the release-time placeholder
//   Cr 4430 Commission Income — Agency Fees           [amount]   — NOW recognized, for real
//   Dr [cashbook]                                      [amount]   — cash arrives
//   Cr 1314 Advocate Trust Receivable                  [amount]   — clears the matching trust receivable
// `payout` is a SaleAgencyCommissionPayout document — its own `allocations` breakdown (which specific
// commissions this covers) is audit metadata only, same as SaleOwnerPayout's; the GL posts the FULL
// amount in one go regardless of how many commissions it's split across.
export const postAgencyCommissionPayout = async ({ businessId, payout, userId, cashbookAccountId }) => {
  const amount = round2(Number(payout.amount || 0));
  if (amount <= 0) return;

  const sourceTransactionType = "property_sale_agency_commission_payout";
  const sourceTransactionId = String(payout._id);

  const existing = await FinancialLedgerEntry.countDocuments({
    business: businessId, sourceTransactionType, sourceTransactionId,
    status: { $ne: "reversed" }, category: { $ne: "REVERSAL" },
  });
  if (existing > 0) return;

  const { start, end } = dayRange(payout.date || payout.createdAt);
  const journalGroupId = new mongoose.Types.ObjectId();

  const [deferredAcc, incomeAcc, debitAcc, trustAcc] = await Promise.all([
    resolvePSAccount(businessId, "2186"),
    resolvePSAccount(businessId, "4430"),
    cashbookAccountId ? ChartOfAccount.findById(cashbookAccountId).lean() : resolvePSAccount(businessId, "1311"),
    resolvePSAccount(businessId, "1314"),
  ]);
  if (!debitAcc) throw new Error("Cashbook account not found — GL posting aborted");

  const ref = payout.payoutNumber || String(payout._id);

  const base = {
    business: businessId, sourceTransactionType, sourceTransactionId,
    transactionDate: payout.date || payout.createdAt || new Date(),
    statementPeriodStart: start, statementPeriodEnd: end, journalGroupId,
    category: "PROPERTY_SALE_AGENCY_COMMISSION_PAYOUT", createdBy: userId, allowUnscoped: true,
  };

  await postEntries([
    { ...base, accountId: deferredAcc._id, direction: "debit",  amount, notes: `Agency commission payable cleared — ${ref}` },
    { ...base, accountId: incomeAcc._id,   direction: "credit", amount, notes: `Commission income recognized — ${ref}` },
    { ...base, accountId: debitAcc._id,    direction: "debit",  amount, notes: `Agency commission received from advocate — ${ref}` },
    { ...base, accountId: trustAcc._id,    direction: "credit", amount, notes: `Advocate trust receivable cleared — ${ref}` },
  ]);
};

export const reverseAgencyCommissionPayout = async ({ businessId, payout, userId, reason }) =>
  reverseEntriesFor({
    businessId,
    sourceTransactionType: "property_sale_agency_commission_payout",
    sourceTransactionId: String(payout._id),
    userId,
    reason: reason || `Agency commission payout reversed — ${payout.payoutNumber || payout._id}`,
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

// ─── Clawback correction on cancellation — commission already (partially) paid out in cash ──────────
//
// cancelDeal reverses a cancelled commission's ENTIRE accrual via reversePropertySaleCommissionTierRelease
// / reversePropertySaleCommissionAccrual (Dr 2180 commissionAmount / Cr Expense commissionAmount) exactly
// as it always has — that part is unchanged and correct when nothing was ever paid out. But the ORIGINAL
// payout (if any) already debited 2180 by paidOutAmount when the cash went out (Dr 2180 / Cr cashbook),
// so a FULL reversal on top of that leaves 2180 overdrawn by exactly paidOutAmount (a negative liability —
// the original accrual is undone twice: once by the payout's own clearing debit, once more by this
// reversal). This entry corrects exactly that: Dr 1312 Broker Commission Clawback Receivable / Cr 2180,
// for paidOutAmount only — bringing 2180 back to zero and standing up the receivable to recover the cash
// that physically left and can't be un-sent. Deliberately does NOT touch Expense (the full reversal above
// already zeroed it out correctly on its own).
export const postPropertySaleCommissionClawbackOnCancellation = async ({ businessId, commission, amount, userId, reason }) => {
  const clawbackAmount = round2(Number(amount || 0));
  if (clawbackAmount <= 0) return;

  const sourceTransactionType = "property_sale_commission_cancel_clawback";
  const sourceTransactionId = String(commission._id);

  const existing = await FinancialLedgerEntry.countDocuments({
    business: businessId, sourceTransactionType, sourceTransactionId,
    status: { $ne: "reversed" }, category: { $ne: "REVERSAL" },
  });
  if (existing > 0) return;

  const { start, end } = dayRange(new Date());
  const journalGroupId = new mongoose.Types.ObjectId();
  const [receivableAcc, payableAcc] = await Promise.all([
    resolvePSAccount(businessId, "1312"),
    resolvePSAccount(businessId, "2180"),
  ]);
  const ref = commission.commissionNumber || String(commission._id);
  const msg = reason || `Commission clawed back — deal cancelled after payout — ${ref}`;

  const base = {
    business: businessId, sourceTransactionType, sourceTransactionId,
    transactionDate: new Date(),
    statementPeriodStart: start, statementPeriodEnd: end, journalGroupId,
    category: "PROPERTY_SALE_COMMISSION_CLAWBACK", createdBy: userId, allowUnscoped: true,
  };

  await postEntries([
    { ...base, accountId: receivableAcc._id, direction: "debit",  amount: clawbackAmount, notes: msg },
    { ...base, accountId: payableAcc._id,    direction: "credit", amount: clawbackAmount, notes: msg },
  ]);
};

// ─── Advocate recharge remittance — direct cash settlement of 1313 Owner Expense Recoverable ────────
//
// Real money an advocate sends Pink House specifically to recover one or more named "sale_owner_expense"
// vouchers (SaleAdvocateRechargeRemittance) — NOT trust money, so there is no 1314 involvement at all:
// Dr [cashbook] / Cr 1313, for the full remittance amount, in one
// posting regardless of how many vouchers its `allocations` cover (they all share the same two
// accounts, so splitting the GL per voucher would add nothing — the allocations themselves, kept on the
// SaleAdvocateRechargeRemittance document, are what drives outstandingRecoverableExpenseVouchers' own
// per-voucher netting).
export const postAdvocateRechargeRemittance = async ({ businessId, remittance, userId, cashbookAccountId }) => {
  const amount = round2(Number(remittance.amount || 0));
  if (amount <= 0) return;

  const sourceTransactionType = "property_sale_advocate_recharge_remittance";
  const sourceTransactionId = String(remittance._id);

  const existing = await FinancialLedgerEntry.countDocuments({
    business: businessId, sourceTransactionType, sourceTransactionId,
    status: { $ne: "reversed" }, category: { $ne: "REVERSAL" },
  });
  if (existing > 0) return;

  const { start, end } = dayRange(remittance.date || remittance.createdAt);
  const journalGroupId = new mongoose.Types.ObjectId();

  const [debitAcc, recoverableAcc] = await Promise.all([
    cashbookAccountId ? ChartOfAccount.findById(cashbookAccountId).lean() : resolvePSAccount(businessId, "1311"),
    resolvePSAccount(businessId, "1313"),
  ]);
  if (!debitAcc) throw new Error("Cashbook account not found — GL posting aborted");

  const ref = remittance.remittanceNumber || String(remittance._id);

  const base = {
    business: businessId, sourceTransactionType, sourceTransactionId,
    transactionDate: remittance.date || remittance.createdAt || new Date(),
    statementPeriodStart: start, statementPeriodEnd: end, journalGroupId,
    category: "PROPERTY_SALE_ADVOCATE_RECHARGE_REMITTANCE", createdBy: userId, allowUnscoped: true,
  };

  await postEntries([
    { ...base, accountId: debitAcc._id,       direction: "debit",  amount, notes: `Advocate recharge remittance received — ${ref}` },
    { ...base, accountId: recoverableAcc._id, direction: "credit", amount, notes: `Owner expense recoverable settled by advocate — ${ref}` },
  ]);
};

export const reverseAdvocateRechargeRemittance = async ({ businessId, remittance, userId, reason }) =>
  reverseEntriesFor({
    businessId,
    sourceTransactionType: "property_sale_advocate_recharge_remittance",
    sourceTransactionId: String(remittance._id),
    userId,
    reason: reason || `Advocate recharge remittance reversed — ${remittance.remittanceNumber || remittance._id}`,
  });

// ─── Owner payout — clears part of 2185 Owner Clearing by actually paying the owner ──────────────────
//
// Called when the owner's net sale proceeds are physically paid out — either from the company's own
// cashbook, or (source "advocate_trust") directly by the conveyancing advocate out of trust funds.
//   Dr 2185 Owner Clearing / Cr 1314 Advocate Trust Receivable (advocate_trust)
//   Dr 2185 Owner Clearing / Cr [cashbook] (company_cashbook, default — fallback 1311)
//
// Posts for the FULL claim (payout.amount + payout.cgtAmount), not just the cash the owner physically
// receives: CGT withheld at completion still leaves the trust/cashbook (paid to KRA on the owner's
// behalf) and still reduces the owner's 2185 claim by the same amount — it just never becomes a
// liability on THIS company's own books, since we're never the remitting party for the owner's personal
// tax (unlike WHT on a broker's commission, which the agent itself may remit). cgtAmount is 0 for any
// payout that doesn't involve CGT, so this is a no-op widening of the existing amount for everyone else.

export const postSaleOwnerPayout = async ({ businessId, payout, userId, cashbookAccountId }) => {
  const amount = round2(Number(payout.amount || 0) + Number(payout.cgtAmount || 0));
  if (amount <= 0) return;

  const sourceTransactionType = "property_sale_owner_payout";
  const sourceTransactionId = String(payout._id);

  const existing = await FinancialLedgerEntry.countDocuments({
    business: businessId, sourceTransactionType, sourceTransactionId,
    status: { $ne: "reversed" }, category: { $ne: "REVERSAL" },
  });
  if (existing > 0) return;

  const { start, end } = dayRange(payout.date || payout.createdAt);
  const journalGroupId = new mongoose.Types.ObjectId();

  const isAdvocateTrust = payout.source === "advocate_trust";
  const [clearingAcc, creditAcc] = await Promise.all([
    resolvePSAccount(businessId, "2185"),
    isAdvocateTrust
      ? resolvePSAccount(businessId, "1314")
      : cashbookAccountId
        ? ChartOfAccount.findById(cashbookAccountId).lean()
        : resolvePSAccount(businessId, "1311"),
  ]);
  if (!creditAcc) throw new Error("Cashbook account not found — GL posting aborted");

  const ref = payout.payoutNumber || String(payout._id);
  const cgtNote = Number(payout.cgtAmount || 0) > 0 ? ` (incl. KES ${round2(payout.cgtAmount)} CGT withheld)` : "";

  const base = {
    business: businessId, sourceTransactionType, sourceTransactionId,
    transactionDate: payout.date || payout.createdAt || new Date(),
    statementPeriodStart: start, statementPeriodEnd: end, journalGroupId,
    category: "PROPERTY_SALE_OWNER_PAYOUT", createdBy: userId, allowUnscoped: true,
  };

  await postEntries([
    { ...base, accountId: clearingAcc._id, direction: "debit",  amount, notes: `Owner net proceeds paid out — ${ref}${cgtNote}` },
    { ...base, accountId: creditAcc._id,   direction: "credit", amount, notes: (isAdvocateTrust ? `Advocate trust receivable cleared — owner payout ${ref}` : `Owner payout disbursed — ${ref}`) + cgtNote },
  ]);
};

export const reverseSaleOwnerPayout = async ({ businessId, payout, userId, reason }) =>
  reverseEntriesFor({
    businessId,
    sourceTransactionType: "property_sale_owner_payout",
    sourceTransactionId: String(payout._id),
    userId,
    reason: reason || `Owner payout reversed — ${payout.payoutNumber || payout._id}`,
  });
