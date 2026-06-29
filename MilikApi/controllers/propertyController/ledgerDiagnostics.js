import mongoose from "mongoose";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import RentPayment from "../../models/RentPayment.js";
import TenantInvoice from "../../models/TenantInvoice.js";
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

    const issues = [];
    if (!glBalanced) issues.push({ severity: "critical", issue: `GL is out of balance by ${glDifference.toFixed(2)}` });
    if (unbalancedGroups.length) issues.push({ severity: "critical", issue: `${unbalancedGroups.length} journal group(s) have unequal debits/credits` });
    if (orphanedEntriesCount > 0) issues.push({ severity: "critical", issue: `${orphanedEntriesCount} ledger entry/entries reference deleted accounts` });
    if (inactiveAccountEntries > 0) issues.push({ severity: "warning", issue: `${inactiveAccountEntries} entry/entries posted to inactive accounts` });
    if (abnormalBalances.length) issues.push({ severity: "warning", issue: `${abnormalBalances.length} account(s) have abnormal balance signs` });
    if (journalsWithNoLedger.length) issues.push({ severity: "warning", issue: `${journalsWithNoLedger.length} posted journal(s) have no ledger entries` });

    return res.status(200).json({
      success: true,
      runAt: new Date(),
      overallStatus: issues.some((i) => i.severity === "critical") ? "critical" : issues.length ? "warnings" : "clean",
      issues,
      detail: {
        glBalance: { totalDebit, totalCredit, difference: glDifference, balanced: glBalanced },
        unbalancedGroups: unbalancedGroups.map((g) => ({
          journalGroupId: g._id,
          sourceType: g.sourceType,
          sourceId: g.sourceId,
          date: g.firstDate,
          debit: g.debitSum,
          credit: g.creditSum,
          difference: g.diff,
          entryCount: g.entryCount,
        })),
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
