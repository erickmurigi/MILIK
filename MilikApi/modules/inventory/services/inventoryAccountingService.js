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
 *   1310 — POS Receipts Control          (asset)   debit side for sales revenue
 *   2000 — Accounts Payable – Suppliers  (liability)
 *   4000 — POS Sales Revenue             (income)
 *   5000 — Cost of Goods Sold            (expense)
 *   5010 — Stock Adjustments & Write-offs(expense)
 */

import mongoose from "mongoose";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import { postEntry, postReversal } from "../../../services/ledgerPostingService.js";

const INV_ACCOUNT_TEMPLATES = {
  "1300": { name: "Inventory / Stock on Hand",        type: "asset",     group: "assets",      subGroup: "Current Assets" },
  "1310": { name: "POS Receipts Control",             type: "asset",     group: "assets",      subGroup: "Current Assets" },
  "2000": { name: "Accounts Payable – Suppliers",     type: "liability", group: "liabilities", subGroup: "Trade Payables" },
  "4000": { name: "POS Sales Revenue",                type: "income",    group: "income",      subGroup: "Sales Revenue" },
  "5000": { name: "Cost of Goods Sold",               type: "expense",   group: "expenses",    subGroup: "Cost of Revenue" },
  "5010": { name: "Stock Adjustments & Write-offs",   type: "expense",   group: "expenses",    subGroup: "Inventory Adjustments" },
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

const resolveInvAccount = async (businessId, code) => {
  const tpl = INV_ACCOUNT_TEMPLATES[code];
  if (!tpl) throw new Error(`resolveInvAccount: unknown code "${code}"`);
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
        moduleScopes: ["inventory"],
      },
    },
    { upsert: true, new: true }
  );
};

// ─── POS Sale — revenue + COGS ────────────────────────────────────────────────

/**
 * Posts two double-entry pairs when a POS sale is completed:
 *   Dr 1310 POS Receipts / Cr 4000 Sales Revenue  — grandTotal
 *   Dr 5000 COGS         / Cr 1300 Inventory       — total cost of goods sold
 */
export const postPosSaleLedger = async ({ businessId, sale, userId }) => {
  const amount = round2(Number(sale.grandTotal || 0));
  if (amount <= 0) return;

  // Idempotency: skip if already posted
  const existing = await FinancialLedgerEntry.countDocuments({
    business: businessId,
    sourceTransactionType: "pos_sale",
    sourceTransactionId: String(sale._id),
    status: { $ne: "reversed" },
  });
  if (existing > 0) return;

  const totalCOGS = round2(
    (sale.lines || []).reduce(
      (sum, l) => sum + round2(Number(l.qty || 0) * Number(l.costPrice || 0)),
      0
    )
  );

  const { start, end } = dayRange(sale.createdAt);
  const journalGroupId = new mongoose.Types.ObjectId();

  const [receiptsAcc, revenueAcc, cogsAcc, inventoryAcc] = await Promise.all([
    resolveInvAccount(businessId, "1310"),
    resolveInvAccount(businessId, "4000"),
    resolveInvAccount(businessId, "5000"),
    resolveInvAccount(businessId, "1300"),
  ]);

  const base = {
    business: businessId,
    sourceTransactionType: "pos_sale",
    sourceTransactionId: String(sale._id),
    transactionDate: sale.createdAt || new Date(),
    statementPeriodStart: start,
    statementPeriodEnd: end,
    journalGroupId,
    createdBy: userId,
    allowUnscoped: true,
  };

  // Revenue pair
  await Promise.all([
    postEntry({ ...base, accountId: receiptsAcc._id, direction: "debit",  amount, category: "POS_SALE", notes: `POS sale ${sale.receiptNumber} — receipts control` }),
    postEntry({ ...base, accountId: revenueAcc._id,  direction: "credit", amount, category: "POS_SALE", notes: `POS sale ${sale.receiptNumber} — sales revenue` }),
  ]);

  // COGS pair (only if there is a measurable cost)
  if (totalCOGS > 0) {
    const cogsGroupId = new mongoose.Types.ObjectId();
    await Promise.all([
      postEntry({ ...base, journalGroupId: cogsGroupId, accountId: cogsAcc._id,       direction: "debit",  amount: totalCOGS, category: "POS_SALE", notes: `POS sale ${sale.receiptNumber} — COGS` }),
      postEntry({ ...base, journalGroupId: cogsGroupId, accountId: inventoryAcc._id,  direction: "credit", amount: totalCOGS, category: "POS_SALE", notes: `POS sale ${sale.receiptNumber} — inventory reduction` }),
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
  }).lean();

  if (!entries.length) return;

  const reason = `Void of POS sale ${sale.receiptNumber}: ${sale.voidReason || "voided"}`;
  for (const entry of entries) {
    await postReversal({ entryId: entry._id, reason, userId });
  }
};

// ─── Purchase receipt — Dr Inventory / Cr Accounts Payable ───────────────────

/**
 * Posts one double-entry pair per goods-received stock entry:
 *   Dr 1300 Inventory / Cr 2000 Accounts Payable — qty × unitCost
 * stockEntry = saved InvStockEntry document.
 */
export const postPurchaseReceiptLedger = async ({ businessId, stockEntry, poNumber, userId }) => {
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
    resolveInvAccount(businessId, "2000"),
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

// ─── Stock adjustment / write-off ─────────────────────────────────────────────

/**
 * Posts GL for manual stock entries (adjustment, writeoff, opening, return).
 *   Positive qty (stock added):  Dr 1300 Inventory / Cr 5010 Adjustments
 *   Negative qty (stock removed): Dr 5010 Adjustments / Cr 1300 Inventory
 * stockEntry = saved InvStockEntry document.
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
