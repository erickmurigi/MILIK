/**
 * Self-contained GL accounting service for the Inventory / POS module.
 *
 * Mirrors the carwash pattern:
 *   - System accounts are resolved via upsert (idempotent, never null)
 *   - Every financial event posts a balanced double-entry pair
 *   - Idempotency guard prevents duplicate entries on retry
 *   - GL failures are logged but never block the business operation
 *
 * Accounts used:
 *   1300 — Inventory / Stock on Hand     (asset)
 *   1310 — POS Receipts Control          (asset)   debit side for sales
 *   2000 — Accounts Payable – Suppliers  (liability)
 *   2190 — VAT Payable – Output Tax      (liability)
 *   4000 — POS Sales Revenue             (income)  net of VAT
 *   5000 — Cost of Goods Sold            (expense)
 *   5010 — Stock Adjustments & Write-offs(expense)
 */

import mongoose from "mongoose";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import InvSupplier from "../models/InvSupplier.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import { postEntry, postReversal } from "../../../services/ledgerPostingService.js";
import { round2 } from "../../../utils/math.js";

const INV_ACCOUNT_TEMPLATES = {
  "1300": { name: "Inventory / Stock on Hand",       type: "asset",     group: "assets",      subGroup: "Current Assets",      isHeader: false, isPosting: true  },
  "1310": { name: "POS Receipts Control",            type: "asset",     group: "assets",      subGroup: "Current Assets",      isHeader: false, isPosting: true  },
  "2000": { name: "Accounts Payable — Suppliers",    type: "liability", group: "liabilities", subGroup: "Payables",            isHeader: true,  isPosting: false },
  "2190": { name: "VAT Payable — Output Tax",        type: "liability", group: "liabilities", subGroup: "Tax Liabilities",     isHeader: false, isPosting: true  },
  "4000": { name: "POS Sales Revenue",               type: "income",    group: "income",      subGroup: "Sales Revenue",       isHeader: false, isPosting: true  },
  "5000": { name: "Cost of Goods Sold",              type: "expense",   group: "expenses",    subGroup: "Cost of Revenue",     isHeader: false, isPosting: true  },
  "5010": { name: "Stock Adjustments & Write-offs",  type: "expense",   group: "expenses",    subGroup: "Inventory Adjustments", isHeader: false, isPosting: true },
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
// Fixed system accounts (one per business+code) whose _id never changes once
// created — cached in-process so receiving N PO lines or ringing up N POS sales
// doesn't re-upsert the same handful of ChartOfAccount docs N times.

const invAccountIdCache = new Map(); // `${businessId}:${code}` -> ObjectId

const resolveInvAccount = async (businessId, code) => {
  const cacheKey = `${businessId}:${code}`;
  const cachedId = invAccountIdCache.get(cacheKey);
  if (cachedId) return { _id: cachedId };

  const tpl = INV_ACCOUNT_TEMPLATES[code];
  if (!tpl) throw new Error(`resolveInvAccount: unknown code "${code}"`);
  const acc = await ChartOfAccount.findOneAndUpdate(
    { business: businessId, code },
    {
      $setOnInsert: {
        business:     businessId,
        code,
        name:         tpl.name,
        type:         tpl.type,
        group:        tpl.group,
        subGroup:     tpl.subGroup,
        isSystem:     true,
        isPosting:    tpl.isPosting,
        isHeader:     tpl.isHeader,
        level:        0,
        balance:      0,
        moduleScopes: ["inventory"],
      },
    },
    { upsert: true, new: true }
  );
  invAccountIdCache.set(cacheKey, acc._id);
  return acc;
};

// ─── Supplier AP sub-account resolution ──────────────────────────────────────
// Each supplier gets their own posting sub-account under 2000 (AP header).
// The account is created on first use and linked back to the supplier record.

const supplierApAccountIdCache = new Map(); // supplierId -> ObjectId

export const resolveSupplierApAccount = async (businessId, supplierId) => {
  const cachedId = supplierApAccountIdCache.get(String(supplierId));
  if (cachedId) return { _id: cachedId };

  // Check supplier record first (fast path)
  const supplier = await InvSupplier.findOne({ _id: supplierId, business: businessId });
  if (!supplier) throw new Error(`Supplier ${supplierId} not found`);

  if (supplier.apAccountId) {
    const existing = await ChartOfAccount.findById(supplier.apAccountId).select("_id").lean();
    if (existing) {
      supplierApAccountIdCache.set(String(supplierId), existing._id);
      return existing;
    }
  }

  // Ensure the 2000 header exists
  const parent = await resolveInvAccount(businessId, "2000");

  // Pick the next available sub-account code under 2000
  const allSubs = await ChartOfAccount.find({
    business: businessId,
    code: { $regex: /^2000-SUP/ },
  }).select("code").lean();
  const nextSeq = allSubs.length + 1;
  const code = `2000-SUP${String(nextSeq).padStart(3, "0")}`;

  const safeName = String(supplier.name).replace(/[^\w\s&.,-]/g, "").trim().slice(0, 60);
  const account = await ChartOfAccount.findOneAndUpdate(
    { business: businessId, code },
    {
      $setOnInsert: {
        business:      businessId,
        code,
        name:          `AP — ${safeName}`,
        type:          "liability",
        group:         "liabilities",
        subGroup:      "Payables",
        parentAccount: parent._id,
        level:         1,
        isSystem:      false,
        isPosting:     true,
        isHeader:      false,
        moduleScopes:  ["inventory"],
        balance:       0,
      },
    },
    { upsert: true, new: true }
  );

  // Link back to supplier so we don't re-create next time
  await InvSupplier.updateOne({ _id: supplierId }, { $set: { apAccountId: account._id } });
  supplierApAccountIdCache.set(String(supplierId), account._id);
  return account;
};

// ─── POS Sale — revenue + VAT + COGS ─────────────────────────────────────────

/**
 * Posts for a completed POS sale:
 *   Dr 1310 POS Receipts         / Cr 4000 Sales Revenue  — net of VAT
 *                                  Cr 2190 VAT Payable     — output VAT (if any)
 *   Dr 5000 COGS                 / Cr 1300 Inventory       — total cost
 */
export const postPosSaleLedger = async ({ businessId, sale, userId }) => {
  const grandTotal = round2(Number(sale.grandTotal || 0));
  if (grandTotal <= 0) return;

  const existing = await FinancialLedgerEntry.countDocuments({
    business: businessId,
    sourceTransactionType: "pos_sale",
    sourceTransactionId: String(sale._id),
    status: { $ne: "reversed" },
  });
  if (existing > 0) return;

  const totalVat  = round2(Number(sale.totalVat || 0));
  const netRevenue = round2(grandTotal - totalVat);
  const totalCOGS = round2(
    (sale.lines || []).reduce(
      (sum, l) => sum + round2(Number(l.qty || 0) * Number(l.costPrice || 0)),
      0
    )
  );

  const { start, end } = dayRange(sale.createdAt);
  const journalGroupId = new mongoose.Types.ObjectId();

  // Resolve accounts in parallel — include VAT account only if needed
  const accountCodes = ["1310", "4000", "5000", "1300"];
  if (totalVat > 0) accountCodes.push("2190");
  const resolved = await Promise.all(accountCodes.map((c) => resolveInvAccount(businessId, c)));
  const accMap = Object.fromEntries(accountCodes.map((c, i) => [c, resolved[i]]));

  const base = {
    business: businessId,
    sourceTransactionType: "pos_sale",
    sourceTransactionId: String(sale._id),
    transactionDate: sale.createdAt || new Date(),
    statementPeriodStart: start,
    statementPeriodEnd: end,
    journalGroupId,
    category: "POS_SALE",
    createdBy: userId,
    allowUnscoped: true,
  };

  // Revenue pair — debit receipts, credit revenue + VAT payable
  const revenueEntries = [
    postEntry({ ...base, accountId: accMap["1310"]._id, direction: "debit",  amount: grandTotal,  notes: `POS sale ${sale.receiptNumber} — receipts control` }),
    postEntry({ ...base, accountId: accMap["4000"]._id, direction: "credit", amount: netRevenue,  notes: `POS sale ${sale.receiptNumber} — sales revenue (net)` }),
  ];
  if (totalVat > 0) {
    revenueEntries.push(
      postEntry({ ...base, accountId: accMap["2190"]._id, direction: "credit", amount: totalVat, notes: `POS sale ${sale.receiptNumber} — output VAT payable` })
    );
  }
  await Promise.all(revenueEntries);

  // COGS pair
  if (totalCOGS > 0) {
    const cogsGroupId = new mongoose.Types.ObjectId();
    await Promise.all([
      postEntry({ ...base, journalGroupId: cogsGroupId, accountId: accMap["5000"]._id, direction: "debit",  amount: totalCOGS, notes: `POS sale ${sale.receiptNumber} — COGS` }),
      postEntry({ ...base, journalGroupId: cogsGroupId, accountId: accMap["1300"]._id, direction: "credit", amount: totalCOGS, notes: `POS sale ${sale.receiptNumber} — inventory reduction` }),
    ]);
  }
};

// ─── POS Sale Void — reverse all entries for the original sale ────────────────

export const reversePosSaleLedger = async ({ businessId, sale, userId }) => {
  const entries = await FinancialLedgerEntry.find({
    business: businessId,
    sourceTransactionType: "pos_sale",
    sourceTransactionId: String(sale._id),
    status: { $nin: ["reversed", "void"] },
  }).select("_id").lean();

  if (!entries.length) return;

  const reason = `Void of POS sale ${sale.receiptNumber}: ${sale.voidReason || "voided"}`;
  await Promise.all(entries.map((entry) => postReversal({ entryId: entry._id, reason, userId })));
};

// ─── Purchase receipt — Dr Inventory / Cr Accounts Payable ───────────────────

/**
 * Posts one double-entry pair per goods-received stock entry:
 *   Dr 1300 Inventory / Cr 2000 Accounts Payable — qty × unitCost
 */
export const postPurchaseReceiptLedger = async ({ businessId, stockEntry, poNumber, supplierId, userId }) => {
  const amount = round2(Number(stockEntry.totalCost || 0));
  if (amount <= 0) return;

  const existing = await FinancialLedgerEntry.countDocuments({
    business: businessId,
    sourceTransactionType: "pos_purchase_receipt",
    sourceTransactionId: String(stockEntry._id),
    status: { $ne: "reversed" },
  });
  if (existing > 0) return;

  const { start, end } = dayRange(stockEntry.createdAt);
  const journalGroupId = new mongoose.Types.ObjectId();

  const [inventoryAcc, payableAcc] = await Promise.all([
    resolveInvAccount(businessId, "1300"),
    supplierId
      ? resolveSupplierApAccount(businessId, String(supplierId))
      : resolveInvAccount(businessId, "2000"),
  ]);

  const base = {
    business: businessId,
    sourceTransactionType: "pos_purchase_receipt",
    sourceTransactionId: String(stockEntry._id),
    transactionDate: stockEntry.createdAt || new Date(),
    statementPeriodStart: start,
    statementPeriodEnd: end,
    journalGroupId,
    category: "POS_PURCHASE",
    createdBy: userId,
    allowUnscoped: true,
  };

  await Promise.all([
    postEntry({ ...base, accountId: inventoryAcc._id, direction: "debit",  amount, notes: `Goods received PO ${poNumber} — inventory increase` }),
    postEntry({ ...base, accountId: payableAcc._id,   direction: "credit", amount, notes: `Goods received PO ${poNumber} — supplier payable` }),
  ]);
};

// ─── Purchase receipt reversal — used on PO cancellation ─────────────────────

/**
 * Reverses all GL entries posted for stock entries linked to a purchase order.
 * stockEntryIds = array of InvStockEntry _id strings for the received lines.
 */
export const reversePurchaseReceiptLedger = async ({ businessId, stockEntryIds, poNumber, userId }) => {
  if (!stockEntryIds?.length) return;

  const reason = `PO ${poNumber} cancelled — reversing receipt`;

  // Fetch all affected ledger entries in one query, then reverse in parallel
  const entries = await FinancialLedgerEntry.find({
    business: businessId,
    sourceTransactionType: "pos_purchase_receipt",
    sourceTransactionId: { $in: stockEntryIds.map(String) },
    status: { $nin: ["reversed", "void"] },
  }).select("_id").lean();

  await Promise.all(entries.map((entry) => postReversal({ entryId: entry._id, reason, userId })));
};

// ─── Supplier payment — Dr AP (2000) / Cr Cashbook ───────────────────────────

export const postSupplierPaymentLedger = async ({ businessId, payment, userId }) => {
  const amount = round2(Number(payment.amount || 0));
  if (amount <= 0) return;

  const existing = await FinancialLedgerEntry.countDocuments({
    business: businessId,
    sourceTransactionType: "inv_supplier_payment",
    sourceTransactionId: String(payment._id),
    status: { $ne: "reversed" },
  });
  if (existing > 0) return;

  const { start, end } = dayRange(payment.paymentDate || new Date());
  const journalGroupId = new mongoose.Types.ObjectId();

  const [payableAcc, cashbookAcc] = await Promise.all([
    payment.supplier
      ? resolveSupplierApAccount(businessId, String(payment.supplier))
      : resolveInvAccount(businessId, "2000"),
    ChartOfAccount.findOne({ _id: payment.cashbookAccountId, business: businessId }).lean(),
  ]);
  if (!cashbookAcc) throw new Error(`Cashbook account ${payment.cashbookAccountId} not found`);

  const narration = payment.reference
    ? `Supplier payment ref ${payment.reference}`
    : `Supplier payment ${payment.paymentNumber}`;

  const base = {
    business: businessId,
    sourceTransactionType: "inv_supplier_payment",
    sourceTransactionId: String(payment._id),
    transactionDate: payment.paymentDate || new Date(),
    statementPeriodStart: start,
    statementPeriodEnd: end,
    journalGroupId,
    category: "SUPPLIER_PAYMENT",
    createdBy: userId,
    allowUnscoped: true,
  };

  await Promise.all([
    postEntry({ ...base, accountId: payableAcc._id,  direction: "debit",  amount, notes: `${narration} — AP cleared` }),
    postEntry({ ...base, accountId: cashbookAcc._id, direction: "credit", amount, notes: `${narration} — paid from ${cashbookAcc.name}` }),
  ]);
};

export const reverseSupplierPaymentLedger = async ({ businessId, paymentId, userId }) => {
  const entries = await FinancialLedgerEntry.find({
    business: businessId,
    sourceTransactionType: "inv_supplier_payment",
    sourceTransactionId: String(paymentId),
    status: { $nin: ["reversed", "void"] },
  }).select("_id").lean();
  await Promise.all(entries.map((entry) => postReversal({ entryId: entry._id, reason: "Supplier payment voided", userId })));
};

// ─── Stock adjustment / write-off ─────────────────────────────────────────────

/**
 * Posts GL for manual stock entries (adjustment, writeoff, opening, return).
 *   Positive qty (stock added):   Dr 1300 Inventory / Cr 5010 Adjustments
 *   Negative qty (stock removed): Dr 5010 Adjustments / Cr 1300 Inventory
 */
export const postStockAdjustmentLedger = async ({ businessId, stockEntry, userId }) => {
  const GL_TYPES = new Set(["adjustment", "writeoff", "opening", "return"]);
  if (!GL_TYPES.has(stockEntry.type)) return;

  const amount = round2(Number(stockEntry.totalCost || 0));
  if (amount <= 0) return;

  const existing = await FinancialLedgerEntry.countDocuments({
    business: businessId,
    sourceTransactionType: "pos_stock_adjustment",
    sourceTransactionId: String(stockEntry._id),
    status: { $ne: "reversed" },
  });
  if (existing > 0) return;

  const { start, end } = dayRange(stockEntry.createdAt);
  const journalGroupId = new mongoose.Types.ObjectId();

  const [inventoryAcc, adjAcc] = await Promise.all([
    resolveInvAccount(businessId, "1300"),
    resolveInvAccount(businessId, "5010"),
  ]);

  const isStockIn = Number(stockEntry.qty) > 0;
  const typeLabel = stockEntry.type.replace(/_/g, " ");

  const base = {
    business: businessId,
    sourceTransactionType: "pos_stock_adjustment",
    sourceTransactionId: String(stockEntry._id),
    transactionDate: stockEntry.createdAt || new Date(),
    statementPeriodStart: start,
    statementPeriodEnd: end,
    journalGroupId,
    category: "POS_STOCK_ADJUSTMENT",
    createdBy: userId,
    allowUnscoped: true,
  };

  if (isStockIn) {
    await Promise.all([
      postEntry({ ...base, accountId: inventoryAcc._id, direction: "debit",  amount, notes: `Stock ${typeLabel} — inventory increase` }),
      postEntry({ ...base, accountId: adjAcc._id,       direction: "credit", amount, notes: `Stock ${typeLabel} — adjustment offset` }),
    ]);
  } else {
    await Promise.all([
      postEntry({ ...base, accountId: adjAcc._id,       direction: "debit",  amount, notes: `Stock ${typeLabel} — write-off / reduction` }),
      postEntry({ ...base, accountId: inventoryAcc._id, direction: "credit", amount, notes: `Stock ${typeLabel} — inventory reduction` }),
    ]);
  }
};
