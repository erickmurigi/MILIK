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
import { postInvoiceJournal } from "./tenantInvoices.js";
import { aggregateChartOfAccountBalances } from "../../services/chartAccountAggregationService.js";
import { ensureSystemChartOfAccounts, findSystemAccountByCode } from "../../services/chartOfAccountsService.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";
import { createError } from "../../utils/error.js";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const toOid  = (id) => new mongoose.Types.ObjectId(String(id));
const currentMonthBounds = () => {
  const now = new Date();
  return {
    now,
    periodStart: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0),
    periodEnd:   new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
  };
};

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

export const checkInvoiceLedgerEntries = async (req, res, next) => {
  try {
    const { propertyId } = req.params;
    const { period } = req.query;
    const businessId = req.user?.company;

    if (!businessId) {
      return next(createError(400, "Business context required"));
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
      .limit(2000)
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
    return next(error);
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

export const repostInvoicesToLedger = async (req, res, next) => {
  try {
    const { propertyId, period } = req.body;
    const businessId = req.user?.company;
    const userId = req.user?._id || req.user?.id;

    if (!businessId || !userId) {
      return next(createError(400, "Authentication required"));
    }

    let periodStart;
    let periodEnd;
    if (period) {
      const [year, month] = period.split("-").map(Number);
      periodStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
      periodEnd = new Date(year, month, 0, 23, 59, 59, 999);
    }

    const invoiceQuery = { business: businessId, status: { $nin: ["cancelled", "reversed"] } };
    if (propertyId) invoiceQuery.property = propertyId;
    if (periodStart && periodEnd) invoiceQuery.invoiceDate = { $gte: periodStart, $lte: periodEnd };

    const invoices = await TenantInvoice.find(invoiceQuery).limit(2000).lean();
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
        // Delegate to postInvoiceJournal — identical to the original posting path.
        // This ensures VAT splitting, correct netAmount on income leg, and fresh journalGroupId.
        const incomeAccount = invoice.chartAccount ? { _id: invoice.chartAccount } : null;
        const { entries } = await postInvoiceJournal({
          invoice,
          createdBy: userId,
          incomeAccount,
          receivableAccount,
        });
        for (const e of entries) {
          e.accountId && touchedAccountIds.add(String(e.accountId));
        }
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
    return next(error);
  }
};

export const recomputeChartBalances = async (req, res, next) => {
  try {
    const businessId = req.user?.company;
    if (!businessId) {
      return next(createError(400, "Business context required"));
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
    return next(error);
  }
};

export const checkLedgerBalance = async (req, res, next) => {
  try {
    const businessId = req.user?.company;
    if (!businessId) {
      return next(createError(400, "Business context required"));
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
    return next(error);
  }
};

export const checkUtilityReceiptLedgerEntries = async (req, res, next) => {
  try {
    const businessId = req.query?.businessId || req.user?.company;
    const { propertyId, landlordId, periodStart, periodEnd } = req.query;
    const match = {
      business: businessId,
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

    const entries = await FinancialLedgerEntry.find(match).limit(2000).lean();
    return res.json({ count: entries.length, entries });
  } catch (err) {
    return next(err);
  }
};

// ─── GL INTEGRITY REPORT ────────────────────────────────────────────────────
// Comprehensive check: unbalanced groups, orphaned entries, inactive account
// usage, negative normal-side balances, and missing critical system accounts.
export const runIntegrityReport = async (req, res, next) => {
  try {
    const businessId =
      req.query?.business || req.query?.company ||
      req.body?.business || req.body?.company ||
      req.user?.company;

    if (!businessId) return next(createError(400, "Business context required"));

    const bizId = new mongoose.Types.ObjectId(String(businessId));
    // ACTIVE_STATUSES: used for totals and account-orphan checks (approved entries only)
    const ACTIVE_STATUSES = ["approved"];
    // REPORT_STATUSES: matches the trial balance — both "approved" and "reversed" entries
    // are included so that a properly reversed journal group (original "reversed" + REVERSAL
    // "approved" pairs) shows as balanced, consistent with what the trial balance shows.
    const REPORT_STATUSES = ["approved", "reversed"];

    // Legacy entries stored amount+direction instead of explicit debit/credit fields.
    // These $cond expressions fall back to that format so old entries are counted correctly.
    const debitExpr = {
      $cond: [
        { $gt: [{ $ifNull: ["$debit", -1] }, -1] },
        "$debit",
        { $cond: [{ $eq: ["$direction", "debit"] }, "$amount", 0] },
      ],
    };
    const creditExpr = {
      $cond: [
        { $gt: [{ $ifNull: ["$credit", -1] }, -1] },
        "$credit",
        { $cond: [{ $eq: ["$direction", "credit"] }, "$amount", 0] },
      ],
    };

    const [
      [totals],
      unbalancedGroups,
      entryAccountIds,
      validAccountIds,
      inactiveAccountIds,
      accountBalances,
      accountTypeMap,
      journalsWithNoLedger,
    ] = await Promise.all([
      FinancialLedgerEntry.aggregate([
        { $match: { business: bizId, status: { $in: ACTIVE_STATUSES } } },
        {
          $group: {
            _id: null,
            totalDebit: { $sum: debitExpr },
            totalCredit: { $sum: creditExpr },
            count: { $sum: 1 },
          },
        },
      ]),
      FinancialLedgerEntry.aggregate([
        { $match: { business: bizId, status: { $in: REPORT_STATUSES }, journalGroupId: { $ne: null } } },
        {
          $group: {
            _id: "$journalGroupId",
            debitSum: { $sum: debitExpr },
            creditSum: { $sum: creditExpr },
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
      ]),
      FinancialLedgerEntry.distinct("accountId", {
        business: bizId,
        status: { $in: ACTIVE_STATUSES },
        accountId: { $ne: null },
      }),
      ChartOfAccount.distinct("_id", { business: bizId }),
      ChartOfAccount.distinct("_id", { business: bizId, isActive: false }),
      FinancialLedgerEntry.aggregate([
        { $match: { business: bizId, status: { $in: ["approved", "reversed"] }, accountId: { $ne: null } } },
        {
          $group: {
            _id: "$accountId",
            netDebit: { $sum: debitExpr },
            netCredit: { $sum: creditExpr },
          },
        },
        { $addFields: { netBalance: { $subtract: ["$netDebit", "$netCredit"] } } },
      ]),
      ChartOfAccount.find(
        { business: bizId, isActive: true },
        { _id: 1, code: 1, name: 1, type: 1 }
      ).lean(),
      JournalEntry.find(
        { business: bizId, status: "posted", ledgerEntries: { $size: 0 } },
        { journalNo: 1, date: 1 }
      ).lean(),
    ]);

    const totalDebit = Number(totals?.totalDebit || 0);
    const totalCredit = Number(totals?.totalCredit || 0);
    const glDifference = totalDebit - totalCredit;
    const glBalanced = Math.abs(glDifference) < 0.01;

    const validSet = new Set(validAccountIds.map(String));
    const orphanedAccountIds = entryAccountIds.filter((id) => !validSet.has(String(id)));

    const [orphanedEntriesCount, inactiveAccountEntries] = await Promise.all([
      orphanedAccountIds.length
        ? FinancialLedgerEntry.countDocuments({ business: bizId, status: { $in: ACTIVE_STATUSES }, accountId: { $in: orphanedAccountIds } })
        : Promise.resolve(0),
      inactiveAccountIds.length
        ? FinancialLedgerEntry.countDocuments({ business: bizId, status: { $in: ACTIVE_STATUSES }, accountId: { $in: inactiveAccountIds } })
        : Promise.resolve(0),
    ]);

    const typeIndex = new Map(accountTypeMap.map((a) => [String(a._id), a]));

    const abnormalBalances = accountBalances
      .filter((row) => {
        const acc = typeIndex.get(String(row._id));
        if (!acc) return false;
        const isDebitNormal = ["asset", "expense"].includes(acc.type);
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
    return next(err);
  }
};

// ─── HEALTH HISTORY ──────────────────────────────────────────────────────────
export const getHealthHistory = async (req, res, next) => {
  try {
    const businessId = req.query.business || req.query.company || req.user?.company;
    if (!businessId) return next(createError(400, "Business context required"));

    const runs = await GLHealthRun.find({ business: businessId })
      .sort({ runAt: -1 })
      .limit(50)
      .populate("ranBy", "username name")
      .lean();

    return res.status(200).json(runs);
  } catch (err) {
    return next(err);
  }
};

// ─── REPAIR: BALANCE A JOURNAL GROUP ────────────────────────────────────────
// Posts a single correcting entry to the caller-selected account so the
// journal group's debits equal its credits.
export const repairBalanceGroup = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { business: businessId, accountId, notes, healthRunId } = req.body;

    if (!groupId || !mongoose.Types.ObjectId.isValid(groupId))
      return next(createError(400, "Valid journal group ID required"));
    if (!businessId)
      return next(createError(400, "Business context required"));
    if (!accountId || !mongoose.Types.ObjectId.isValid(accountId))
      return next(createError(400, "Select a correcting account"));

    const bizId   = new mongoose.Types.ObjectId(String(businessId));
    const groupOid = new mongoose.Types.ObjectId(String(groupId));

    // Use approved+reversed (same set as the trial balance) so the imbalance we
    // measure matches what the trial balance actually shows.  If a receipt was
    // reversed and its REVERSAL entries are in this same group they will cancel
    // the originals to zero — diff = 0 → "already balanced" blocks the correction,
    // which is the right outcome.  If the reversal entries ended up in the wrong
    // group (data corruption) the group will still show a real imbalance here and
    // the correction is allowed.
    const allEntries = await FinancialLedgerEntry.find({
      business: bizId,
      journalGroupId: groupOid,
      status: { $in: ["approved", "reversed"] },
    }).lean();

    if (!allEntries.length)
      return next(createError(404, "No entries found for this journal group"));

    const debitSum  = round2(allEntries.reduce((s, e) => s + (Number(e.debit)  || 0), 0));
    const creditSum = round2(allEntries.reduce((s, e) => s + (Number(e.credit) || 0), 0));
    const diff      = round2(debitSum - creditSum);

    if (Math.abs(diff) < 0.005)
      return next(createError(400, "This journal group is already balanced"));

    // Prevent double-correcting: if an active manual_adjustment already exists, reject
    const existingCorrection = await FinancialLedgerEntry.exists({
      business:              bizId,
      journalGroupId:        groupOid,
      sourceTransactionType: "manual_adjustment",
      status:                "approved",
    });
    if (existingCorrection)
      return next(createError(409, "A correction entry already exists for this group. Undo it first before posting a new one."));

    // Derive context (property, landlord, source label) from the first non-correction entry
    const sample = allEntries.find((e) => e.sourceTransactionType !== "manual_adjustment") || allEntries[0];

    const correctionDirection = diff > 0 ? "credit" : "debit";
    const correctionAmount    = Math.abs(diff);
    const actorUserId = await resolveAuditActorUserId({ req, businessId });

    // Build a human-readable source label by looking up the source document
    let sourceLabel = "";
    if (sample?.sourceTransactionId && sample.sourceTransactionType === "rent_payment") {
      const srcPayment = await RentPayment.findById(sample.sourceTransactionId)
        .populate("tenant", "name")
        .populate("unit", "unitNumber")
        .select("receiptNumber referenceNumber tenant unit")
        .lean();
      if (srcPayment) {
        const rcptNo = srcPayment.receiptNumber || srcPayment.referenceNumber || String(sample.sourceTransactionId).slice(-6);
        const tenantName = srcPayment.tenant?.name || "";
        const unitNo = srcPayment.unit?.unitNumber ? `Unit ${srcPayment.unit.unitNumber}` : "";
        const who = [tenantName, unitNo].filter(Boolean).join(", ");
        sourceLabel = ` — ${rcptNo}${who ? ` — ${who}` : ""}`;
      }
    } else if (sample?.sourceTransactionType && sample.sourceTransactionType !== "manual_adjustment") {
      sourceLabel = ` — ${sample.sourceTransactionType} …${String(sample.sourceTransactionId || "").slice(-8)}`;
    }

    const { now, periodStart, periodEnd } = currentMonthBounds();

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
      notes:                 notes?.trim() || `GL Balance Correction: ${correctionDirection === "credit" ? "CR" : "DR"} KES ${correctionAmount.toFixed(2)}${sourceLabel}`,
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
      description:     `GL Balance Correction: ${correctionDirection === "credit" ? "CR" : "DR"} KES ${correctionAmount.toFixed(2)}${sourceLabel} — posted to account ${accountId}`,
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
    return next(err);
  }
};

// ─── REPAIR: CLEAR ABNORMAL ACCOUNT BALANCE ──────────────────────────────────
// Posts a balanced 2-leg correcting journal to bring an account's net balance
// back to zero when it sits on its abnormal side.
export const repairClearAbnormalBalance = async (req, res, next) => {
  try {
    const { business: businessId, accountId, offsetAccountId, notes, healthRunId } = req.body;

    if (!businessId)
      return next(createError(400, "Business context required"));
    if (!accountId || !mongoose.Types.ObjectId.isValid(accountId))
      return next(createError(400, "Valid account ID required"));
    if (!offsetAccountId || !mongoose.Types.ObjectId.isValid(offsetAccountId))
      return next(createError(400, "Select an offset account"));
    if (String(accountId) === String(offsetAccountId))
      return next(createError(400, "Offset account must differ from the account being corrected"));

    const bizId     = new mongoose.Types.ObjectId(String(businessId));
    const accOid    = new mongoose.Types.ObjectId(String(accountId));
    const offsetOid = new mongoose.Types.ObjectId(String(offsetAccountId));

    // Compute net balance using the same status filter as the health check
    // (approved + reversed) so the result matches what the integrity report shows.
    const [balanceRow] = await FinancialLedgerEntry.aggregate([
      { $match: { business: bizId, accountId: accOid, status: { $in: ["approved", "reversed"] } } },
      { $group: { _id: null, debit: { $sum: "$debit" }, credit: { $sum: "$credit" } } },
    ]);
    const netBalance = round2((balanceRow?.debit || 0) - (balanceRow?.credit || 0));

    if (Math.abs(netBalance) < 0.005)
      return next(createError(400, "Account balance is already at zero — no correction needed"));

    // Positive netBalance = net debit. Clearing it means posting a CR to the account.
    const corrAmount   = Math.abs(netBalance);
    const accDirection = netBalance > 0 ? "credit" : "debit";
    const offDirection = netBalance > 0 ? "debit"  : "credit";

    const actorUserId             = await resolveAuditActorUserId({ req, businessId });
    const newGroupId              = new mongoose.Types.ObjectId();
    const { now, periodStart, periodEnd } = currentMonthBounds();

    const desc = notes?.trim() ||
      `GL Clear Abnormal Balance: ${accDirection === "credit" ? "CR" : "DR"} KES ${corrAmount.toFixed(2)} — restoring account to zero`;

    const baseEntry = {
      business:              bizId,
      sourceTransactionType: "manual_adjustment",
      sourceTransactionId:   String(newGroupId),
      transactionDate:       now,
      statementPeriodStart:  periodStart,
      statementPeriodEnd:    periodEnd,
      category:              "ADJUSTMENT",
      journalGroupId:        newGroupId,
      amount:                corrAmount,
      payer:                 "n/a",
      receiver:              "n/a",
      createdBy:             actorUserId,
      approvedBy:            actorUserId,
      approvedAt:            now,
      status:                "approved",
      allowUnscoped:         true,
    };

    await postEntry({
      ...baseEntry,
      accountId:  accOid,
      direction:  accDirection,
      notes:      desc,
      metadata:   { postingRole: "gl_correction", correctedBy: String(actorUserId), abnormalBalance: netBalance },
    });
    await postEntry({
      ...baseEntry,
      accountId:  offsetOid,
      direction:  offDirection,
      notes:      `Offset — ${desc}`,
      metadata:   { postingRole: "gl_correction_offset", correctedBy: String(actorUserId) },
    });

    aggregateChartOfAccountBalances(businessId, [String(accountId), String(offsetAccountId)]).catch(() => {});

    await appendRepairLog(healthRunId, {
      repairType:      "clear_abnormal_balance",
      appliedAt:       now,
      appliedBy:       actorUserId,
      description:     `Clear Abnormal Balance: ${accDirection === "credit" ? "CR" : "DR"} KES ${corrAmount.toFixed(2)} on account ${accountId} — offset to ${offsetAccountId}`,
      outcome:         "success",
      recordsAffected: 2,
    });

    return res.status(200).json({ success: true, amount: corrAmount, direction: accDirection });
  } catch (err) {
    return next(err);
  }
};

// ─── REPAIR: RECOMPUTE ALL COA BALANCES ─────────────────────────────────────
export const repairRecomputeBalances = async (req, res, next) => {
  const businessId = req.body?.business || req.query?.business || req.user?.company;
  if (!businessId) return next(createError(400, "Business context required"));
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
    return next(err);
  }
};

// ─── REPAIR: REPOST INVOICES WITH NO LEDGER ──────────────────────────────────
// Delegates to the existing repostInvoicesToLedger and appends a repair log entry.
export const repairRepostInvoices = async (req, res, next) => {
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
export const getActiveCorrections = async (req, res, next) => {
  const businessId = req.query?.business || req.user?.company;
  if (!businessId) return next(createError(400, "Business context required"));

  try {
    const entries = await FinancialLedgerEntry.find({
      business:              businessId,
      sourceTransactionType: "manual_adjustment",
      status:                "approved",
    })
      .populate({ path: "accountId", select: "code name" })
      .sort({ createdAt: -1 })
      .limit(500)
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
    console.error("[getActiveCorrections]", err);
    return next(createError(500, "Failed to load GL corrections"));
  }
};

// ─── REPAIR: REVERSE A CORRECTION ENTRY FOR A JOURNAL GROUP ─────────────────
// POST /api/ledger/repair/reverse-correction/:groupId
// Finds manual_adjustment entries in the group with status "approved" and sets
// them to "reversed", then recomputes affected account balances.
export const reverseGlCorrectionEntry = async (req, res, next) => {
  const { groupId } = req.params;
  const { business, healthRunId, entryIds } = req.body;
  const businessId = business || req.query?.business || req.user?.company;

  if (!businessId) return next(createError(400, "Business context required"));
  const isUngrouped = groupId === "ungrouped";
  if (!isUngrouped && !mongoose.Types.ObjectId.isValid(groupId)) {
    return next(createError(400, "Invalid groupId"));
  }
  if (isUngrouped && !(entryIds?.length)) {
    return next(createError(400, "entryIds required for ungrouped corrections"));
  }

  try {
    const baseMatch = {
      business:              toOid(businessId),
      sourceTransactionType: "manual_adjustment",
      status:                "approved",
    };
    const query = isUngrouped
      ? { ...baseMatch, _id: { $in: (entryIds || []).map((id) => new mongoose.Types.ObjectId(String(id))) } }
      : { ...baseMatch, journalGroupId: new mongoose.Types.ObjectId(groupId) };

    const corrections = await FinancialLedgerEntry.find(query).select("_id accountId").lean();

    if (!corrections.length) {
      return next(createError(404, "No active correction entries found for this journal group"));
    }

    const ids        = corrections.map((e) => e._id);
    const accountIds = [...new Set(corrections.map((e) => String(e.accountId)).filter(Boolean))];

    await FinancialLedgerEntry.updateMany({ _id: { $in: ids } }, { $set: { status: "void" } }, { _bypassImmutability: true });

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
    return next(err);
  }
};

// ─── REPAIR: VOID ALL REVERSED CORRECTION ENTRIES ────────────────────────────
// POST /api/ledger/repair/void-reversed
// Changes status of any manual_adjustment entries that are still "reversed"
// (from older Undo runs) to "void" so they are excluded from COA/Trial Balance.
export const voidReversedCorrections = async (req, res, next) => {
  const businessId = req.body?.business || req.user?.company;
  if (!businessId) return next(createError(400, "Business context required"));

  try {
    const bizId = new mongoose.Types.ObjectId(String(businessId));

    const entries = await FinancialLedgerEntry.find({
      business:              bizId,
      sourceTransactionType: "manual_adjustment",
      status:                "reversed",
    }).select("_id accountId").lean();

    if (!entries.length) return res.status(200).json({ success: true, voidedCount: 0 });

    const ids        = entries.map((e) => e._id);
    const accountIds = [...new Set(entries.map((e) => String(e.accountId)).filter(Boolean))];

    await FinancialLedgerEntry.updateMany({ _id: { $in: ids } }, { $set: { status: "void" } }, { _bypassImmutability: true });

    aggregateChartOfAccountBalances(businessId, accountIds).catch(() => {});

    return res.status(200).json({ success: true, voidedCount: entries.length });
  } catch (err) {
    return next(err);
  }
};

// ─── GL ENTRIES FOR A JOURNAL GROUP ──────────────────────────────────────────
// GET /api/ledger/repair/group-entries/:groupId
// Returns all ledger entries in a journal group so the user can see exactly
// which legs exist and which is missing before deciding how to correct.
export const getGroupEntries = async (req, res, next) => {
  const { groupId } = req.params;
  const businessId  = req.query?.business || req.user?.company;

  if (!businessId) return next(createError(400, "Business context required"));
  if (!mongoose.Types.ObjectId.isValid(groupId)) return next(createError(400, "Invalid groupId"));

  try {
    const entries = await FinancialLedgerEntry.find({
      business:       new mongoose.Types.ObjectId(String(businessId)),
      journalGroupId: new mongoose.Types.ObjectId(groupId),
      status:         { $in: ["approved", "reversed"] },
    })
      .populate({ path: "accountId", select: "code name type" })
      .sort({ direction: 1, createdAt: 1 })
      .limit(200)
      .lean();

    return res.status(200).json({
      entries: entries.map((e) => ({
        _id:                   e._id,
        accountId:             e.accountId?._id || null,
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
    return next(err);
  }
};

// ─── VOID ORPHANED JOURNAL GROUP ─────────────────────────────────────────────
// POST /api/ledger/repair/void-orphaned-group/:groupId
// Voids all approved entries in a journal group whose source document has been
// deleted. Cleaner than posting a correcting entry — removes them from the
// trial balance entirely without adding more ledger noise.
export const voidOrphanedJournalGroup = async (req, res, next) => {
  const { groupId }   = req.params;
  const { business: businessId } = req.body;

  if (!businessId) return next(createError(400, "Business context required"));
  if (!mongoose.Types.ObjectId.isValid(groupId)) return next(createError(400, "Invalid groupId"));

  try {
    const bizId    = new mongoose.Types.ObjectId(String(businessId));
    const groupOid = new mongoose.Types.ObjectId(String(groupId));

    const entries = await FinancialLedgerEntry.find({
      business:       bizId,
      journalGroupId: groupOid,
      status:         "approved",
    }).select("_id accountId").lean();

    if (!entries.length) return res.status(200).json({ success: true, voidedCount: 0 });

    const ids        = entries.map((e) => e._id);
    const accountIds = [...new Set(entries.map((e) => String(e.accountId)).filter(Boolean))];

    await FinancialLedgerEntry.updateMany({ _id: { $in: ids } }, { $set: { status: "void" } }, { _bypassImmutability: true });

    aggregateChartOfAccountBalances(businessId, accountIds).catch(() => {});

    return res.status(200).json({ success: true, voidedCount: entries.length });
  } catch (err) {
    return next(err);
  }
};

// ─── GL ENTRIES BY SOURCE TRANSACTION ────────────────────────────────────────
// GET /api/ledger/entries?businessId=X&sourceType=Y&sourceId=Z
export const getEntriesBySource = async (req, res, next) => {
  const { businessId, sourceType, sourceId } = req.query;
  if (!businessId || !sourceType || !sourceId) {
    return next(createError(400, "businessId, sourceType, and sourceId are required"));
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
    return next(err);
  }
};
