import mongoose from "mongoose";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import RentPayment from "../../models/RentPayment.js";
import TenantInvoice from "../../models/TenantInvoice.js";
import LandlordReceipt from "../../models/LandlordReceipt.js";
import PaymentVoucher from "../../models/PaymentVoucher.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import JournalEntry from "../../models/JournalEntry.js";
import Unit from "../../models/Unit.js";
import Property from "../../models/Property.js";
import GLHealthRun from "../../models/GLHealthRun.js";
import { postEntry } from "../../services/ledgerPostingService.js";
import { aggregateChartOfAccountBalances } from "../../services/chartAccountAggregationService.js";
import { ensureSystemChartOfAccounts, findSystemAccountByCode } from "../../services/chartOfAccountsService.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Batch-fetch human-readable reference numbers for a list of unbalanced groups.
// Groups the sourceIds by sourceType and does one query per type — no N+1.
const enrichGroupsWithSourceRef = async (groups) => {
  if (!groups.length) return groups;

  // bucket by type
  const byType = {};
  for (const g of groups) {
    const t = (g.sourceType || "").toLowerCase();
    if (!g.sourceId || !mongoose.Types.ObjectId.isValid(String(g.sourceId))) continue;
    if (!byType[t]) byType[t] = [];
    byType[t].push(new mongoose.Types.ObjectId(String(g.sourceId)));
  }

  // per-type batch lookups
  const refMap  = {}; // sourceId(string) → ref label
  const foundSet = new Set(); // sourceIds that actually exist in the DB

  const lookup = async (type, ids, Model, refField) => {
    if (!ids?.length) return;
    const docs = await Model.find({ _id: { $in: ids } }).select(`_id ${refField}`).lean();
    for (const d of docs) {
      const key = String(d._id);
      foundSet.add(key);
      refMap[key] = d[refField] || null;
    }
  };

  await Promise.all([
    lookup("rent_payment",    byType["rent_payment"],    RentPayment,    "receiptNumber"),
    lookup("receipt",         byType["receipt"],          RentPayment,    "receiptNumber"),
    lookup("tenant_invoice",  byType["tenant_invoice"],   TenantInvoice,  "invoiceNumber"),
    lookup("invoice",         byType["invoice"],          TenantInvoice,  "invoiceNumber"),
    lookup("landlord_receipt",byType["landlord_receipt"], LandlordReceipt,"receiptNumber"),
    lookup("payment_voucher", byType["payment_voucher"],  PaymentVoucher, "voucherNo"),
    lookup("journal_entry",   byType["journal_entry"],    JournalEntry,   "journalNo"),
  ]);

  return groups.map((g) => {
    const sid = g.sourceId ? String(g.sourceId) : null;
    const hasValidId = sid && mongoose.Types.ObjectId.isValid(sid);
    return {
      ...g,
      sourceRef:      sid ? (refMap[sid] || null)           : null,
      // true = we looked it up and it's gone from the DB; false/undefined = not looked up
      sourceOrphaned: hasValidId ? !foundSet.has(sid) : false,
    };
  });
};

const appendRepairLog = async (healthRunId, repairEntry) => {
  if (!healthRunId || !mongoose.Types.ObjectId.isValid(String(healthRunId))) return;
  await GLHealthRun.findByIdAndUpdate(healthRunId, { $push: { repairs: repairEntry } }).catch(() => {});
};

export const checkInvoiceLedgerEntries = async (req, res) => {
  try {
    const { propertyId } = req.params;
    const { period } = req.query;
    const businessId = req.user?.company;

    if (!businessId) {
      return res.status(400).json({ error: "Business context required" });
    }

    let periodStart;
    let periodEnd;
    if (period) {
      const [year, month] = period.split("-").map(Number);
      periodStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
      periodEnd = new Date(year, month, 0, 23, 59, 59, 999);
    }

    const invoiceQuery = { business: businessId };
    if (propertyId) invoiceQuery.property = propertyId;
    if (periodStart && periodEnd) invoiceQuery.invoiceDate = { $gte: periodStart, $lte: periodEnd };

    const invoices = await TenantInvoice.find(invoiceQuery)
      .populate("tenant", "name")
      .populate("unit", "unitNumber property")
      .lean();

    const invoiceIds = invoices.map((i) => String(i._id));
    const allLedgerEntries = invoiceIds.length
      ? await FinancialLedgerEntry.find({
          business: businessId,
          sourceTransactionType: "invoice",
          sourceTransactionId: { $in: invoiceIds },
          status: { $ne: "void" },
        }).lean()
      : [];

    const ledgerByInvoiceId = new Map();
    for (const entry of allLedgerEntries) {
      const key = String(entry.sourceTransactionId);
      if (!ledgerByInvoiceId.has(key)) ledgerByInvoiceId.set(key, []);
      ledgerByInvoiceId.get(key).push(entry);
    }

    const diagnostics = invoices.map((invoice) => {
      const ledgerEntries = ledgerByInvoiceId.get(String(invoice._id)) || [];
      return {
        invoiceId: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
        tenant: invoice.tenant?.name || "Unknown",
        unit: invoice.unit?.unitNumber || "Unknown",
        amount: invoice.amount,
        category: invoice.category,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        status: invoice.status,
        ledgerCount: ledgerEntries.length,
        hasLedgerEntry: ledgerEntries.length > 0,
        ledgerEntries,
      };
    });

    return res.status(200).json({
      diagnostics,
      summary: {
        totalInvoices: diagnostics.length,
        invoicesWithLedger: diagnostics.filter((row) => row.hasLedgerEntry).length,
        invoicesWithoutLedger: diagnostics.filter((row) => !row.hasLedgerEntry).length,
        invoicesWithUnexpectedLegCount: diagnostics.filter((row) => row.ledgerCount !== 2).length,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

const resolveTenantReceivableAccount = async (businessId) => {
  await ensureSystemChartOfAccounts(businessId);

  const exact = await findSystemAccountByCode(businessId, "1200");
  if (exact) return exact;

  const fallback = await ChartOfAccount.findOne({
    business: businessId,
    type: "asset",
    $or: [
      { name: { $regex: "^tenant receivable", $options: "i" } },
      { name: { $regex: "accounts receivable", $options: "i" } },
      { name: { $regex: "receivable", $options: "i" } },
    ],
  }).lean();

  if (!fallback) {
    throw new Error("Tenant receivable account not found for invoice reposting.");
  }

  return fallback;
};

export const repostInvoicesToLedger = async (req, res) => {
  try {
    const { propertyId, period } = req.body;
    const businessId = req.user?.company;
    const userId = req.user?._id || req.user?.id;

    if (!businessId || !userId) {
      return res.status(400).json({ error: "Authentication required" });
    }

    let periodStart;
    let periodEnd;
    if (period) {
      const [year, month] = period.split("-").map(Number);
      periodStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
      periodEnd = new Date(year, month, 0, 23, 59, 59, 999);
    }

    const invoiceQuery = { business: businessId };
    if (propertyId) invoiceQuery.property = propertyId;
    if (periodStart && periodEnd) invoiceQuery.invoiceDate = { $gte: periodStart, $lte: periodEnd };

    const invoices = await TenantInvoice.find(invoiceQuery).lean();
    let posted = 0;
    let skipped = 0;
    const errors = [];
    const touchedAccountIds = new Set();

    // Batch-fetch all existing entries and resolve receivable account once.
    const invoiceIds = invoices.map((i) => String(i._id));
    const existingEntriesAll = invoiceIds.length
      ? await FinancialLedgerEntry.find({
          business: businessId,
          sourceTransactionType: "invoice",
          sourceTransactionId: { $in: invoiceIds },
          status: { $ne: "void" },
        }).lean()
      : [];

    const existingEntriesByInvoiceId = new Map();
    for (const entry of existingEntriesAll) {
      const key = String(entry.sourceTransactionId);
      if (!existingEntriesByInvoiceId.has(key)) existingEntriesByInvoiceId.set(key, []);
      existingEntriesByInvoiceId.get(key).push(entry);
    }

    const needsPosting = invoices.filter((inv) => !existingEntriesByInvoiceId.has(String(inv._id)));
    for (const entry of existingEntriesAll) {
      entry.accountId && touchedAccountIds.add(String(entry.accountId));
    }
    skipped = invoices.length - needsPosting.length;

    const receivableAccount = needsPosting.length
      ? await resolveTenantReceivableAccount(businessId)
      : null;

    for (const invoice of needsPosting) {
      try {
        const txDate = invoice.invoiceDate ? new Date(invoice.invoiceDate) : new Date();
        const monthStart = new Date(txDate.getFullYear(), txDate.getMonth(), 1, 0, 0, 0, 0);
        const monthEnd = new Date(txDate.getFullYear(), txDate.getMonth() + 1, 0, 23, 59, 59, 999);
        const journalGroupId = invoice.journalGroupId || undefined;

        const receivableEntry = await postEntry({
          business: invoice.business,
          property: invoice.property,
          landlord: invoice.landlord,
          tenant: invoice.tenant,
          unit: invoice.unit,
          sourceTransactionType: "invoice",
          sourceTransactionId: String(invoice._id),
          transactionDate: txDate,
          statementPeriodStart: monthStart,
          statementPeriodEnd: monthEnd,
          category: invoice.category,
          amount: Math.abs(Number(invoice.amount || 0)),
          direction: "debit",
          debit: Math.abs(Number(invoice.amount || 0)),
          credit: 0,
          accountId: receivableAccount._id,
          journalGroupId,
          payer: "tenant",
          receiver: "manager",
          notes: `Rebuilt receivable leg for invoice ${invoice.invoiceNumber}`,
          metadata: {
            includeInLandlordStatement: true,
            includeInCategoryTotals: true,
            rebuiltByDiagnostics: true,
          },
          createdBy: userId,
          approvedBy: userId,
          approvedAt: new Date(),
          status: "approved",
        });

        let incomeEntry;
        try {
          incomeEntry = await postEntry({
            business: invoice.business,
            property: invoice.property,
            landlord: invoice.landlord,
            tenant: invoice.tenant,
            unit: invoice.unit,
            sourceTransactionType: "invoice",
            sourceTransactionId: String(invoice._id),
            transactionDate: txDate,
            statementPeriodStart: monthStart,
            statementPeriodEnd: monthEnd,
            category: invoice.category,
            amount: Math.abs(Number(invoice.amount || 0)),
            direction: "credit",
            debit: 0,
            credit: Math.abs(Number(invoice.amount || 0)),
            accountId: invoice.chartAccount,
            journalGroupId,
            payer: "tenant",
            receiver: "manager",
            notes: `Rebuilt income leg for invoice ${invoice.invoiceNumber}`,
            metadata: {
              includeInLandlordStatement: false,
              includeInCategoryTotals: false,
              rebuiltByDiagnostics: true,
            },
            createdBy: userId,
            approvedBy: userId,
            approvedAt: new Date(),
            status: "approved",
          });
        } catch (incomeErr) {
          // Income leg failed — void the receivable leg to prevent an orphan debit entry
          await FinancialLedgerEntry.findByIdAndUpdate(receivableEntry._id, { $set: { status: "void" } });
          throw incomeErr;
        }

        touchedAccountIds.add(String(receivableEntry.accountId || ""));
        touchedAccountIds.add(String(incomeEntry.accountId || ""));
        posted += 1;
      } catch (err) {
        errors.push({
          invoiceId: invoice._id,
          invoiceNumber: invoice.invoiceNumber,
          error: err.message,
        });
      }
    }

    if (touchedAccountIds.size > 0) {
      await aggregateChartOfAccountBalances(businessId, Array.from(touchedAccountIds).filter(Boolean));
    }

    return res.json({
      success: true,
      posted,
      skipped,
      errors,
      message: `Rebuilt ledger for ${posted} invoice(s); skipped ${skipped} invoice(s) that already had ledger entries.`,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Repost failed" });
  }
};

export const recomputeChartBalances = async (req, res) => {
  try {
    const businessId = req.user?.company;
    if (!businessId) {
      return res.status(400).json({ error: "Business context required" });
    }

    const accounts = await ChartOfAccount.find({ business: businessId }).select("_id").lean();
    const updated = await aggregateChartOfAccountBalances(
      businessId,
      accounts.map((account) => account._id)
    );

    return res.json({
      success: true,
      count: updated.length,
      message: "Chart of account balances were recomputed from immutable ledger entries.",
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Balance recompute failed" });
  }
};

export const checkLedgerBalance = async (req, res) => {
  try {
    const businessId = req.user?.company;
    if (!businessId) {
      return res.status(400).json({ error: "Business context required" });
    }

    const STATUSES = ["approved", "reversed"];

    // Overall debit vs credit totals
    const [totals] = await FinancialLedgerEntry.aggregate([
      { $match: { business: businessId, status: { $in: STATUSES } } },
      {
        $group: {
          _id: null,
          totalDebit: {
            $sum: {
              $cond: [{ $gt: ["$debit", 0] }, "$debit", {
                $cond: [{ $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "debit"] }, { $ifNull: ["$amount", 0] }, 0],
              }],
            },
          },
          totalCredit: {
            $sum: {
              $cond: [{ $gt: ["$credit", 0] }, "$credit", {
                $cond: [{ $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "credit"] }, { $ifNull: ["$amount", 0] }, 0],
              }],
            },
          },
          count: { $sum: 1 },
        },
      },
    ]);

    const totalDebit = Number(totals?.totalDebit || 0);
    const totalCredit = Number(totals?.totalCredit || 0);
    const difference = totalDebit - totalCredit;
    const balanced = Math.abs(difference) < 0.005;

    // Find unbalanced journal groups
    const groupResults = await FinancialLedgerEntry.aggregate([
      { $match: { business: businessId, status: { $in: STATUSES }, journalGroupId: { $ne: null } } },
      {
        $group: {
          _id: "$journalGroupId",
          sourceTransactionType: { $first: "$sourceTransactionType" },
          sourceTransactionId: { $first: "$sourceTransactionId" },
          firstEntry: { $min: "$transactionDate" },
          debitSum: {
            $sum: {
              $cond: [{ $gt: ["$debit", 0] }, "$debit", {
                $cond: [{ $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "debit"] }, { $ifNull: ["$amount", 0] }, 0],
              }],
            },
          },
          creditSum: {
            $sum: {
              $cond: [{ $gt: ["$credit", 0] }, "$credit", {
                $cond: [{ $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "credit"] }, { $ifNull: ["$amount", 0] }, 0],
              }],
            },
          },
          entryCount: { $sum: 1 },
        },
      },
      {
        $addFields: { diff: { $subtract: ["$debitSum", "$creditSum"] } },
      },
      {
        $match: { diff: { $not: { $gt: -0.005, $lt: 0.005 } } },
      },
      { $sort: { firstEntry: -1 } },
      { $limit: 50 },
    ]);

    return res.json({
      success: true,
      summary: {
        totalDebit,
        totalCredit,
        difference,
        balanced,
        entryCount: totals?.count || 0,
      },
      unbalancedGroups: groupResults.map((g) => ({
        journalGroupId: g._id,
        sourceTransactionType: g.sourceTransactionType,
        sourceTransactionId: g.sourceTransactionId,
        date: g.firstEntry,
        debit: g.debitSum,
        credit: g.creditSum,
        difference: g.diff,
        entryCount: g.entryCount,
      })),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Ledger balance check failed" });
  }
};

export const checkUtilityReceiptLedgerEntries = async (req, res) => {
  try {
    const { propertyId, landlordId, periodStart, periodEnd } = req.query;
    const match = {
      status: "approved",
      category: { $in: ["UTILITY_RECEIPT_MANAGER", "UTILITY_RECEIPT_LANDLORD"] },
    };

    if (propertyId) match.property = propertyId;
    if (landlordId) match.landlord = landlordId;
    if (periodStart || periodEnd) {
      match.transactionDate = {};
      if (periodStart) match.transactionDate.$gte = new Date(periodStart);
      if (periodEnd) match.transactionDate.$lte = new Date(periodEnd);
    }

    const entries = await FinancialLedgerEntry.find(match).lean();
    return res.json({ count: entries.length, entries });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// ─── GL INTEGRITY REPORT ────────────────────────────────────────────────────
// Comprehensive check: unbalanced groups, orphaned entries, inactive account
// usage, negative normal-side balances, and missing critical system accounts.
export const runIntegrityReport = async (req, res) => {
  try {
    const businessId =
      req.query?.business || req.query?.company ||
      req.body?.business || req.body?.company ||
      req.user?.company;

    if (!businessId) return res.status(400).json({ error: "Business context required" });

    const bizId = new mongoose.Types.ObjectId(String(businessId));
    const ACTIVE_STATUSES = ["approved"];

    // 1. Overall balance (debits must equal credits)
    const [totals] = await FinancialLedgerEntry.aggregate([
      { $match: { business: bizId, status: { $in: ACTIVE_STATUSES } } },
      {
        $group: {
          _id: null,
          totalDebit: { $sum: "$debit" },
          totalCredit: { $sum: "$credit" },
          count: { $sum: 1 },
        },
      },
    ]);
    const totalDebit = Number(totals?.totalDebit || 0);
    const totalCredit = Number(totals?.totalCredit || 0);
    const glDifference = totalDebit - totalCredit;
    const glBalanced = Math.abs(glDifference) < 0.01;

    // 2. Unbalanced journal groups (debit leg ≠ credit leg)
    const unbalancedGroups = await FinancialLedgerEntry.aggregate([
      { $match: { business: bizId, status: { $in: ACTIVE_STATUSES }, journalGroupId: { $ne: null } } },
      {
        $group: {
          _id: "$journalGroupId",
          debitSum: { $sum: "$debit" },
          creditSum: { $sum: "$credit" },
          entryCount: { $sum: 1 },
          firstDate: { $min: "$transactionDate" },
          sourceType: { $first: "$sourceTransactionType" },
          sourceId: { $first: "$sourceTransactionId" },
        },
      },
      { $addFields: { diff: { $subtract: ["$debitSum", "$creditSum"] } } },
      { $match: { diff: { $not: { $gt: -0.01, $lt: 0.01 } } } },
      { $sort: { firstDate: -1 } },
      { $limit: 100 },
    ]);

    // 3. Orphaned ledger entries — no matching accountId in COA
    const entryAccountIds = await FinancialLedgerEntry.distinct("accountId", {
      business: bizId,
      status: { $in: ACTIVE_STATUSES },
      accountId: { $ne: null },
    });
    const validAccounts = await ChartOfAccount.distinct("_id", {
      business: bizId,
    });
    const validSet = new Set(validAccounts.map(String));
    const orphanedAccountIds = entryAccountIds.filter((id) => !validSet.has(String(id)));

    let orphanedEntriesCount = 0;
    if (orphanedAccountIds.length) {
      orphanedEntriesCount = await FinancialLedgerEntry.countDocuments({
        business: bizId,
        status: { $in: ACTIVE_STATUSES },
        accountId: { $in: orphanedAccountIds },
      });
    }

    // 4. Entries posted to inactive (soft-deleted) accounts
    const inactiveAccountIds = await ChartOfAccount.distinct("_id", {
      business: bizId,
      isActive: false,
    });
    let inactiveAccountEntries = 0;
    if (inactiveAccountIds.length) {
      inactiveAccountEntries = await FinancialLedgerEntry.countDocuments({
        business: bizId,
        status: { $in: ACTIVE_STATUSES },
        accountId: { $in: inactiveAccountIds },
      });
    }

    // 5. Accounts with abnormal balance sign for their type
    // Assets & Expenses should be debit-normal; Liabilities, Equity, Income should be credit-normal.
    // Must include "reversed" status so that original + reversal cancel to zero — otherwise every
    // reversed transaction leaves only the reversal's opposite-direction entry in the "approved" pool
    // and makes the account appear to have an abnormal balance (false positive).
    const accountBalances = await FinancialLedgerEntry.aggregate([
      { $match: { business: bizId, status: { $in: ["approved", "reversed"] }, accountId: { $ne: null } } },
      {
        $group: {
          _id: "$accountId",
          netDebit: { $sum: "$debit" },
          netCredit: { $sum: "$credit" },
        },
      },
      { $addFields: { netBalance: { $subtract: ["$netDebit", "$netCredit"] } } },
    ]);

    const accountTypeMap = await ChartOfAccount.find(
      { business: bizId, isActive: true },
      { _id: 1, code: 1, name: 1, type: 1 }
    ).lean();
    const typeIndex = new Map(accountTypeMap.map((a) => [String(a._id), a]));

    const abnormalBalances = accountBalances
      .filter((row) => {
        const acc = typeIndex.get(String(row._id));
        if (!acc) return false;
        const isDebitNormal = ["asset", "expense"].includes(acc.type);
        // Flag if net balance is on the wrong side (more than KES 1 threshold to skip rounding noise)
        return isDebitNormal ? row.netBalance < -1 : row.netBalance > 1;
      })
      .map((row) => {
        const acc = typeIndex.get(String(row._id));
        return {
          accountId: row._id,
          code: acc?.code,
          name: acc?.name,
          type: acc?.type,
          netBalance: row.netBalance,
        };
      })
      .slice(0, 50);

    // 6. Posted journal entries with no ledger entries
    const journalsWithNoLedger = await JournalEntry.find(
      { business: bizId, status: "posted", ledgerEntries: { $size: 0 } },
      { journalNo: 1, date: 1 }
    ).lean();

    // Flag which unbalanced groups already have an active manual correction posted
    let mappedUnbalancedGroups = [];
    if (unbalancedGroups.length) {
      const groupIds = unbalancedGroups.map((g) => g._id);
      const correctionGroupIds = await FinancialLedgerEntry.distinct("journalGroupId", {
        business:              bizId,
        journalGroupId:        { $in: groupIds },
        sourceTransactionType: "manual_adjustment",
        status:                "approved",
      });
      const correctionSet = new Set(correctionGroupIds.map(String));
      const base = unbalancedGroups.map((g) => ({
        journalGroupId:     g._id,
        sourceType:         g.sourceType,
        sourceId:           g.sourceId,
        date:               g.firstDate,
        debit:              g.debitSum,
        credit:             g.creditSum,
        difference:         g.diff,
        entryCount:         g.entryCount,
        hasCorrectionEntry: correctionSet.has(String(g._id)),
      }));
      // Enrich with human-readable receipt/invoice numbers — one query per sourceType
      mappedUnbalancedGroups = await enrichGroupsWithSourceRef(base);
    }

    const issues = [];
    if (!glBalanced)               issues.push({ severity: "critical", issue: `GL is out of balance by KES ${Math.abs(glDifference).toFixed(2)}` });
    if (unbalancedGroups.length)   issues.push({ severity: "critical", issue: `${unbalancedGroups.length} journal group(s) have unequal debits/credits` });
    if (orphanedEntriesCount > 0)  issues.push({ severity: "critical", issue: `${orphanedEntriesCount} ledger entry/entries reference deleted accounts` });
    if (inactiveAccountEntries > 0) issues.push({ severity: "warning",  issue: `${inactiveAccountEntries} entry/entries posted to inactive accounts` });
    if (abnormalBalances.length)   issues.push({ severity: "warning",  issue: `${abnormalBalances.length} account(s) have abnormal balance signs` });
    if (journalsWithNoLedger.length) issues.push({ severity: "warning", issue: `${journalsWithNoLedger.length} posted journal(s) have no ledger entries` });

    const overallStatus = issues.some((i) => i.severity === "critical") ? "critical" : issues.length ? "warnings" : "clean";
    const runAt = new Date();

    // Save scan to history (non-blocking on failure)
    const healthRun = await GLHealthRun.create({
      business:      businessId,
      ranBy:         req.user?._id || req.user?.id || null,
      runAt,
      overallStatus,
      issueCount:    issues.length,
      issues,
      repairs:       [],
    }).catch(() => null);

    return res.status(200).json({
      success: true,
      healthRunId: healthRun?._id || null,
      runAt,
      overallStatus,
      issues,
      detail: {
        glBalance: { totalDebit, totalCredit, difference: glDifference, balanced: glBalanced },
        unbalancedGroups: mappedUnbalancedGroups,
        orphanedEntriesCount,
        orphanedAccountIds,
        inactiveAccountEntries,
        abnormalBalances,
        journalsWithNoLedger: journalsWithNoLedger.map((j) => ({ id: j._id, journalNo: j.journalNo, date: j.date })),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Integrity report failed" });
  }
};

// ─── HEALTH HISTORY ──────────────────────────────────────────────────────────
export const getHealthHistory = async (req, res) => {
  try {
    const businessId = req.query.business || req.query.company || req.user?.company;
    if (!businessId) return res.status(400).json({ error: "Business context required" });

    const runs = await GLHealthRun.find({ business: businessId })
      .sort({ runAt: -1 })
      .limit(50)
      .populate("ranBy", "username name")
      .lean();

    return res.status(200).json(runs);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to load health history" });
  }
};

// ─── REPAIR: BALANCE A JOURNAL GROUP ────────────────────────────────────────
// Posts a single correcting entry to the caller-selected account so the
// journal group's debits equal its credits.
export const repairBalanceGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { business: businessId, accountId, notes, healthRunId } = req.body;

    if (!groupId || !mongoose.Types.ObjectId.isValid(groupId))
      return res.status(400).json({ error: "Valid journal group ID required" });
    if (!businessId)
      return res.status(400).json({ error: "Business context required" });
    if (!accountId || !mongoose.Types.ObjectId.isValid(accountId))
      return res.status(400).json({ error: "Select a correcting account" });

    const bizId   = new mongoose.Types.ObjectId(String(businessId));
    const groupOid = new mongoose.Types.ObjectId(String(groupId));

    // Fetch all approved entries in the group
    const entries = await FinancialLedgerEntry.find({
      business: bizId,
      journalGroupId: groupOid,
      status: "approved",
    }).lean();

    if (!entries.length)
      return res.status(404).json({ error: "No approved entries found for this journal group" });

    const debitSum  = round2(entries.reduce((s, e) => s + (Number(e.debit)  || 0), 0));
    const creditSum = round2(entries.reduce((s, e) => s + (Number(e.credit) || 0), 0));
    const diff      = round2(debitSum - creditSum);

    if (Math.abs(diff) < 0.005)
      return res.status(400).json({ error: "This journal group is already balanced" });

    // Prevent double-correcting: if an active manual_adjustment already exists, reject
    const existingCorrection = await FinancialLedgerEntry.exists({
      business:              bizId,
      journalGroupId:        groupOid,
      sourceTransactionType: "manual_adjustment",
      status:                "approved",
    });
    if (existingCorrection)
      return res.status(409).json({ error: "A correction entry already exists for this group. Undo it first before posting a new one." });

    const correctionDirection = diff > 0 ? "credit" : "debit";
    const correctionAmount    = Math.abs(diff);
    // Prefer the first original entry (not a prior correction) to pull source identity
    const sample = entries.find((e) => e.sourceTransactionType !== "manual_adjustment") || entries[0];
    const sourceLabel = sample?.sourceTransactionType && sample.sourceTransactionType !== "manual_adjustment"
      ? ` | ${sample.sourceTransactionType} …${String(sample.sourceTransactionId || "").slice(-8)}`
      : "";
    const actorUserId = await resolveAuditActorUserId({ req, businessId });

    // Use current date to avoid closed-period lock; compute period from it
    const now         = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const periodEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const correctionEntry = await postEntry({
      business:              bizId,
      property:              sample.property  || null,
      landlord:              sample.landlord  || null,
      sourceTransactionType: "manual_adjustment",
      sourceTransactionId:   String(groupOid),
      transactionDate:       now,
      statementPeriodStart:  periodStart,
      statementPeriodEnd:    periodEnd,
      category:              "ADJUSTMENT",
      journalGroupId:        groupOid,
      accountId:             new mongoose.Types.ObjectId(String(accountId)),
      amount:                correctionAmount,
      direction:             correctionDirection,
      payer:                 "n/a",
      receiver:              "n/a",
      notes:                 notes?.trim() || `GL correction – balancing entry for journal group ${String(groupOid).slice(-8)}${sourceLabel}`,
      createdBy:             actorUserId,
      approvedBy:            actorUserId,
      approvedAt:            new Date(),
      status:                "approved",
      allowUnscoped:         true,
      metadata:              { postingRole: "gl_correction", correctedBy: String(actorUserId), originalImbalance: diff },
    });

    aggregateChartOfAccountBalances(businessId, [String(accountId)]).catch(() => {});

    await appendRepairLog(healthRunId, {
      repairType:      "balance_group",
      appliedAt:       new Date(),
      appliedBy:       actorUserId,
      description:     `Balanced group ${String(groupOid).slice(-8)} — posted ${correctionDirection} KES ${correctionAmount} to account ${accountId}`,
      outcome:         "success",
      recordsAffected: 1,
    });

    return res.status(200).json({
      success: true,
      correctionEntryId: correctionEntry._id,
      direction:         correctionDirection,
      amount:            correctionAmount,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Repair failed" });
  }
};

// ─── REPAIR: RECOMPUTE ALL COA BALANCES ─────────────────────────────────────
export const repairRecomputeBalances = async (req, res) => {
  const businessId = req.body?.business || req.query?.business || req.user?.company;
  if (!businessId) return res.status(400).json({ error: "Business context required" });
  const healthRunId = req.body?.healthRunId;

  try {
    const accounts = await ChartOfAccount.find({ business: businessId }).select("_id").lean();
    const updated  = await aggregateChartOfAccountBalances(businessId, accounts.map((a) => a._id));
    const actorId  = await resolveAuditActorUserId({ req, businessId });

    await appendRepairLog(healthRunId, {
      repairType:      "recompute_balances",
      appliedAt:       new Date(),
      appliedBy:       actorId,
      description:     `Recomputed balances for ${updated?.length ?? accounts.length} accounts from ledger`,
      outcome:         "success",
      recordsAffected: updated?.length ?? accounts.length,
    });

    return res.status(200).json({ success: true, accountsUpdated: updated?.length ?? accounts.length });
  } catch (err) {
    await appendRepairLog(healthRunId, {
      repairType: "recompute_balances", appliedAt: new Date(),
      description: "Recompute balances failed", outcome: "failed",
      recordsAffected: 0, errorMessage: err.message,
    });
    return res.status(500).json({ error: err.message || "Recompute failed" });
  }
};

// ─── REPAIR: REPOST INVOICES WITH NO LEDGER ──────────────────────────────────
// Delegates to the existing repostInvoicesToLedger and appends a repair log entry.
export const repairRepostInvoices = async (req, res) => {
  const healthRunId = req.body?.healthRunId;
  const userId      = req.user?._id || req.user?.id;

  let capturedCode = 200;
  let capturedData;
  const fakeRes = {
    status: (code) => { capturedCode = code; return fakeRes; },
    json:   (data) => { capturedData = data; return fakeRes; },
  };

  await repostInvoicesToLedger(req, fakeRes);

  if (capturedData?.success) {
    await appendRepairLog(healthRunId, {
      repairType:      "repost_invoices",
      appliedAt:       new Date(),
      appliedBy:       userId,
      description:     `Reposted ${capturedData.posted ?? 0} invoice(s); ${capturedData.skipped ?? 0} already posted`,
      outcome:         capturedData.errors?.length && !capturedData.posted ? "failed" : "success",
      recordsAffected: capturedData.posted ?? 0,
      errorMessage:    (capturedData.errors || []).map((e) => e.error).join("; ").slice(0, 500),
    });
  }

  return res.status(capturedCode).json(capturedData);
};

// ─── LIST ALL ACTIVE MANUAL GL CORRECTION ENTRIES ────────────────────────────
// GET /api/ledger/repair/active-corrections
export const getActiveCorrections = async (req, res) => {
  const businessId = req.query?.business || req.user?.company;
  if (!businessId) return res.status(400).json({ error: "Business context required" });

  try {
    const entries = await FinancialLedgerEntry.find({
      business:              businessId,
      sourceTransactionType: "manual_adjustment",
      status:                "approved",
    })
      .populate({ path: "accountId", select: "code name" })
      .sort({ createdAt: -1 })
      .lean();

    const grouped = {};
    for (const e of entries) {
      const gid = String(e.journalGroupId || "ungrouped");
      if (!grouped[gid]) grouped[gid] = { journalGroupId: gid, entries: [], postedAt: e.createdAt };
      grouped[gid].entries.push({
        _id:         e._id,
        direction:   e.direction,
        debit:       e.debit  || 0,
        credit:      e.credit || 0,
        accountCode: e.accountId?.code || "—",
        accountName: e.accountId?.name || "—",
        notes:       e.notes  || "",
        postedAt:    e.createdAt,
      });
    }

    return res.status(200).json({ corrections: Object.values(grouped) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// ─── REPAIR: REVERSE A CORRECTION ENTRY FOR A JOURNAL GROUP ─────────────────
// POST /api/ledger/repair/reverse-correction/:groupId
// Finds manual_adjustment entries in the group with status "approved" and sets
// them to "reversed", then recomputes affected account balances.
export const reverseGlCorrectionEntry = async (req, res) => {
  const { groupId } = req.params;
  const businessId  = req.body?.business || req.query?.business || req.user?.company;
  const healthRunId = req.body?.healthRunId;

  if (!businessId) return res.status(400).json({ error: "Business context required" });
  if (!groupId || !mongoose.Types.ObjectId.isValid(groupId)) {
    return res.status(400).json({ error: "Invalid groupId" });
  }

  try {
    const corrections = await FinancialLedgerEntry.find({
      business:              new mongoose.Types.ObjectId(String(businessId)),
      journalGroupId:        new mongoose.Types.ObjectId(groupId),
      sourceTransactionType: "manual_adjustment",
      status:                "approved",
    }).select("_id accountId").lean();

    if (!corrections.length) {
      return res.status(404).json({ error: "No active correction entries found for this journal group" });
    }

    const ids        = corrections.map((e) => e._id);
    const accountIds = [...new Set(corrections.map((e) => String(e.accountId)).filter(Boolean))];

    await FinancialLedgerEntry.updateMany({ _id: { $in: ids } }, { $set: { status: "reversed" } });

    aggregateChartOfAccountBalances(businessId, accountIds).catch(() => {});

    const actorUserId = await resolveAuditActorUserId({ req, businessId });
    await appendRepairLog(healthRunId, {
      repairType:      "reverse_correction",
      appliedAt:       new Date(),
      appliedBy:       actorUserId,
      description:     `Reversed ${corrections.length} correction entr${corrections.length === 1 ? "y" : "ies"} for journal group …${String(groupId).slice(-8)}`,
      outcome:         "success",
      recordsAffected: corrections.length,
    });

    return res.status(200).json({ success: true, reversedCount: corrections.length });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Reverse failed" });
  }
};

// ─── GL ENTRIES FOR A JOURNAL GROUP ──────────────────────────────────────────
// GET /api/ledger/repair/group-entries/:groupId
// Returns all ledger entries in a journal group so the user can see exactly
// which legs exist and which is missing before deciding how to correct.
export const getGroupEntries = async (req, res) => {
  const { groupId } = req.params;
  const businessId  = req.query?.business || req.user?.company;

  if (!businessId) return res.status(400).json({ error: "Business context required" });
  if (!mongoose.Types.ObjectId.isValid(groupId)) return res.status(400).json({ error: "Invalid groupId" });

  try {
    const entries = await FinancialLedgerEntry.find({
      business:       new mongoose.Types.ObjectId(String(businessId)),
      journalGroupId: new mongoose.Types.ObjectId(groupId),
      status:         { $in: ["approved", "reversed"] },
    })
      .populate({ path: "accountId", select: "code name type" })
      .sort({ direction: 1, createdAt: 1 })
      .lean();

    return res.status(200).json({
      entries: entries.map((e) => ({
        _id:                   e._id,
        direction:             e.direction,
        debit:                 e.debit  || 0,
        credit:                e.credit || 0,
        accountCode:           e.accountId?.code || "—",
        accountName:           e.accountId?.name || "—",
        notes:                 e.notes  || "",
        sourceTransactionType: e.sourceTransactionType,
        status:                e.status,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// ─── GL ENTRIES BY SOURCE TRANSACTION ────────────────────────────────────────
// GET /api/ledger/entries?businessId=X&sourceType=Y&sourceId=Z
export const getEntriesBySource = async (req, res) => {
  const { businessId, sourceType, sourceId } = req.query;
  if (!businessId || !sourceType || !sourceId) {
    return res.status(400).json({ error: "businessId, sourceType, and sourceId are required" });
  }
  try {
    const entries = await FinancialLedgerEntry.find({
      business: businessId,
      sourceTransactionType: sourceType,
      sourceTransactionId: String(sourceId),
    })
      .populate({ path: "accountId", select: "code name type" })
      .sort({ transactionDate: 1, createdAt: 1 })
      .lean();

    const formatted = entries.map((e) => ({
      _id:             e._id,
      accountCode:     e.accountId?.code     || "—",
      accountName:     e.accountId?.name     || "—",
      accountType:     e.accountId?.type     || "—",
      direction:       e.direction,
      debit:           e.debit  || 0,
      credit:          e.credit || 0,
      amount:          e.amount,
      category:        e.category,
      status:          e.status,
      transactionDate: e.transactionDate,
      notes:           e.notes  || "",
      reversalOf:      e.reversalOf  ?? null,
      journalGroupId:  e.journalGroupId ?? null,
    }));

    const totalDebit  = formatted.reduce((s, e) => s + e.debit,  0);
    const totalCredit = formatted.reduce((s, e) => s + e.credit, 0);

    return res.status(200).json({ entries: formatted, totalDebit, totalCredit });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
