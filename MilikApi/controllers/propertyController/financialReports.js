import mongoose from "mongoose";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import Company from "../../models/Company.js";
import CompanySettings from "../../models/CompanySettings.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import JournalEntry from "../../models/JournalEntry.js";
import AccountingPeriod from "../../models/AccountingPeriod.js";
import Tenant from "../../models/Tenant.js";
import TenantInvoice from "../../models/TenantInvoice.js";
import TenantInvoiceNote from "../../models/TenantInvoiceNote.js";
import RentPayment from "../../models/RentPayment.js";
import Property from "../../models/Property.js";
import Unit from "../../models/Unit.js";
import ExpenseProperty from "../../models/ExpenseProperty.js";
import PaymentVoucher from "../../models/PaymentVoucher.js";
import { computeTenantInvoiceSnapshotsBatch } from "./tenantInvoices.js";
import { round2 } from "../../utils/math.js";
import { ensureSystemChartOfAccounts, findSystemAccountByCode } from "../../services/chartOfAccountsService.js";
import { computeAccountBalance, getNormalBalanceSide } from "../../services/accountingClassificationService.js";
import { postEntry } from "../../services/ledgerPostingService.js";
import { escapeRegex } from "../../utils/escapeRegex.js";
import {
  isOperatingIncomeAccount,
  isOperatingExpenseAccount,
  isSelfManagingLandlordIncomeAccount,
  isSelfManagingLandlordExpenseAccount,
} from "../../utils/accountClassifiers.js";
import { isSelfManagingLandlordCompany } from "../../utils/companyModules.js";
import { resolveBusinessId } from "../../utils/requestContext.js";
import { createError } from "../../utils/error.js";

const toObjectId = (value) => {
  const raw = typeof value === "object" && value?._id ? value._id : value;
  if (!raw || !mongoose.Types.ObjectId.isValid(String(raw))) return null;
  return new mongoose.Types.ObjectId(String(raw));
};

const getEntryAmount = (entry = {}) => {
  return Number(entry.amount || 0) || Math.max(Number(entry.debit || 0), Number(entry.credit || 0), 0);
};

const normalizeDate = (value, fallbackToEnd = false) => {
  if (!value) {
    const now = new Date();
    if (fallbackToEnd) now.setHours(23, 59, 59, 999);
    else now.setHours(0, 0, 0, 0);
    return now;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (fallbackToEnd) date.setHours(23, 59, 59, 999);
  else date.setHours(0, 0, 0, 0);
  return date;
};


const REPORT_LEDGER_STATUSES = ["approved", "reversed"];

const resolveInvoiceDueDateForReports = (invoice = {}) => {
  const dueDate = invoice?.dueDate ? normalizeDate(invoice.dueDate, true) : null;
  if (dueDate) return dueDate;

  const metadata = invoice?.metadata && typeof invoice.metadata === "object" ? invoice.metadata : {};
  const fallback = metadata?.periodEndDate || metadata?.periodToDate || metadata?.periodStartDate || metadata?.periodFromDate || invoice?.invoiceDate || null;
  return fallback ? normalizeDate(fallback, true) : null;
};

// isOperatingIncomeAccount / isOperatingExpenseAccount imported from accountClassifiers.js

const buildLedgerMap = async ({ businessId, asOfDate = null, startDate = null, endDate = null, propertyId = null }) => {
  // aggregate() does not auto-cast strings â†’ ObjectId the way find() does.
  const businessOid = new mongoose.Types.ObjectId(String(businessId));
  const match = {
    business: businessOid,
    status: { $in: REPORT_LEDGER_STATUSES },
  };

  // When propertyId is provided, scope the ledger map to entries for that property only.
  if (propertyId) {
    match.property = propertyId;
  }

  if (startDate || endDate || asOfDate) {
    match.transactionDate = {};
    if (startDate) match.transactionDate.$gte = startDate;
    if (endDate) match.transactionDate.$lte = endDate;
    if (asOfDate) match.transactionDate.$lte = asOfDate;
  }

  // Aggregate in MongoDB â€” avoids transferring every entry document to Node.js.
  // Mirrors the getEntryAmount + debit/credit fallback logic for legacy entries
  // that stored amount+direction instead of explicit debit/credit fields.
  const debitExpr = {
    $cond: [
      { $gt: ["$debit", 0] },
      "$debit",
      {
        $cond: [
          { $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "debit"] },
          { $ifNull: ["$amount", 0] },
          0,
        ],
      },
    ],
  };
  const creditExpr = {
    $cond: [
      { $gt: ["$credit", 0] },
      "$credit",
      {
        $cond: [
          { $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "credit"] },
          { $ifNull: ["$amount", 0] },
          0,
        ],
      },
    ],
  };

  const results = await FinancialLedgerEntry.aggregate([
    { $match: match },
    { $group: { _id: "$accountId", debit: { $sum: debitExpr }, credit: { $sum: creditExpr } } },
  ]).allowDiskUse(true);

  const map = new Map();
  for (const row of results) {
    if (row._id != null) {
      map.set(String(row._id), { debit: row.debit || 0, credit: row.credit || 0 });
    }
  }
  return map;
};

const splitNetBalanceByNormalSide = (account = {}, netBalance = 0) => {
  const normalSide = getNormalBalanceSide(account.type);
  const amount = Math.abs(Number(netBalance || 0));

  if (amount < 0.00001) {
    return { debitBalance: 0, creditBalance: 0 };
  }

  if (normalSide === "debit") {
    return {
      debitBalance: netBalance >= 0 ? amount : 0,
      creditBalance: netBalance < 0 ? amount : 0,
    };
  }

  return {
    debitBalance: netBalance < 0 ? amount : 0,
    creditBalance: netBalance >= 0 ? amount : 0,
  };
};

const deriveBalancesFromStoredBalance = (account = {}) => {
  const stored = Number(account.balance || 0);
  const split = splitNetBalanceByNormalSide(account, stored);

  return {
    ...split,
    netBalance: stored,
    source: Math.abs(stored) < 0.00001 ? "stored-zero" : "stored-balance",
  };
};

const deriveRowBalance = (
  account = {},
  ledger = { debit: 0, credit: 0 },
  options = {}
) => {
  const { useStoredBalanceFallback = true } = options;
  const ledgerDebit = Number(ledger?.debit || 0);
  const ledgerCredit = Number(ledger?.credit || 0);
  const hasLedgerMovement = Math.abs(ledgerDebit) > 0.00001 || Math.abs(ledgerCredit) > 0.00001;

  if (hasLedgerMovement) {
    const netBalance = computeAccountBalance({
      type: account.type,
      debit: ledgerDebit,
      credit: ledgerCredit,
    });
    const split = splitNetBalanceByNormalSide(account, netBalance);

    return {
      debit: ledgerDebit,
      credit: ledgerCredit,
      netBalance,
      ...split,
      source: "ledger",
    };
  }

  if (useStoredBalanceFallback) {
    const fallback = deriveBalancesFromStoredBalance(account);
    return {
      debit: 0,
      credit: 0,
      ...fallback,
    };
  }

  return {
    debit: 0,
    credit: 0,
    netBalance: 0,
    debitBalance: 0,
    creditBalance: 0,
    source: "ledger-zero",
  };
};

const buildSectionBuckets = (rows = []) => {
  const grouped = new Map();
  for (const row of rows) {
    const key = row.subGroup || row.group || "Other";
    const bucket = grouped.get(key) || { label: key, total: 0, rows: [] };
    bucket.rows.push(row);
    bucket.total += Number(row.amount || 0);
    grouped.set(key, bucket);
  }

  return Array.from(grouped.values()).map((bucket) => ({
    ...bucket,
    total: round2(bucket.total),
    rows: bucket.rows.sort((a, b) => String(a.code).localeCompare(String(b.code))),
  }));
};

export const getTrialBalanceReport = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) {
      return next(createError(400, "A valid business id is required."));
    }

    const includeZeroBalances = String(req.query.includeZeroBalances || "false").toLowerCase() === "true";
    const asOfDate = normalizeDate(req.query.asOfDate, true);
    if (!asOfDate) {
      return next(createError(400, "Invalid as-of date supplied."));
    }

    const [accounts, ledgerMap] = await Promise.all([
      ChartOfAccount.find({ business: businessId, isPosting: { $ne: false }, isHeader: { $ne: true } })
        .sort({ code: 1 })
        .lean(),
      buildLedgerMap({ businessId, asOfDate }),
    ]);

    const rows = accounts
      .map((account) => {
        const ledger = ledgerMap.get(String(account._id)) || { debit: 0, credit: 0 };
        const derived = deriveRowBalance(account, ledger, { useStoredBalanceFallback: false });

        return {
          _id: account._id,
          code: account.code,
          name: account.name,
          type: account.type,
          group: account.group,
          subGroup: account.subGroup || "",
          debit: derived.debit,
          credit: derived.credit,
          netBalance: derived.netBalance,
          debitBalance: derived.debitBalance,
          creditBalance: derived.creditBalance,
          balanceSource: derived.source,
        };
      })
      .filter((row) => includeZeroBalances || Math.abs(Number(row.netBalance || 0)) > 0.00001);

    const totals = rows.reduce(
      (acc, row) => {
        acc.debit += Number(row.debitBalance || 0);
        acc.credit += Number(row.creditBalance || 0);
        return acc;
      },
      { debit: 0, credit: 0 }
    );

    const difference = round2(totals.debit - totals.credit);

    return res.status(200).json({
      success: true,
      asOfDate,
      count: rows.length,
      rows,
      totals: {
        debit: round2(totals.debit),
        credit: round2(totals.credit),
        difference,
        balanced: Math.abs(difference) < 0.01,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getIncomeStatementReport = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) {
      return next(createError(400, "A valid business id is required."));
    }

    const startDate = normalizeDate(req.query.startDate || new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    const endDate = normalizeDate(req.query.endDate || new Date(), true);
    if (!startDate || !endDate) {
      return next(createError(400, "Invalid report dates supplied."));
    }
    if (startDate > endDate) {
      return next(createError(400, "Start date cannot be after end date."));
    }

    // Optional property scope â€” filters ledger entries by the property dimension.
    // Accounts remain generic; only entries tagged with this property are included.
    const scopePropertyId = req.query.propertyId ? toObjectId(req.query.propertyId) : null;

    const accountQuery = {
      business: businessId,
      isPosting: { $ne: false },
      isHeader: { $ne: true },
      type: { $in: ["income", "expense"] },
    };

    const [accounts, ledgerMap, company] = await Promise.all([
      ChartOfAccount.find(accountQuery).sort({ code: 1 }).lean(),
      buildLedgerMap({ businessId, startDate, endDate, propertyId: scopePropertyId }),
      Company.findById(businessId, { modules: 1, companyMode: 1 }).lean(),
    ]);

    const selfManaging = isSelfManagingLandlordCompany(company);
    const incomeClassifier = selfManaging ? isSelfManagingLandlordIncomeAccount : isOperatingIncomeAccount;
    const expenseClassifier = selfManaging ? isSelfManagingLandlordExpenseAccount : isOperatingExpenseAccount;

    const incomeRows = [];
    const expenseRows = [];

    for (const account of accounts) {
      const ledger = ledgerMap.get(String(account._id)) || { debit: 0, credit: 0 };
      const derived = deriveRowBalance(account, ledger, { useStoredBalanceFallback: false });
      const amount = round2(Number(derived.netBalance || 0));
      if (Math.abs(amount) < 0.00001) continue;

      const row = {
        _id: account._id,
        code: account.code,
        name: account.name,
        type: account.type,
        group: account.group,
        subGroup: account.subGroup || "",
        amount,
        balanceSource: derived.source,
      };

      if (account.type === "income" && incomeClassifier(account)) incomeRows.push(row);
      if (account.type === "expense" && expenseClassifier(account)) expenseRows.push(row);
    }

    const incomeSections = buildSectionBuckets(incomeRows);
    const expenseSections = buildSectionBuckets(expenseRows);

    const totalIncome = round2(incomeRows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    const totalExpenses = round2(expenseRows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    const netProfit = round2(totalIncome - totalExpenses);

    const reportBasis = selfManaging
      ? "All rental income and direct property expenses"
      : "All operating income and expenses for this company";

    const exclusions = selfManaging
      ? [
          "Commission income (not applicable â€” self-managed)",
          "Management fee income (not applicable â€” self-managed)",
          "Landlord remittance accounts (you are the landlord)",
        ]
      : company?.modules?.propertyManagement
        ? [
            "Rent collected on behalf of landlords",
            "Property control movements",
            "Landlord remittance payable",
            "Landlord/property deductions such as repairs and utilities",
          ]
        : [];

    return res.status(200).json({
      success: true,
      startDate,
      endDate,
      income: {
        sections: incomeSections,
        total: totalIncome,
        count: incomeRows.length,
      },
      expenses: {
        sections: expenseSections,
        total: totalExpenses,
        count: expenseRows.length,
      },
      summary: {
        totalIncome,
        totalExpenses,
        netProfit,
        resultLabel: netProfit >= 0 ? "Net Profit" : "Net Loss",
      },
      reportBasis,
      exclusions,
    });
  } catch (error) {
    next(error);
  }
};

export const getBalanceSheetReport = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) {
      return next(createError(400, "A valid business id is required."));
    }

    const includeZeroBalances = String(req.query.includeZeroBalances || "false").toLowerCase() === "true";
    const asOfDate = normalizeDate(req.query.asOfDate, true);
    if (!asOfDate) {
      return next(createError(400, "Invalid as-of date supplied."));
    }

    const [accounts, ledgerMap] = await Promise.all([
      ChartOfAccount.find({
        business: businessId,
        isPosting: { $ne: false },
        isHeader: { $ne: true },
        type: { $in: ["asset", "liability", "equity", "income", "expense"] },
      })
        .sort({ code: 1 })
        .lean(),
      buildLedgerMap({ businessId, asOfDate }),
    ]);

    const assetRows = [];
    const liabilityRows = [];
    const equityRows = [];
    let currentEarnings = 0;

    for (const account of accounts) {
      const ledger = ledgerMap.get(String(account._id)) || { debit: 0, credit: 0 };
      const derived = deriveRowBalance(account, ledger, { useStoredBalanceFallback: false });
      const signedAmount = round2(derived.netBalance);

      if (account.type === "income") {
        currentEarnings += signedAmount;
        continue;
      }

      if (account.type === "expense") {
        currentEarnings -= signedAmount;
        continue;
      }

      if (!includeZeroBalances && Math.abs(signedAmount) < 0.00001) continue;

      const row = {
        _id: account._id,
        code: account.code,
        name: account.name,
        type: account.type,
        group: account.group,
        subGroup: account.subGroup || "",
        amount: signedAmount,
        netBalance: signedAmount,
        isAbnormalBalance: signedAmount < 0,
        balanceSource: derived.source,
      };

      if (account.type === "asset") assetRows.push(row);
      if (account.type === "liability") liabilityRows.push(row);
      if (account.type === "equity") equityRows.push(row);
    }

    currentEarnings = round2(currentEarnings);

    if (includeZeroBalances || Math.abs(currentEarnings) > 0.00001) {
      equityRows.push({
        _id: "current-period-earnings",
        code: "CYE",
        name: currentEarnings >= 0 ? "Current Period Earnings" : "Current Period Loss",
        type: "equity",
        group: "equity",
        subGroup: "Retained Earnings",
        amount: currentEarnings,
        netBalance: currentEarnings,
        isAbnormalBalance: currentEarnings < 0,
        balanceSource: "computed-current-period",
        isComputed: true,
      });
    }

    const assetSections = buildSectionBuckets(assetRows);
    const liabilitySections = buildSectionBuckets(liabilityRows);
    const equitySections = buildSectionBuckets(equityRows);

    const totalAssets = round2(assetRows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    const totalLiabilities = round2(liabilityRows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    const totalEquity = round2(equityRows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    const totalLiabilitiesAndEquity = round2(totalLiabilities + totalEquity);
    const difference = round2(totalAssets - totalLiabilitiesAndEquity);

    return res.status(200).json({
      success: true,
      asOfDate,
      assets: {
        sections: assetSections,
        total: totalAssets,
        count: assetRows.length,
      },
      liabilities: {
        sections: liabilitySections,
        total: totalLiabilities,
        count: liabilityRows.length,
      },
      equity: {
        sections: equitySections,
        total: totalEquity,
        count: equityRows.length,
        currentPeriodEarnings: currentEarnings,
      },
      summary: {
        totalAssets,
        totalLiabilities,
        totalEquity,
        totalLiabilitiesAndEquity,
        difference,
        balanced: Math.abs(difference) < 0.01,
      },
      reportBasis: "Accrual basis using chart accounts and posted ledger balances as at the selected date",
    });
  } catch (error) {
    next(error);
  }
};



const safeLower = (value = "") => String(value || "").trim().toLowerCase();

const normalizeArray = (value) => (Array.isArray(value) ? value : []);

const pickPrimaryLandlord = (property = {}) => {
  const landlords = normalizeArray(property?.landlords);
  return landlords.find((entry) => entry?.isPrimary) || landlords[0] || null;
};

const categoryBucketKey = (category = "") => {
  const normalized = String(category || "").toUpperCase();
  if (normalized === "RENT_CHARGE") return "rentApplied";
  if (normalized === "UTILITY_CHARGE") return "utilityApplied";
  if (normalized === "LATE_PENALTY_CHARGE") return "penaltyApplied";
  if (normalized === "DEPOSIT_CHARGE") return "depositApplied";
  return "otherApplied";
};

const addCategorizedAmount = (target, category, amount) => {
  const key = categoryBucketKey(category);
  target[key] = round2(Number(target[key] || 0) + Number(amount || 0));
};

const emptyAllocationTotals = () => ({
  rentApplied: 0,
  utilityApplied: 0,
  penaltyApplied: 0,
  depositApplied: 0,
  otherApplied: 0,
});

// Extracts a clean utility name from a UTILITY_CHARGE invoice's metadata or description
const extractUtilityInvoiceName = (invoice) => {
  const fromMeta = String(
    invoice?.metadata?.utilityType ||
    invoice?.metadata?.meterUtilityType ||
    invoice?.metadata?.statementUtilityType ||
    invoice?.metadata?.utilityName ||
    ""
  ).trim();
  if (fromMeta) return fromMeta;
  const desc = String(invoice?.description || "").split(/[Â·\-â€“:,]/)[0].trim();
  const match = desc.match(/^([A-Za-z][A-Za-z\s]+?)(?:\s+charge|\s+bill|\s+invoice|\s+for|\s+\d|$)/i);
  return ((match?.[1] || desc).trim().replace(/\s+/g, " ") || "Other").slice(0, 40);
};

// Single-pass receipt processing: computes allocation totals + utility breakdown in one loop
const buildReceiptRow = (receipt = {}) => {
  const unit = receipt?.unit || {};
  const property = unit?.property || {};
  const tenant = receipt?.tenant || {};
  const landlord = pickPrimaryLandlord(property);

  const totals = emptyAllocationTotals();
  const utilityBreakdown = {};
  let allocatedAmount = 0;

  for (const row of normalizeArray(receipt?.allocations)) {
    const amount = round2(Number(row?.appliedAmount || 0));
    if (amount <= 0) continue;
    allocatedAmount += amount;
    addCategorizedAmount(totals, row?.category, amount);
    if (String(row?.category || "").toUpperCase() === "UTILITY_CHARGE") {
      const uType = String(row?.utilityType || row?.metadata?.utilityType || "").trim() || "Other";
      utilityBreakdown[uType] = round2((utilityBreakdown[uType] || 0) + amount);
    }
  }

  return {
    receiptId: String(receipt?._id || ""),
    receiptNumber: receipt?.receiptNumber || "",
    paymentDate: receipt?.paymentDate || receipt?.createdAt || null,
    paymentMethod: receipt?.paymentMethod || "",
    cashbook: receipt?.cashbook || "",
    amount: round2(Math.abs(Number(receipt?.amount || 0))),
    allocatedAmount: round2(allocatedAmount),
    unappliedAmount: round2(Math.max(0, Math.abs(Number(receipt?.amount || 0)) - allocatedAmount)),
    rentApplied: totals.rentApplied,
    utilityApplied: totals.utilityApplied,
    penaltyApplied: totals.penaltyApplied,
    depositApplied: totals.depositApplied,
    otherApplied: totals.otherApplied,
    tenantId: String(tenant?._id || receipt?.tenant || ""),
    tenantName: tenant?.tenantName || tenant?.name || "Unknown Tenant",
    unitId: String(unit?._id || receipt?.unit || ""),
    unitNumber: unit?.unitNumber || unit?.name || "N/A",
    propertyId: String(property?._id || unit?.property || ""),
    propertyName: property?.propertyName || property?.name || "Unknown Property",
    landlordId: String(landlord?.landlordId || ""),
    landlordName: landlord?.name || "N/A",
    referenceNumber: receipt?.referenceNumber || "",
    description: receipt?.description || "",
    utilityBreakdown,
  };
};

const matchesText = (source = "", query = "") => {
  if (!query) return true;
  return safeLower(source).includes(safeLower(query));
};


const buildEffectiveReceiptQuery = ({ businessId, startDate = null, endDate = null, dateField = "paymentDate" } = {}) => {
  const query = {
    business: businessId,
    ledgerType: "receipts",
    isConfirmed: true,
    isCancelled: { $ne: true },
    isReversed: { $ne: true },
    reversalOf: null,
    isCancellationEntry: { $ne: true },
    postingStatus: { $in: [null, "", "posted"] },
  };

  if (startDate || endDate) {
    query[dateField] = {};
    if (startDate) query[dateField].$gte = startDate;
    if (endDate) query[dateField].$lte = endDate;
  }

  return query;
};


export const getRentalCollectionReport = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) {
      return next(createError(400, "A valid business id is required."));
    }
    const businessOid = new mongoose.Types.ObjectId(String(businessId));

    const startDate = normalizeDate(req.query.startDate || req.query.dateFrom || req.query.from);
    const endDate = normalizeDate(req.query.endDate || req.query.dateTo || req.query.to, true);
    if (!startDate || !endDate) {
      return next(createError(400, "Valid start and end dates are required."));
    }

    const paymentQuery = buildEffectiveReceiptQuery({
      businessId,
      startDate,
      endDate,
      dateField: "paymentDate",
    });

    if (req.query.tenantId) paymentQuery.tenant = toObjectId(req.query.tenantId);
    if (req.query.paymentMethod) paymentQuery.paymentMethod = req.query.paymentMethod;
    if (req.query.cashbook) paymentQuery.cashbook = { $regex: escapeRegex(req.query.cashbook), $options: "i" };
    // Resolve zone to property IDs so both the payment and invoice queries can filter by zone.
    let zonePropertyIds = null;
    if (req.query.zone && !req.query.propertyId && !req.query.unitId) {
      const zoneLower = req.query.zone.toLowerCase().trim();
      const zoneProps = await Property.find(
        { business: businessId, zoneRegion: { $regex: `^${zoneLower}$`, $options: "i" } },
        { _id: 1 }
      ).lean();
      zonePropertyIds = zoneProps.map((p) => p._id);
    }

    // RentPayment doesn't reliably carry a direct property field â€” resolve via unit.
    // unitId is more specific and takes precedence; propertyId resolves to its unit IDs.
    if (req.query.unitId) {
      paymentQuery.unit = toObjectId(req.query.unitId);
    } else if (req.query.propertyId) {
      const propertyUnitIds = await Unit.find(
        { property: toObjectId(req.query.propertyId), business: businessId },
        { _id: 1 }
      ).lean();
      paymentQuery.unit = { $in: propertyUnitIds.map((u) => u._id) };
    } else if (zonePropertyIds) {
      const zoneUnitIds = zonePropertyIds.length > 0
        ? await Unit.find({ property: { $in: zonePropertyIds }, business: businessId }, { _id: 1 }).lean()
        : [];
      paymentQuery.unit = { $in: zoneUnitIds.map((u) => u._id) };
    }

    const invoiceQuery = {
      business: businessOid,
      category: { $in: ["RENT_CHARGE", "UTILITY_CHARGE", "LATE_PENALTY_CHARGE"] },
      status: { $nin: ["cancelled", "reversed"] },
      $or: [
        { bookingDate: { $gte: startDate, $lte: endDate } },
        {
          $or: [{ bookingDate: { $exists: false } }, { bookingDate: null }],
          invoiceDate: { $gte: startDate, $lte: endDate },
        },
      ],
    };
    if (req.query.propertyId) invoiceQuery.property = toObjectId(req.query.propertyId);
    else if (zonePropertyIds) invoiceQuery.property = { $in: zonePropertyIds };
    if (req.query.tenantId) invoiceQuery.tenant = toObjectId(req.query.tenantId);
    if (req.query.unitId) invoiceQuery.unit = toObjectId(req.query.unitId);
    if (req.query.landlordId) invoiceQuery.landlord = toObjectId(req.query.landlordId);

    // Run payment fetch and invoice aggregate in parallel â€” they are independent queries.
    const [receipts, periodInvoiced] = await Promise.all([
      RentPayment.find(paymentQuery)
        .populate("tenant", "name tenantName")
        .populate({
          path: "unit",
          select: "unitNumber name property",
          populate: { path: "property", select: "propertyName name landlords" },
        })
        .sort({ paymentDate: -1, createdAt: -1 })
        .limit(5000)
        .lean(),
      TenantInvoice.aggregate([
        { $match: invoiceQuery },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]).allowDiskUse(true),
    ]);

    const filteredRows = receipts
      .map((receipt) => ({ ...buildReceiptRow(receipt), paymentType: receipt?.paymentType || "" }))
      .filter((row) => {
        // landlordId cannot be pushed to DB (derived from property.landlords array)
        if (req.query.landlordId && String(row.landlordId) !== String(req.query.landlordId)) return false;
        return true;
      });

    const propertySummaryMap = new Map();
    const tenantSet = new Set();
    const propertySet = new Set();
    const allUtilityTypesSet = new Set();
    const summary = {
      totalCollected: 0,           // ALL receipts including deposits
      operationalCollected: 0,     // Rent + utility + penalty + other (excludes deposits)
      depositCollected: 0,         // Deposit receipts only
      allocatedAmount: 0,
      unappliedAmount: 0,
      rentApplied: 0,
      utilityApplied: 0,
      penaltyApplied: 0,
      depositApplied: 0,
      otherApplied: 0,
      totalPayments: filteredRows.length,
      propertyCount: 0,
      tenantCount: 0,
      periodInvoiced: 0,
      collectionRate: null,        // operationalCollected / periodInvoiced
    };

    filteredRows.forEach((row) => {
      const isDeposit = row.paymentType === "deposit";
      summary.totalCollected += row.amount;
      if (isDeposit) summary.depositCollected += row.amount;
      else summary.operationalCollected += row.amount;
      summary.allocatedAmount += row.allocatedAmount;
      summary.unappliedAmount += row.unappliedAmount;
      summary.rentApplied += row.rentApplied;
      summary.utilityApplied += row.utilityApplied;
      summary.penaltyApplied += row.penaltyApplied;
      summary.depositApplied += row.depositApplied;
      summary.otherApplied += row.otherApplied;
      if (row.tenantId) tenantSet.add(String(row.tenantId));
      if (row.propertyId) propertySet.add(String(row.propertyId));

      const key = String(row.propertyId || row.propertyName || "unknown");
      const bucket = propertySummaryMap.get(key) || {
        propertyId: row.propertyId,
        propertyName: row.propertyName,
        paymentCount: 0,
        totalCollected: 0,
        operationalCollected: 0,
        allocatedAmount: 0,
        unappliedAmount: 0,
        rentApplied: 0,
        utilityApplied: 0,
        utilityBreakdown: {},
        penaltyApplied: 0,
        tenantIds: new Set(),
        unitIds: new Set(),
      };
      bucket.paymentCount += 1;
      bucket.totalCollected += row.amount;
      if (!isDeposit) bucket.operationalCollected += row.amount;
      bucket.allocatedAmount += row.allocatedAmount;
      bucket.unappliedAmount += row.unappliedAmount;
      bucket.rentApplied += row.rentApplied;
      bucket.utilityApplied += row.utilityApplied;
      Object.entries(row.utilityBreakdown || {}).forEach(([ut, amt]) => {
        bucket.utilityBreakdown[ut] = round2((bucket.utilityBreakdown[ut] || 0) + amt);
        allUtilityTypesSet.add(ut);
      });
      bucket.penaltyApplied += row.penaltyApplied;
      if (row.tenantId) bucket.tenantIds.add(String(row.tenantId));
      if (row.unitId) bucket.unitIds.add(String(row.unitId));
      propertySummaryMap.set(key, bucket);
    });

    summary.totalCollected = round2(summary.totalCollected);
    summary.operationalCollected = round2(summary.operationalCollected);
    summary.depositCollected = round2(summary.depositCollected);
    summary.allocatedAmount = round2(summary.allocatedAmount);
    summary.unappliedAmount = round2(summary.unappliedAmount);
    summary.rentApplied = round2(summary.rentApplied);
    summary.utilityApplied = round2(summary.utilityApplied);
    summary.penaltyApplied = round2(summary.penaltyApplied);
    summary.depositApplied = round2(summary.depositApplied);
    summary.otherApplied = round2(summary.otherApplied);
    summary.propertyCount = propertySet.size;
    summary.tenantCount = tenantSet.size;
    summary.periodInvoiced = round2(periodInvoiced?.[0]?.total || 0);

    // Collection rate = operational cash collected / operational invoices raised.
    // Deposits are excluded from both sides: they are not billed as invoices and are
    // not income â€” using totalCollected here would push the rate above 100%.
    summary.collectionRate = summary.periodInvoiced > 0
      ? round2((summary.operationalCollected / summary.periodInvoiced) * 100)
      : null;

    const byProperty = Array.from(propertySummaryMap.values())
      .map((bucket) => ({
        propertyId: bucket.propertyId,
        propertyName: bucket.propertyName,
        paymentCount: bucket.paymentCount,
        tenantCount: bucket.tenantIds.size,
        unitCount: bucket.unitIds.size,
        totalCollected: round2(bucket.totalCollected),
        operationalCollected: round2(bucket.operationalCollected),
        allocatedAmount: round2(bucket.allocatedAmount),
        unappliedAmount: round2(bucket.unappliedAmount),
        rentApplied: round2(bucket.rentApplied),
        utilityApplied: round2(bucket.utilityApplied),
        utilityBreakdown: Object.fromEntries(Object.entries(bucket.utilityBreakdown).map(([k, v]) => [k, round2(v)])),
        penaltyApplied: round2(bucket.penaltyApplied),
      }))
      .sort((a, b) => a.propertyName.localeCompare(b.propertyName));

    return res.status(200).json({
      success: true,
      filters: {
        startDate,
        endDate,
        propertyId: req.query.propertyId || "",
        tenantId: req.query.tenantId || "",
        unitId: req.query.unitId || "",
        landlordId: req.query.landlordId || "",
        paymentMethod: req.query.paymentMethod || "",
        cashbook: req.query.cashbook || "",
      },
      summary,
      byProperty,
      allUtilityTypes: [...allUtilityTypesSet].sort(),
      rows: filteredRows,
    });
  } catch (error) {
    next(error);
  }
};

export const getTenantPaidBalanceReport = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "A valid business id is required."));

    const asOfDate = normalizeDate(req.query.asOfDate, true) || normalizeDate(null, true);
    const fromDate = req.query.startDate ? normalizeDate(req.query.startDate) : null;
    const tenantQuery = { business: businessId, status: { $nin: ["terminated", "moved_out", "evicted"] } };
    if (req.query.tenantId) tenantQuery._id = toObjectId(req.query.tenantId);

    const filterPropertyId = req.query.propertyId ? String(req.query.propertyId) : "";
    const filterLandlordId = req.query.landlordId ? String(req.query.landlordId) : "";
    const filterSearch = safeLower(req.query.search || "");
    const filterStatus = req.query.status && req.query.status !== "all" ? req.query.status : "";

    // â”€â”€ Step 1: batch-fetch tenants, units, properties in 3 parallel queries â”€â”€
    // Avoids the N+1 problem of cursor+nested-populate (2 queries per tenant).
    const [allTenants, allUnits, allProperties] = await Promise.all([
      Tenant.find(tenantQuery).select("_id tenantName name unit additionalUnits").sort({ name: 1, createdAt: 1 }).limit(10000).lean(),
      Unit.find({ business: businessId }).select("_id unitNumber name property").limit(10000).lean(),
      Property.find({ business: businessId }).select("_id propertyName name landlords").limit(10000).lean(),
    ]);

    const unitMap = new Map(allUnits.map((u) => [String(u._id), u]));
    const propMap = new Map(allProperties.map((p) => [String(p._id), p]));

    // â”€â”€ Step 2: build base rows â€” one row per tenant (all units combined) â”€â”€
    const baseRows = [];
    for (const tenant of allTenants) {
      const primaryUnit = unitMap.get(String(tenant.unit || "")) || {};
      const additionalUnitIds = Array.isArray(tenant.additionalUnits) ? tenant.additionalUnits.map(String).filter(Boolean) : [];
      const additionalUnits = additionalUnitIds.map((id) => unitMap.get(id)).filter(Boolean);
      const allTenantUnits = [primaryUnit, ...additionalUnits].filter((u) => u._id);
      const property = propMap.get(String(primaryUnit.property || "")) || {};
      const landlord = pickPrimaryLandlord(property);
      // Combine all unit numbers into a single display string
      const unitNumbers = allTenantUnits.map((u) => u.unitNumber || u.name).filter(Boolean).join(", ") || (primaryUnit.unitNumber || primaryUnit.name || "N/A");
      const row = {
        tenantId: String(tenant._id),
        tenantName: tenant.tenantName || tenant.name || "Unknown Tenant",
        unitId: String(primaryUnit._id || tenant.unit || ""),
        unitNumber: unitNumbers,
        propertyId: String(property._id || primaryUnit.property || ""),
        propertyName: property.propertyName || property.name || "N/A",
        landlordId: String(landlord?.landlordId || ""),
        landlordName: landlord?.name || "N/A",
      };
      if (filterPropertyId && row.propertyId !== filterPropertyId) continue;
      if (filterLandlordId && row.landlordId !== filterLandlordId) continue;
      if (filterSearch && !`${row.tenantName} ${row.propertyName} ${row.unitNumber}`.toLowerCase().includes(filterSearch)) continue;
      baseRows.push(row);
    }

    // â”€â”€ Step 3: snapshot computation in chunks of 500 â”€â”€
    const REPORT_CHUNK = 500;
    const allRows = [];
    const allUtilityTypesSet = new Set();
    const fromDateMs = fromDate ? fromDate.getTime() : null;

    for (let i = 0; i < baseRows.length; i += REPORT_CHUNK) {
      const chunkRows = baseRows.slice(i, i + REPORT_CHUNK);
      const chunkTenantIds = chunkRows.map((row) => row.tenantId);

      const snapshotMap = await computeTenantInvoiceSnapshotsBatch({
        businessId,
        tenantIds: chunkTenantIds,
        asOfDate,
        invoiceQuery: {},
      });

      for (const row of chunkRows) {
        const snapshot = snapshotMap.get(row.tenantId) || { invoiceSnapshots: [], receiptAllocations: [] };
        const allSnapshotInvoices = normalizeArray(snapshot.invoiceSnapshots);
        const allInvoices = allSnapshotInvoices.filter((inv) => {
          if (!fromDateMs) return true;
          const d = inv.invoiceDate ? new Date(inv.invoiceDate).getTime() : 0;
          return d >= fromDateMs;
        });
        // Previous arrears: outstanding on invoices dated before the period start, all units combined
        const priorInvoices = fromDateMs
          ? allSnapshotInvoices.filter((inv) => {
              const d = inv.invoiceDate ? new Date(inv.invoiceDate).getTime() : 0;
              return d < fromDateMs;
            })
          : [];
        let previousArrears = 0;
        let priorInvoiceTotal = 0;
        let previousArrearsRent = 0;
        let previousArrearsUtility = 0;
        const previousArrearsUtilityBreakdown = {};
        let previousArrearsPenalty = 0;
        let previousArrearsDeposit = 0;
        let previousArrearsOther = 0;
        for (const inv of priorInvoices) {
          priorInvoiceTotal += Number(inv.amount || 0);
          const remaining = Number(inv.outstanding || 0);
          if (remaining <= 0) continue;
          previousArrears += remaining;
          const cat = String(inv.category || "").toUpperCase();
          if (cat === "RENT_CHARGE") {
            previousArrearsRent += remaining;
          } else if (cat === "UTILITY_CHARGE") {
            previousArrearsUtility += remaining;
            const uName = extractUtilityInvoiceName(inv);
            previousArrearsUtilityBreakdown[uName] = round2((previousArrearsUtilityBreakdown[uName] || 0) + remaining);
          } else if (cat === "LATE_PENALTY_CHARGE") {
            previousArrearsPenalty += remaining;
          } else if (cat === "DEPOSIT_CHARGE") {
            previousArrearsDeposit += remaining;
          } else {
            previousArrearsOther += remaining;
          }
        }
        previousArrears = round2(previousArrears);
        // All invoices across all units combined â€” no per-unit split
        const invoices = allInvoices;
        // Receipts are always tenant-level
        const receipts = normalizeArray(snapshot.receiptAllocations);

        let totalInvoiced = 0;
        let totalPaidApplied = 0;
        let outstanding = 0;
        let rentBalance = 0;
        let utilityBalance = 0;
        const utilityBreakdown = {};
        let penaltyBalance = 0;
        let depositBalance = 0;
        let otherBalance = 0;
        let rentInvoiced = 0;
        let utilityInvoiced = 0;
        const utilityInvoicedBreakdown = {};
        let penaltyInvoiced = 0;
        let depositInvoiced = 0;
        let otherInvoiced = 0;
        let oldestDueDateMs = null;

        for (const invoice of invoices) {
          const amount = Number(invoice?.amount || 0);
          const applied = Number(invoice?.applied || 0);
          const remaining = Number(invoice?.outstanding || 0);
          const category = String(invoice?.category || "").toUpperCase();
          totalInvoiced += amount;
          totalPaidApplied += applied;
          outstanding += remaining;
          if (category === "RENT_CHARGE") {
            rentBalance += remaining;
            rentInvoiced += amount;
          } else if (category === "UTILITY_CHARGE") {
            utilityBalance += remaining;
            utilityInvoiced += amount;
            const uName = extractUtilityInvoiceName(invoice);
            utilityBreakdown[uName] = round2((utilityBreakdown[uName] || 0) + remaining);
            utilityInvoicedBreakdown[uName] = round2((utilityInvoicedBreakdown[uName] || 0) + amount);
            allUtilityTypesSet.add(uName);
          } else if (category === "LATE_PENALTY_CHARGE") {
            penaltyBalance += remaining;
            penaltyInvoiced += amount;
          } else if (category === "DEPOSIT_CHARGE") {
            depositBalance += remaining;
            depositInvoiced += amount;
          } else {
            otherBalance += remaining;
            otherInvoiced += amount;
          }
          if (remaining > 0) {
            const reportDueDate = resolveInvoiceDueDateForReports(invoice);
            if (reportDueDate) {
              const ms = new Date(reportDueDate).getTime();
              if (!oldestDueDateMs || ms < oldestDueDateMs) oldestDueDateMs = ms;
            }
          }
        }

        let unappliedCredit = 0;
        let priorReceiptTotal = 0;
        let periodReceiptTotal = 0;
        let lastPaymentDateMs = null;
        for (const receipt of receipts) {
          unappliedCredit += Number(receipt?.unappliedAmount || 0);
          if (receipt?.paymentDate) {
            const ms = new Date(receipt.paymentDate).getTime();
            if (!lastPaymentDateMs || ms > lastPaymentDateMs) lastPaymentDateMs = ms;
            if (fromDateMs && ms < fromDateMs) {
              priorReceiptTotal += Number(receipt?.amount || 0);
            } else {
              periodReceiptTotal += Number(receipt?.amount || 0);
            }
          }
        }

        // BAL B/F = gross prior invoices âˆ’ gross prior receipts (signed; negative = credit carried forward)
        const balBF = fromDateMs ? round2(priorInvoiceTotal - priorReceiptTotal) : 0;

        const netBalance = round2(previousArrears + outstanding - unappliedCredit);
        const status = netBalance > 0.009 ? "owing" : netBalance < -0.009 ? "credit" : "settled";

        if (filterStatus && status !== filterStatus) continue;

        allRows.push({
          ...row,
          previousArrears,
          balBF,
          previousArrearsRent: round2(previousArrearsRent),
          previousArrearsUtility: round2(previousArrearsUtility),
          previousArrearsUtilityBreakdown,
          previousArrearsPenalty: round2(previousArrearsPenalty),
          previousArrearsDeposit: round2(previousArrearsDeposit),
          previousArrearsOther: round2(previousArrearsOther),
          totalInvoiced: round2(totalInvoiced),
          totalPaidApplied: round2(totalPaidApplied),
          outstanding: round2(outstanding),
          unappliedCredit: round2(unappliedCredit),
          netBalance,
          rentBalance: round2(rentBalance),
          utilityBalance: round2(utilityBalance),
          utilityBreakdown,
          penaltyBalance: round2(penaltyBalance),
          depositBalance: round2(depositBalance),
          otherBalance: round2(otherBalance),
          rentInvoiced: round2(rentInvoiced),
          utilityInvoiced: round2(utilityInvoiced),
          utilityInvoicedBreakdown,
          penaltyInvoiced: round2(penaltyInvoiced),
          depositInvoiced: round2(depositInvoiced),
          otherInvoiced: round2(otherInvoiced),
          periodReceiptTotal: round2(periodReceiptTotal),
          oldestDueDate: oldestDueDateMs ? new Date(oldestDueDateMs).toISOString() : null,
          lastPaymentDate: lastPaymentDateMs ? new Date(lastPaymentDateMs).toISOString() : null,
          status,
        });
      }
    }

    // Sort by property name, then by unit number (natural sort so S2 < S10)
    allRows.sort((a, b) => {
      const propCmp = (a.propertyName || "").localeCompare(b.propertyName || "");
      if (propCmp !== 0) return propCmp;
      return (a.unitNumber || "").localeCompare(b.unitNumber || "", undefined, { numeric: true, sensitivity: "base" });
    });

    const rows = allRows;

    const seenTenantIds = new Set();
    const summary = rows.reduce((acc, row) => {
      acc.totalInvoiced += row.totalInvoiced;
      acc.totalPaidApplied += row.totalPaidApplied;
      acc.totalOutstanding += row.outstanding;
      acc.totalUnappliedCredit += row.unappliedCredit;
      acc.netBalance += row.netBalance;
      if (row.status === "owing") acc.owingCount += 1;
      if (row.status === "credit") acc.creditCount += 1;
      if (row.status === "settled") acc.settledCount += 1;
      seenTenantIds.add(row.tenantId);
      return acc;
    }, {
      totalInvoiced: 0,
      totalPaidApplied: 0,
      totalOutstanding: 0,
      totalUnappliedCredit: 0,
      netBalance: 0,
      owingCount: 0,
      creditCount: 0,
      settledCount: 0,
      tenantCount: 0,
    });
    summary.tenantCount = seenTenantIds.size;

    Object.keys(summary).forEach((key) => {
      if (typeof summary[key] === "number" && !key.endsWith("Count") && key !== "tenantCount") summary[key] = round2(summary[key]);
    });

    return res.status(200).json({
      success: true,
      filters: {
        asOfDate,
        propertyId: req.query.propertyId || "",
        landlordId: req.query.landlordId || "",
        tenantId: req.query.tenantId || "",
        status: req.query.status || "all",
        search: req.query.search || "",
      },
      summary,
      allUtilityTypes: [...allUtilityTypesSet].sort(),
      rows,
    });
  } catch (error) {
    next(error);
  }
};

export const getPropertyIncomeSummaryReport = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) {
      return next(createError(400, "A valid business id is required."));
    }
    const businessOid = new mongoose.Types.ObjectId(String(businessId));

    const startDate = normalizeDate(req.query.startDate || req.query.dateFrom || req.query.from);
    const endDate = normalizeDate(req.query.endDate || req.query.dateTo || req.query.to, true);
    if (!startDate || !endDate) {
      return next(createError(400, "Valid start and end dates are required."));
    }

    // Resolve property scope filter
    let propertyIds = null;
    if (req.query.propertyId) {
      const pid = toObjectId(req.query.propertyId);
      if (pid) propertyIds = [pid];
    } else if (req.query.landlordId) {
      const lid = toObjectId(req.query.landlordId);
      if (lid) {
        const props = await Property.find({ business: businessId, "landlords.landlordId": lid })
          .select("_id")
          .lean();
        propertyIds = props.map((p) => p._id);
        if (!propertyIds.length) {
          return res.status(200).json({
            success: true,
            filters: { startDate, endDate, propertyId: "", landlordId: req.query.landlordId },
            summary: { totalInvoiced: 0, totalCollected: 0, totalExpenses: 0, netIncome: 0, collectionRate: null, propertyCount: 0 },
            byProperty: [],
            expensesByCategory: [],
          });
        }
      }
    }

    const invoiceMatch = {
      business: businessOid,
      category: { $in: ["RENT_CHARGE", "UTILITY_CHARGE"] },
      status: { $nin: ["cancelled", "reversed"] },
      $or: [
        { bookingDate: { $gte: startDate, $lte: endDate } },
        {
          $or: [{ bookingDate: { $exists: false } }, { bookingDate: null }],
          invoiceDate: { $gte: startDate, $lte: endDate },
        },
      ],
    };
    if (propertyIds) invoiceMatch.property = { $in: propertyIds };

    // Deposits are liabilities held in trust â€” they are NOT operating income.
    // Exclude them from the collected total so net income is not overstated.
    const receiptMatch = {
      ...buildEffectiveReceiptQuery({ businessId, startDate, endDate, dateField: "paymentDate" }),
      business: businessOid,  // override: aggregate() needs ObjectId, not string
      paymentType: { $ne: "deposit" },
    };

    const expenseMatch = { business: businessOid, date: { $gte: startDate, $lte: endDate } };
    if (propertyIds) expenseMatch.property = { $in: propertyIds };

    // Pre-fetch unit ids for the requested properties so RentPayment aggregation
    // can filter by `unit` (a direct field) before hitting the $lookup stage.
    let propertyUnitIds = null;
    if (propertyIds) {
      const units = await Unit.find({ property: { $in: propertyIds } }).select("_id").lean();
      propertyUnitIds = units.map((u) => u._id);
      if (propertyUnitIds.length) receiptMatch.unit = { $in: propertyUnitIds };
    }

    const [invoicesByProperty, receiptsByProperty, expensesByPropertyAndCategory] = await Promise.all([
      TenantInvoice.aggregate([
        { $match: invoiceMatch },
        {
          $group: {
            _id: "$property",
            rentInvoiced: { $sum: { $cond: [{ $eq: ["$category", "RENT_CHARGE"] }, "$amount", 0] } },
            utilitiesInvoiced: { $sum: { $cond: [{ $eq: ["$category", "UTILITY_CHARGE"] }, "$amount", 0] } },
            totalInvoiced: { $sum: "$amount" },
            invoiceCount: { $sum: 1 },
          },
        },
      ]).allowDiskUse(true),
      // RentPayment has no `property` field â€” resolved via unit lookup for grouping.
      // When propertyIds is set, receiptMatch.unit already constrains the initial $match,
      // so the post-lookup property filter is not needed.
      RentPayment.aggregate([
        { $match: receiptMatch },
        { $lookup: { from: "units", localField: "unit", foreignField: "_id", as: "_unit" } },
        { $addFields: { _propertyId: { $arrayElemAt: ["$_unit.property", 0] } } },
        {
          $group: {
            _id: "$_propertyId",
            totalCollected: { $sum: "$amount" },
            paymentCount: { $sum: 1 },
          },
        },
      ]).allowDiskUse(true),
      ExpenseProperty.aggregate([
        { $match: expenseMatch },
        {
          $group: {
            _id: { property: "$property", category: "$category" },
            total: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]).allowDiskUse(true),
    ]);

    // Collect all referenced property IDs, then fetch names + sub-accounts in one query
    const allPropertyIds = new Set();
    invoicesByProperty.forEach((r) => r._id && allPropertyIds.add(String(r._id)));
    receiptsByProperty.forEach((r) => r._id && allPropertyIds.add(String(r._id)));
    expensesByPropertyAndCategory.forEach((r) => r._id?.property && allPropertyIds.add(String(r._id.property)));

    const propertyDocs = allPropertyIds.size
      ? await Property.find({ _id: { $in: Array.from(allPropertyIds) } })
          .select("_id propertyName name")
          .lean()
      : [];
    const propertyNameMap = new Map(
      propertyDocs.map((p) => [String(p._id), p.propertyName || p.name || "Unknown Property"])
    );

    // Supplement invoice-based income with manual GL journal adjustments tagged with a
    // property dimension. Auto-posted entries are excluded to avoid double-counting.
    const glAdjustmentByProperty = new Map();
    if (allPropertyIds.size > 0) {
      const allPropIds = Array.from(allPropertyIds).map((id) => new mongoose.Types.ObjectId(id));
      const glRows = await FinancialLedgerEntry.aggregate([
        {
          $match: {
            business: businessOid,
            property: { $in: allPropIds },
            status: { $in: REPORT_LEDGER_STATUSES },
            sourceTransactionType: "manual_adjustment",
            transactionDate: { $gte: startDate, $lte: endDate },
          },
        },
        {
          $group: {
            _id: "$property",
            credit: { $sum: "$credit" },
            debit:  { $sum: "$debit"  },
          },
        },
      ]).allowDiskUse(true);
      for (const row of glRows) {
        const pid = String(row._id);
        const net = round2(Number(row.credit || 0) - Number(row.debit || 0));
        if (net === 0) continue;
        glAdjustmentByProperty.set(pid, round2((glAdjustmentByProperty.get(pid) || 0) + net));
      }
    }

    const propertyMap = new Map();
    const ensureRow = (pid) => {
      const key = String(pid || "unknown");
      if (!propertyMap.has(key)) {
        propertyMap.set(key, {
          propertyId: pid,
          propertyName: propertyNameMap.get(key) || "Unknown Property",
          rentInvoiced: 0,
          utilitiesInvoiced: 0,
          totalInvoiced: 0,
          invoiceCount: 0,
          totalCollected: 0,
          paymentCount: 0,
          expenses: {},
          totalExpenses: 0,
          netIncome: 0,
          collectionRate: null,
        });
      }
      return propertyMap.get(key);
    };

    for (const row of invoicesByProperty) {
      const entry = ensureRow(row._id);
      entry.rentInvoiced = round2(row.rentInvoiced);
      entry.utilitiesInvoiced = round2(row.utilitiesInvoiced);
      entry.totalInvoiced = round2(row.totalInvoiced);
      entry.invoiceCount = row.invoiceCount;
    }

    for (const row of receiptsByProperty) {
      const entry = ensureRow(row._id);
      entry.totalCollected = round2(row.totalCollected);
      entry.paymentCount = row.paymentCount;
    }

    const categoryTotalsMap = new Map();
    for (const row of expensesByPropertyAndCategory) {
      const { property: pid, category } = row._id;
      const entry = ensureRow(pid);
      entry.expenses[category] = round2((entry.expenses[category] || 0) + row.total);
      entry.totalExpenses = round2(entry.totalExpenses + row.total);

      const catEntry = categoryTotalsMap.get(category) || { category, total: 0, count: 0 };
      catEntry.total = round2(catEntry.total + row.total);
      catEntry.count += row.count;
      categoryTotalsMap.set(category, catEntry);
    }

    let grandTotalInvoiced = 0;
    let grandTotalCollected = 0;
    let grandTotalExpenses = 0;

    for (const entry of propertyMap.values()) {
      const key = String(entry.propertyId || "");
      entry.glAdjustmentIncome = glAdjustmentByProperty.get(key) || 0;
      entry.netIncome = round2(entry.totalCollected + entry.glAdjustmentIncome - entry.totalExpenses);
      entry.collectionRate = entry.totalInvoiced > 0
        ? round2((entry.totalCollected / entry.totalInvoiced) * 100)
        : null;
      grandTotalInvoiced += entry.totalInvoiced;
      grandTotalCollected += entry.totalCollected;
      grandTotalExpenses += entry.totalExpenses;
    }

    const byProperty = Array.from(propertyMap.values())
      .sort((a, b) => (a.propertyName || "").localeCompare(b.propertyName || ""));

    const expensesByCategory = Array.from(categoryTotalsMap.values())
      .sort((a, b) => b.total - a.total);

    return res.status(200).json({
      success: true,
      filters: {
        startDate,
        endDate,
        propertyId: req.query.propertyId || "",
        landlordId: req.query.landlordId || "",
      },
      summary: {
        totalInvoiced: round2(grandTotalInvoiced),
        totalCollected: round2(grandTotalCollected),
        totalExpenses: round2(grandTotalExpenses),
        totalGlAdjustments: round2(Array.from(glAdjustmentByProperty.values()).reduce((s, v) => s + v, 0)),
        netIncome: round2(
          grandTotalCollected
          + Array.from(glAdjustmentByProperty.values()).reduce((s, v) => s + v, 0)
          - grandTotalExpenses
        ),
        collectionRate: grandTotalInvoiced > 0
          ? round2((grandTotalCollected / grandTotalInvoiced) * 100)
          : null,
        propertyCount: propertyMap.size,
      },
      byProperty,
      expensesByCategory,
    });
  } catch (error) {
    next(error);
  }
};

const CASH_ACCOUNT_OPERATING_TYPES = new Set([
  // Property management
  "rent_payment", "landlord_receipt", "invoice", "invoice_note",
  "expense", "payment_voucher", "petty_cash_disbursement",
  "petty_cash_replenishment", "meter_reading", "recurring_deduction",
  // Car wash
  "carwash_payment", "carwash_expense", "carwash_prepaid_topup",
  "carwash_savings_disbursement", "carwash_commission_payout",
  // Inventory / POS
  "pos_sale", "pos_purchase_receipt",
  // Property sales
  "property_sale_payment", "property_sale_commission_payout",
  // Payroll
  "payroll_period",
]);
const CASH_ACCOUNT_FINANCING_TYPES = new Set([
  "landlord_payment", "advance", "processed_statement",
  "processed_statement_payment", "deposit",
  "fixed_asset_disposal",
]);
const CASH_FLOW_LABELS = {
  rent_payment:                    "Collections from Tenants",
  landlord_receipt:                "Direct Landlord Receipts",
  invoice:                         "Invoice-Linked Cash",
  invoice_note:                    "Invoice Adjustment Cash",
  expense:                         "Expense Payments",
  payment_voucher:                 "Payment Voucher Disbursements",
  petty_cash_disbursement:         "Petty Cash Disbursements",
  petty_cash_replenishment:        "Petty Cash Replenishments",
  meter_reading:                   "Utility / Meter Charges",
  recurring_deduction:             "Recurring Deduction Payments",
  landlord_payment:                "Landlord Remittances",
  advance:                         "Landlord Advances",
  processed_statement:             "Statement Movements",
  processed_statement_payment:     "Statement Settlement Payments",
  deposit:                         "Security Deposit Movements",
  manual_adjustment:               "Manual Adjustments",
  system_migration:                "System Migration Entries",
  carwash_payment:                 "Car Wash Job Collections",
  carwash_expense:                 "Car Wash Operating Expenses",
  carwash_prepaid_topup:           "Car Wash Prepaid Top-Ups",
  carwash_savings_disbursement:    "Car Wash Staff Savings Disbursements",
  carwash_commission:              "Car Wash Commission Accruals",
  carwash_commission_payout:       "Car Wash Commission Payouts",
  pos_sale:                        "POS Sales Collections",
  pos_purchase_receipt:            "Inventory Purchases",
  pos_stock_adjustment:            "Stock Adjustments",
  property_sale_payment:           "Property Sale Receipts",
  property_sale_commission:        "Property Sale Commission Accruals",
  property_sale_commission_payout: "Property Sale Commission Payouts",
  payroll_period:                  "Payroll Disbursements",
  fixed_asset_depreciation:        "Depreciation (Non-Cash)",
  fixed_asset_disposal:            "Proceeds from Asset Disposals",
  journal_entry:                   "Manual Journal Entries",
  other:                           "Other Movements",
};

export const getCashFlowReport = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) {
      return next(createError(400, "A valid business id is required."));
    }
    const businessOid = new mongoose.Types.ObjectId(String(businessId));

    const startDate = normalizeDate(req.query.startDate || new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    const endDate = normalizeDate(req.query.endDate || new Date(), true);
    if (!startDate || !endDate) {
      return next(createError(400, "Invalid report dates supplied."));
    }
    if (startDate > endDate) {
      return next(createError(400, "Start date cannot be after end date."));
    }

    const cashAccounts = await ChartOfAccount.find({
      business: businessId,
      type: "asset",
      isHeader: { $ne: true },
      isPosting: { $ne: false },
      $or: [
        { subGroup: { $regex: /cash|bank|petty/i } },
        { name: { $regex: /cash|bank|petty/i } },
        { group: { $regex: /cash|bank/i } },
      ],
    }).sort({ code: 1 }).lean();

    if (!cashAccounts.length) {
      return res.status(200).json({
        success: true,
        startDate,
        endDate,
        cashAccounts: [],
        operating: { items: [], totalInflows: 0, totalOutflows: 0, net: 0 },
        financing: { items: [], totalInflows: 0, totalOutflows: 0, net: 0 },
        adjustments: { items: [], totalInflows: 0, totalOutflows: 0, net: 0 },
        summary: { openingCash: 0, netCashFromOperations: 0, netCashFromFinancing: 0, netCashFromAdjustments: 0, netChange: 0, closingCash: 0 },
        note: "No cash or bank accounts identified. Add accounts with 'cash' or 'bank' in the name or sub-group.",
      });
    }

    const cashAccountIds = cashAccounts.map((a) => a._id);

    const openingEndDate = new Date(startDate);
    openingEndDate.setDate(openingEndDate.getDate() - 1);
    openingEndDate.setHours(23, 59, 59, 999);

    const debitExpr = {
      $cond: [{ $gt: ["$debit", 0] }, "$debit", {
        $cond: [{ $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "debit"] }, { $ifNull: ["$amount", 0] }, 0],
      }],
    };
    const creditExpr = {
      $cond: [{ $gt: ["$credit", 0] }, "$credit", {
        $cond: [{ $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "credit"] }, { $ifNull: ["$amount", 0] }, 0],
      }],
    };

    const cashOnlyMatch = { status: "approved", category: { $ne: "REVERSAL" } };
    const [openingAgg, periodAgg] = await Promise.all([
      FinancialLedgerEntry.aggregate([
        { $match: { business: businessOid, accountId: { $in: cashAccountIds }, ...cashOnlyMatch, transactionDate: { $lte: openingEndDate } } },
        { $group: { _id: "$accountId", debit: { $sum: debitExpr }, credit: { $sum: creditExpr } } },
      ]).allowDiskUse(true),
      FinancialLedgerEntry.aggregate([
        { $match: { business: businessOid, accountId: { $in: cashAccountIds }, ...cashOnlyMatch, transactionDate: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: "$sourceTransactionType", debit: { $sum: debitExpr }, credit: { $sum: creditExpr } } },
      ]).allowDiskUse(true),
    ]);

    const openingMap = new Map(openingAgg.map((r) => [String(r._id), round2(r.debit - r.credit)]));

    let totalOpeningCash = 0;
    const cashAccountRows = cashAccounts.map((account) => {
      const opening = openingMap.get(String(account._id)) || 0;
      totalOpeningCash += opening;
      return { _id: account._id, code: account.code, name: account.name, subGroup: account.subGroup || "", openingBalance: opening };
    });

    const operatingItems = [];
    const financingItems = [];
    const adjustmentItems = [];

    for (const row of periodAgg) {
      const sourceType = String(row._id || "other");
      const inflow = round2(row.debit || 0);
      const outflow = round2(row.credit || 0);
      const net = round2(inflow - outflow);
      // Skip items where reversals fully cancel the original in the same period â€” net-zero has no cash flow impact.
      if (Math.abs(net) < 0.01) continue;
      const label = CASH_FLOW_LABELS[sourceType] || sourceType;
      const item = { sourceType, label, inflow, outflow, net };

      if (CASH_ACCOUNT_OPERATING_TYPES.has(sourceType)) {
        operatingItems.push(item);
      } else if (CASH_ACCOUNT_FINANCING_TYPES.has(sourceType)) {
        financingItems.push(item);
      } else {
        adjustmentItems.push(item);
      }
    }

    const sumSection = (items) => {
      const totalInflows = round2(items.reduce((s, i) => s + i.inflow, 0));
      const totalOutflows = round2(items.reduce((s, i) => s + i.outflow, 0));
      return { items: items.sort((a, b) => Math.abs(b.net) - Math.abs(a.net)), totalInflows, totalOutflows, net: round2(totalInflows - totalOutflows) };
    };

    const operating = sumSection(operatingItems);
    const financing = sumSection(financingItems);
    const adjustments = sumSection(adjustmentItems);

    const netChange = round2(operating.net + financing.net + adjustments.net);
    const closingCash = round2(totalOpeningCash + netChange);

    return res.status(200).json({
      success: true,
      startDate,
      endDate,
      cashAccounts: cashAccountRows,
      operating,
      financing,
      adjustments,
      summary: {
        openingCash: round2(totalOpeningCash),
        netCashFromOperations: operating.net,
        netCashFromFinancing: financing.net,
        netCashFromAdjustments: adjustments.net,
        netChange,
        closingCash,
      },
      note: null,
    });
  } catch (error) {
    next(error);
  }
};

export const getMRITaxSummaryReport = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) {
      return next(createError(400, "A valid business id is required."));
    }
    const businessOid = new mongoose.Types.ObjectId(String(businessId));

    const startDate = normalizeDate(req.query.startDate || req.query.dateFrom || req.query.from);
    const endDate = normalizeDate(req.query.endDate || req.query.dateTo || req.query.to, true);
    if (!startDate || !endDate) {
      return next(createError(400, "Valid start and end dates are required."));
    }

    const settingsDoc = await CompanySettings.findOne({ company: businessOid })
      .select("mriRate")
      .lean();
    const MRI_RATE = Number(settingsDoc?.mriRate ?? 0.075);

    let propertyIds = null;
    if (req.query.propertyId) {
      const pid = toObjectId(req.query.propertyId);
      if (pid) propertyIds = [pid];
    }

    // MRI = Monthly Rental Income tax â€” base is rental/utility income only.
    // Deposits are liability receipts, not rental income, and must be excluded.
    const receiptMatch = {
      ...buildEffectiveReceiptQuery({ businessId, startDate, endDate, dateField: "paymentDate" }),
      business: businessOid,  // override: aggregate() needs ObjectId, not string
      paymentType: { $ne: "deposit" },
    };

    // Pre-fetch unit ids so the initial $match filters by `unit` (direct field)
    // before the $lookup stage, avoiding a full collection scan on RentPayment.
    if (propertyIds) {
      const units = await Unit.find({ property: { $in: propertyIds } }).select("_id").lean();
      const unitIds = units.map((u) => u._id);
      if (unitIds.length) receiptMatch.unit = { $in: unitIds };
    }

    const byPropertyMonth = await RentPayment.aggregate([
      { $match: receiptMatch },
      { $lookup: { from: "units", localField: "unit", foreignField: "_id", as: "_unit" } },
      { $addFields: { _propertyId: { $arrayElemAt: ["$_unit.property", 0] } } },
      {
        $group: {
          _id: {
            property: "$_propertyId",
            year: { $year: "$paymentDate" },
            month: { $month: "$paymentDate" },
          },
          grossRent: { $sum: "$amount" },
          receiptCount: { $sum: 1 },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]).allowDiskUse(true);

    const propertyIdSet = new Set(byPropertyMonth.map((r) => String(r._id.property)).filter(Boolean));
    const propertyDocs = propertyIdSet.size
      ? await Property.find({ _id: { $in: Array.from(propertyIdSet) } }).select("_id propertyName name").lean()
      : [];
    const propertyNameMap = new Map(propertyDocs.map((p) => [String(p._id), p.propertyName || p.name || "Unknown Property"]));

    const propertyMap = new Map();
    const monthlyTotalsMap = new Map();

    const ensurePropertyEntry = (pid) => {
      const key = String(pid || "unknown");
      if (!propertyMap.has(key)) {
        propertyMap.set(key, {
          propertyId: pid,
          propertyName: propertyNameMap.get(key) || "Unknown Property",
          grossRent: 0,
          mriTax: 0,
          months: [],
        });
      }
      return propertyMap.get(key);
    };

    for (const row of byPropertyMonth) {
      const { property: pid, year, month } = row._id;
      const entry = ensurePropertyEntry(pid);
      const grossRent = round2(row.grossRent);
      const mriTax = round2(grossRent * MRI_RATE);

      entry.grossRent = round2(entry.grossRent + grossRent);
      entry.mriTax = round2(entry.mriTax + mriTax);
      entry.months.push({ year, month, grossRent, mriTax, receiptCount: row.receiptCount });

      const monthKey = `${year}-${String(month).padStart(2, "0")}`;
      const monthEntry = monthlyTotalsMap.get(monthKey) || { year, month, monthKey, grossRent: 0, mriTax: 0 };
      monthEntry.grossRent = round2(monthEntry.grossRent + grossRent);
      monthEntry.mriTax = round2(monthEntry.mriTax + mriTax);
      monthlyTotalsMap.set(monthKey, monthEntry);
    }

    let grandGrossRent = 0;
    let grandMriTax = 0;
    for (const entry of propertyMap.values()) {
      grandGrossRent += entry.grossRent;
      grandMriTax += entry.mriTax;
    }

    const byProperty = Array.from(propertyMap.values())
      .sort((a, b) => (a.propertyName || "").localeCompare(b.propertyName || ""));
    const byMonth = Array.from(monthlyTotalsMap.values())
      .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);

    return res.status(200).json({
      success: true,
      mriRate: MRI_RATE,
      filters: {
        startDate,
        endDate,
        propertyId: req.query.propertyId || "",
      },
      summary: {
        grossRent: round2(grandGrossRent),
        mriTax: round2(grandMriTax),
        propertyCount: propertyMap.size,
      },
      byProperty,
      byMonth,
    });
  } catch (error) {
    next(error);
  }
};

// â”€â”€â”€ AR / AP Aging helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const AGING_BUCKETS = [
  { key: "current",   label: "Current",    min: null, max: 0   },
  { key: "d1_30",     label: "1â€“30 days",  min: 1,    max: 30  },
  { key: "d31_60",    label: "31â€“60 days", min: 31,   max: 60  },
  { key: "d61_90",    label: "61â€“90 days", min: 61,   max: 90  },
  { key: "d90plus",   label: "90+ days",   min: 91,   max: null },
];

const assignBucket = (daysOverdue) => {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "d1_30";
  if (daysOverdue <= 60) return "d31_60";
  if (daysOverdue <= 90) return "d61_90";
  return "d90plus";
};

// â”€â”€â”€ AR Aging â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const getARAgingReport = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));

    const asOf = req.query.asOf ? new Date(req.query.asOf) : new Date();
    asOf.setHours(23, 59, 59, 999);

    // Fetch outstanding invoices AND debit notes in parallel â€” both are receivable documents.
    const [invoices, debitNotes] = await Promise.all([
      TenantInvoice.find({
        business: businessId,
        status: { $in: ["pending", "partially_paid"] },
        dueDate: { $lte: asOf },
      })
        .populate("tenant", "tenantName name email phone")
        .populate("property", "propertyName name")
        .populate("unit", "unitNumber name")
        .limit(5000)
        .lean(),
      TenantInvoiceNote.find({
        business: businessId,
        noteType: "DEBIT_NOTE",
        status: { $nin: ["paid", "cancelled", "reversed"] },
        noteDate: { $lte: asOf },
      })
        .populate("tenant", "tenantName name email phone")
        .populate("property", "propertyName name")
        .populate("unit", "unitNumber name")
        .limit(5000)
        .lean(),
    ]);

    if (!invoices.length && !debitNotes.length) {
      return res.status(200).json({
        success: true,
        asOf,
        rows: [],
        totals: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 },
        buckets: AGING_BUCKETS,
      });
    }

    const tenantIds = [
      ...new Set([
        ...invoices.map((inv) => String(inv.tenant?._id || inv.tenant)),
        ...debitNotes.map((n) => String(n.tenant?._id || n.tenant)),
      ].filter(Boolean)),
    ];

    // Use the same allocation engine as the PM module (handles legacy receipts without stored allocations)
    const snapshotBundles = await computeTenantInvoiceSnapshotsBatch({
      businessId,
      tenantIds,
      asOfDate: asOf,
    });

    const outstandingMap = new Map();
    for (const [, bundle] of snapshotBundles) {
      for (const snapshot of bundle.invoiceSnapshots || []) {
        const outstanding = round2(Math.max(0, Number(snapshot.outstanding || 0)));
        outstandingMap.set(String(snapshot._id), outstanding);
      }
    }

    const totals = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 };
    const rows = [];

    for (const inv of invoices) {
      const outstanding = outstandingMap.get(String(inv._id));
      if (!outstanding || outstanding <= 0) continue;

      if (!inv.dueDate) continue;
      const applied = round2(inv.amount - outstanding);
      const daysOverdue = Math.floor((asOf - new Date(inv.dueDate)) / 86_400_000);
      const bucket = assignBucket(daysOverdue);
      totals[bucket] = round2(totals[bucket] + outstanding);
      totals.total = round2(totals.total + outstanding);

      rows.push({
        invoiceId: inv._id,
        invoiceNumber: inv.invoiceNumber,
        tenantId: inv.tenant?._id,
        tenantName: inv.tenant?.tenantName || inv.tenant?.name || "â€”",
        propertyName: inv.property?.propertyName || inv.property?.name || "â€”",
        unitName: inv.unit?.unitNumber || inv.unit?.name || "â€”",
        invoiceDate: inv.invoiceDate,
        dueDate: inv.dueDate,
        amount: inv.amount,
        applied,
        outstanding,
        daysOverdue,
        bucket,
        category: inv.category,
      });
    }

    // Debit notes are separate receivable documents â€” include them in the aging schedule
    for (const note of debitNotes) {
      const outstanding = outstandingMap.get(String(note._id));
      if (!outstanding || outstanding <= 0) continue;

      const refDate = note.noteDate || note.createdAt;
      if (!refDate) continue;
      const applied = round2(note.amount - outstanding);
      const daysOverdue = Math.floor((asOf - new Date(refDate)) / 86_400_000);
      const bucket = assignBucket(daysOverdue);
      totals[bucket] = round2(totals[bucket] + outstanding);
      totals.total = round2(totals.total + outstanding);

      rows.push({
        invoiceId: note._id,
        invoiceNumber: note.noteNumber,
        tenantId: note.tenant?._id,
        tenantName: note.tenant?.tenantName || note.tenant?.name || "â€”",
        propertyName: note.property?.propertyName || note.property?.name || "â€”",
        unitName: note.unit?.unitNumber || note.unit?.name || "â€”",
        invoiceDate: refDate,
        dueDate: refDate,
        amount: note.amount,
        applied,
        outstanding,
        daysOverdue,
        bucket,
        category: note.category || "DEBIT_NOTE",
        isDebitNote: true,
      });
    }

    rows.sort((a, b) => b.daysOverdue - a.daysOverdue);

    return res.status(200).json({ success: true, asOf, rows, totals, buckets: AGING_BUCKETS });
  } catch (error) {
    next(error);
  }
};

// â”€â”€â”€ AP Aging â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const getAPAgingReport = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));

    const asOf = req.query.asOf ? new Date(req.query.asOf) : new Date();
    asOf.setHours(23, 59, 59, 999);

    const vouchers = await PaymentVoucher.find({
      business: businessId,
      status: { $in: ["draft", "approved"] },
    })
      .populate("property", "propertyName")
      .populate("landlord", "name")
      .limit(5000)
      .lean();

    const totals = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 };
    const rows = [];

    for (const v of vouchers) {
      const outstanding = round2(v.amount || 0);
      if (outstanding <= 0) continue;
      if (!v.dueDate) continue;

      const daysOverdue = Math.floor((asOf - new Date(v.dueDate)) / 86_400_000);
      const bucket = assignBucket(daysOverdue);
      totals[bucket] = round2(totals[bucket] + outstanding);
      totals.total = round2(totals.total + outstanding);

      rows.push({
        voucherId: v._id,
        reference: v.reference || v.voucherNo || String(v._id).slice(-6),
        narration: v.narration || "â€”",
        category: v.category,
        status: v.status,
        propertyName: v.property?.propertyName || "â€”",
        landlordName: v.landlord?.name || "â€”",
        dueDate: v.dueDate,
        amount: outstanding,
        daysOverdue,
        bucket,
      });
    }

    rows.sort((a, b) => b.daysOverdue - a.daysOverdue);

    return res.status(200).json({ success: true, asOf, rows, totals, buckets: AGING_BUCKETS });
  } catch (error) {
    next(error);
  }
};

// â”€â”€â”€ Cash Monthly Summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns cashIn / cashOut per month for the last N months (default 6).
// cashIn  = debits  to cashbook accounts (money received into cash/bank)
// cashOut = credits from cashbook accounts (money paid out of cash/bank)
export const getCashMonthlySummary = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));

    const months = Math.max(1, Math.min(24, Number(req.query.months || 6)));
    const from = new Date();
    from.setMonth(from.getMonth() - (months - 1));
    from.setDate(1);
    from.setHours(0, 0, 0, 0);

    const businessOid = new mongoose.Types.ObjectId(String(businessId));

    // Dynamic lookup: find all posting cash/bank accounts for this company.
    // Primary: name/subGroup/group regex (same strategy as Cash Flow report).
    // Fallback: standard account codes used during system setup.
    const cashbookAccounts = await ChartOfAccount.find({
      business: businessId,
      isPosting: { $ne: false },
      isHeader: { $ne: true },
      type: "asset",
      $or: [
        { subGroup: { $regex: /cash|bank|petty/i } },
        { name:     { $regex: /cash|bank|petty/i } },
        { group:    { $regex: /cash|bank/i } },
        { code:     { $in: ["1100", "1110", "1130", "1310", "1311"] } },
      ],
    }, { _id: 1 }).lean();

    if (!cashbookAccounts.length) return res.status(200).json({ success: true, data: [] });

    const accountIds = cashbookAccounts.map((a) => a._id);

    // Use explicit debit/credit fields first; fall back to direction+amount for legacy entries.
    const debitExpr = {
      $cond: [{ $gt: ["$debit", 0] }, "$debit", {
        $cond: [{ $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "debit"] }, { $ifNull: ["$amount", 0] }, 0],
      }],
    };
    const creditExpr = {
      $cond: [{ $gt: ["$credit", 0] }, "$credit", {
        $cond: [{ $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "credit"] }, { $ifNull: ["$amount", 0] }, 0],
      }],
    };

    const rows = await FinancialLedgerEntry.aggregate([
      {
        $match: {
          business: businessOid,
          accountId: { $in: accountIds },
          transactionDate: { $gte: from },
          status: "approved",
          category: { $ne: "REVERSAL" },
        },
      },
      {
        $group: {
          _id: { y: { $year: "$transactionDate" }, m: { $month: "$transactionDate" } },
          cashIn:  { $sum: debitExpr },
          cashOut: { $sum: creditExpr },
        },
      },
    ]).allowDiskUse(true);

    // Build lookup: "YYYY-M" â†’ { cashIn, cashOut }
    const map = {};
    for (const row of rows) {
      const key = `${row._id.y}-${row._id.m}`;
      map[key] = { cashIn: round2(row.cashIn || 0), cashOut: round2(row.cashOut || 0) };
    }

    // Return one entry per month in chronological order
    const data = Array.from({ length: months }, (_, i) => {
      const d = new Date(from.getFullYear(), from.getMonth() + i, 1);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
      const label = d.toLocaleDateString("en-GB", { month: "short" });
      return { month: label, cashIn: map[key]?.cashIn ?? 0, cashOut: map[key]?.cashOut ?? 0 };
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

// â”€â”€â”€ TRIAL BALANCE EXCEPTIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns accounts with unusual/flagged balance conditions. Each flag has a
// severity so the UI can colour-code: critical / warning / info.
export const getTrialBalanceExceptions = async (req, res, next) => {
  try {
    const businessId =
      req.query?.business || req.query?.company ||
      req.body?.business || req.body?.company ||
      req.user?.company;
    if (!businessId) return next(createError(400, "Business required"));

    const bizId = new mongoose.Types.ObjectId(String(businessId));

    // Get net balance per account from the ledger.
    // Must include both "approved" and "reversed" entries so that reversed
    // originals and their correcting entries net to zero. Using only "approved"
    // would leave the correction debit without its original credit, triggering
    // false-positive abnormal-balance warnings on receipts/invoices that were
    // legitimately reversed and re-entered.
    const [accountBalances, accounts] = await Promise.all([
      FinancialLedgerEntry.aggregate([
        { $match: { business: bizId, status: { $in: REPORT_LEDGER_STATUSES } } },
        {
          $group: {
            _id: "$accountId",
            totalDebit: { $sum: "$debit" },
            totalCredit: { $sum: "$credit" },
            entryCount: { $sum: 1 },
            lastEntry: { $max: "$transactionDate" },
          },
        },
        { $addFields: { netBalance: { $subtract: ["$totalDebit", "$totalCredit"] } } },
      ]),
      ChartOfAccount.find({ business: bizId }, {
        _id: 1, code: 1, name: 1, type: 1, group: 1, isActive: 1,
      }).lean(),
    ]).allowDiskUse(true);
    const accountMap = new Map(accounts.map((a) => [String(a._id), a]));

    const exceptions = [];

    for (const row of accountBalances) {
      const acc = accountMap.get(String(row._id));
      if (!acc) continue;

      const isDebitNormal = ["asset", "expense"].includes(acc.type);
      const netBal = row.netBalance;

      // Abnormal sign
      if (isDebitNormal && netBal < -1) {
        exceptions.push({
          severity: "warning",
          flag: "abnormal_credit_balance",
          message: `${acc.type} account has a credit balance (${netBal.toFixed(2)})`,
          account: { id: row._id, code: acc.code, name: acc.name, type: acc.type },
          netBalance: netBal,
          entryCount: row.entryCount,
          lastEntry: row.lastEntry,
        });
      }
      if (!isDebitNormal && netBal > 1) {
        exceptions.push({
          severity: "warning",
          flag: "abnormal_debit_balance",
          message: `${acc.type} account has a debit balance (${netBal.toFixed(2)})`,
          account: { id: row._id, code: acc.code, name: acc.name, type: acc.type },
          netBalance: netBal,
          entryCount: row.entryCount,
          lastEntry: row.lastEntry,
        });
      }

      // Zero balance accounts with prior activity (potential stale/orphaned)
      if (Math.abs(netBal) < 0.01 && row.entryCount > 0) {
        exceptions.push({
          severity: "info",
          flag: "zero_balance_with_activity",
          message: `Account has ${row.entryCount} entries but net zero balance â€” may indicate matched reversal`,
          account: { id: row._id, code: acc.code, name: acc.name, type: acc.type },
          netBalance: netBal,
          entryCount: row.entryCount,
          lastEntry: row.lastEntry,
        });
      }

      // Inactive account with recent activity
      if (acc.isActive === false && row.entryCount > 0) {
        exceptions.push({
          severity: "critical",
          flag: "inactive_account_has_entries",
          message: `Deactivated account still has ${row.entryCount} ledger entries`,
          account: { id: row._id, code: acc.code, name: acc.name, type: acc.type },
          netBalance: netBal,
          entryCount: row.entryCount,
          lastEntry: row.lastEntry,
        });
      }
    }

    exceptions.sort((a, b) => {
      const order = { critical: 0, warning: 1, info: 2 };
      return (order[a.severity] || 3) - (order[b.severity] || 3);
    });

    return res.status(200).json({
      success: true,
      count: exceptions.length,
      exceptions,
    });
  } catch (err) {
    next(err);
  }
};

// â”€â”€â”€ FINANCIAL RATIOS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const getFinancialRatios = async (req, res, next) => {
  try {
    const businessId =
      req.query?.business || req.query?.company || req.user?.company;
    if (!businessId) return next(createError(400, "Business required"));

    const bizId = new mongoose.Types.ObjectId(String(businessId));

    // Get per-account net balances â€” use REPORT_LEDGER_STATUSES so reversed
    // originals and their corrections net to zero before ratio calculation.
    const [rows, accounts] = await Promise.all([
      FinancialLedgerEntry.aggregate([
        { $match: { business: bizId, status: { $in: REPORT_LEDGER_STATUSES } } },
        {
          $group: {
            _id: "$accountId",
            totalDebit: { $sum: "$debit" },
            totalCredit: { $sum: "$credit" },
          },
        },
        { $addFields: { netBalance: { $subtract: ["$totalDebit", "$totalCredit"] } } },
      ]),
      ChartOfAccount.find({ business: bizId }, {
        _id: 1, type: 1, group: 1, subGroup: 1,
      }).lean(),
    ]).allowDiskUse(true);
    const accMap = new Map(accounts.map((a) => [String(a._id), a]));

    let currentAssets = 0, nonCurrentAssets = 0;
    let currentLiabilities = 0, nonCurrentLiabilities = 0;
    let totalEquity = 0, totalIncome = 0, totalExpenses = 0;
    let totalRevenue = 0, costOfRevenue = 0;

    for (const row of rows) {
      const acc = accMap.get(String(row._id));
      if (!acc) continue;
      const net = row.netBalance;
      const g = String(acc.group || "").toLowerCase();
      const sg = String(acc.subGroup || "").toLowerCase();

      if (acc.type === "asset") {
        if (g.includes("current") || sg.includes("current")) currentAssets += net;
        else nonCurrentAssets += net;
      } else if (acc.type === "liability") {
        if (g.includes("current") || sg.includes("current")) currentLiabilities += Math.abs(net);
        else nonCurrentLiabilities += Math.abs(net);
      } else if (acc.type === "equity") {
        totalEquity += Math.abs(net);
      } else if (acc.type === "income") {
        totalIncome += Math.abs(net);
        if (sg.includes("revenue") || sg.includes("sales") || sg === "") totalRevenue += Math.abs(net);
        else if (sg.includes("cost") || sg.includes("cogs")) costOfRevenue += Math.abs(net);
      } else if (acc.type === "expense") {
        totalExpenses += Math.abs(net);
        if (sg.includes("cost") || sg.includes("cogs")) costOfRevenue += Math.abs(net);
      }
    }

    const totalAssets = currentAssets + nonCurrentAssets;
    const netIncome = totalIncome - totalExpenses;
    const grossProfit = totalRevenue - costOfRevenue;

    const ratios = {
      currentRatio: currentLiabilities > 0 ? +(currentAssets / currentLiabilities).toFixed(2) : null,
      debtToEquity: totalEquity > 0 ? +((currentLiabilities + nonCurrentLiabilities) / totalEquity).toFixed(2) : null,
      returnOnAssets: totalAssets > 0 ? +((netIncome / totalAssets) * 100).toFixed(2) : null,
      grossMargin: totalRevenue > 0 ? +((grossProfit / totalRevenue) * 100).toFixed(2) : null,
      netMargin: totalRevenue > 0 ? +((netIncome / totalRevenue) * 100).toFixed(2) : null,
    };

    return res.status(200).json({
      success: true,
      ratios,
      components: {
        currentAssets: +currentAssets.toFixed(2),
        nonCurrentAssets: +nonCurrentAssets.toFixed(2),
        currentLiabilities: +currentLiabilities.toFixed(2),
        nonCurrentLiabilities: +nonCurrentLiabilities.toFixed(2),
        totalEquity: +totalEquity.toFixed(2),
        totalIncome: +totalIncome.toFixed(2),
        totalExpenses: +totalExpenses.toFixed(2),
        netIncome: +netIncome.toFixed(2),
        totalRevenue: +totalRevenue.toFixed(2),
        grossProfit: +grossProfit.toFixed(2),
      },
    });
  } catch (err) {
    next(err);
  }
};

// â”€â”€â”€ YEAR-END CLOSE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Closes all income/expense accounts for the given fiscal year into Retained
// Earnings (account 3200). Posts a closing journal entry and locks the period.
export const performYearEndClose = async (req, res, next) => {
  try {
    const businessId =
      req.body?.business || req.body?.company || req.user?.company;
    if (!businessId) return next(createError(400, "Business required"));

    const { periodId, fiscalYear, narration } = req.body || {};
    if (!fiscalYear) return next(createError(400, "fiscalYear (e.g. 2025) is required"));

    const year = parseInt(fiscalYear, 10);
    if (!year || year < 2000) return next(createError(400, "Invalid fiscalYear"));

    const yearStart = new Date(year, 0, 1, 0, 0, 0, 0);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);

    // Check period exists and is closed (not open)
    let period = null;
    if (periodId) {
      period = await AccountingPeriod.findOne({ _id: periodId, business: businessId });
      if (!period) return next(createError(404, "Accounting period not found"));
      if (period.status === "open") return next(createError(400, "Close the period before running year-end close"));
      if (period.yearEndClosed) return next(createError(400, "Year-end close has already been run for this period"));
    }

    const bizId = new mongoose.Types.ObjectId(String(businessId));

    // Sum income and expense ledger entries for the year.
    // Must use REPORT_LEDGER_STATUSES (approved + reversed) so that reversed
    // originals and their correcting entries net to zero â€” same logic as every
    // other financial report. Using "approved" only would double-count the
    // debit leg of a reversal while missing the original credit, understating income.
    const rows = await FinancialLedgerEntry.aggregate([
      {
        $match: {
          business: bizId,
          status: { $in: REPORT_LEDGER_STATUSES },
          transactionDate: { $gte: yearStart, $lte: yearEnd },
        },
      },
      {
        $lookup: {
          from: "chartofaccounts",
          localField: "accountId",
          foreignField: "_id",
          as: "account",
        },
      },
      { $unwind: "$account" },
      { $match: { "account.type": { $in: ["income", "expense"] } } },
      {
        $group: {
          _id: { accountId: "$accountId", type: "$account.type" },
          totalDebit: { $sum: "$debit" },
          totalCredit: { $sum: "$credit" },
        },
      },
    ]).allowDiskUse(true);

    let totalIncomeCredit = 0;
    let totalExpenseDebit = 0;
    for (const row of rows) {
      if (row._id.type === "income") totalIncomeCredit += row.totalCredit - row.totalDebit;
      if (row._id.type === "expense") totalExpenseDebit += row.totalDebit - row.totalCredit;
    }

    const netIncome = totalIncomeCredit - totalExpenseDebit;
    if (Math.abs(netIncome) < 0.01) {
      return res.status(400).json({
        message: "Net income for the year is zero â€” nothing to close",
        netIncome,
      });
    }

    // Resolve retained earnings account (code 3200)
    await ensureSystemChartOfAccounts(businessId);
    const retainedEarningsAccount = await findSystemAccountByCode(businessId, "3200");
    if (!retainedEarningsAccount) {
      return next(createError(400, "Retained Earnings account (3200) not found. Ensure your chart of accounts is set up correctly."));
    }

    // Resolve an income summary account â€” we use retained earnings directly here
    // (single-step close: net income â†’ retained earnings)
    const userId = req.user?._id || req.user?.id;
    const closeNarration = narration || `Year-end close ${year}: net income KES ${netIncome.toFixed(2)} â†’ Retained Earnings`;

    // Post to retained earnings: debit if net loss, credit if net income
    const direction = netIncome >= 0 ? "credit" : "debit";
    const amount = Math.abs(netIncome);

    await postEntry({
      business: String(businessId),
      sourceTransactionType: "year_end_close",
      sourceTransactionId: `YEC-${year}`,
      transactionDate: yearEnd,
      statementPeriodStart: yearStart,
      statementPeriodEnd: yearEnd,
      category: "YEAR_END_CLOSE",
      accountId: retainedEarningsAccount._id,
      amount,
      direction,
      debit: direction === "debit" ? amount : 0,
      credit: direction === "credit" ? amount : 0,
      payer: "system",
      receiver: "retained_earnings",
      notes: closeNarration,
      createdBy: userId,
      approvedBy: userId,
      approvedAt: new Date(),
      status: "approved",
      allowUnscoped: true,
      allowNoAccount: false,
    });

    // Lock the period if provided
    if (period) {
      period.yearEndClosed = true;
      period.status = "locked";
      period.lockedBy = userId || null;
      period.lockedAt = new Date();
      await period.save();
    }

    return res.status(200).json({
      success: true,
      message: `Year-end close completed for ${year}. Net ${netIncome >= 0 ? "income" : "loss"} of KES ${amount.toFixed(2)} closed to Retained Earnings.`,
      netIncome: +netIncome.toFixed(2),
      retainedEarningsAccountCode: retainedEarningsAccount.code,
      periodLocked: !!period,
    });
  } catch (err) {
    next(err);
  }
};

// â”€â”€â”€ Liability Sub-Ledger â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Breaks down each liability account into its constituent entries so the
// Balance Sheet total can be reconciled to individual tenants / landlords.
// tabs: deposits (2100) | landlord (2110) | unallocated (2130) | tax (2140) | wht (2141)
export const getLiabilitySubledger = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Business context is required."));
    const businessOid = new mongoose.Types.ObjectId(String(businessId));

    const tab       = String(req.query.tab || "deposits").toLowerCase();
    const asOfDate  = req.query.asOf ? normalizeDate(req.query.asOf, true) : null;
    const propertyOid =
      req.query.property && mongoose.Types.ObjectId.isValid(String(req.query.property))
        ? new mongoose.Types.ObjectId(String(req.query.property))
        : null;

    await ensureSystemChartOfAccounts(businessId);

    const codeMap   = { deposits: "2100", landlord: "2110", unallocated: "2130", tax: "2140", wht: "2141" };
    const accountCode = codeMap[tab] ?? "2100";
    const account   = await findSystemAccountByCode(businessId, accountCode);

    if (!account) {
      return res.json({ success: true, tab, accountCode, accountName: "", total: 0, groups: [] });
    }

    const glMatch = {
      business:  businessOid,
      accountId: account._id,
      status:    { $in: REPORT_LEDGER_STATUSES },
      ...(asOfDate    ? { transactionDate: { $lte: asOfDate } } : {}),
      ...(propertyOid ? { property: propertyOid }               : {}),
    };

    // Mirrors buildLedgerMap's debit/credit normalisation for legacy entries
    const debitExpr = {
      $cond: [
        { $gt: ["$debit", 0] }, "$debit",
        { $cond: [{ $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "debit"] }, { $ifNull: ["$amount", 0] }, 0] },
      ],
    };
    const creditExpr = {
      $cond: [
        { $gt: ["$credit", 0] }, "$credit",
        { $cond: [{ $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "credit"] }, { $ifNull: ["$amount", 0] }, 0] },
      ],
    };

    // â”€â”€ 2110 Landlord Payables â€” group by property â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (tab === "landlord") {
      const agg = await FinancialLedgerEntry.aggregate([
        { $match: glMatch },
        { $group: { _id: "$property", credit: { $sum: creditExpr }, debit: { $sum: debitExpr } } },
      ]).allowDiskUse(true);

      const rows = agg
        .map((r) => ({ propertyId: r._id, balance: round2(r.credit - r.debit) }))
        .filter((r) => r.balance > 0.005 && r.propertyId);

      const total = round2(rows.reduce((s, r) => s + r.balance, 0));
      if (!rows.length) return res.json({ success: true, tab, accountCode, accountName: account.name, total: 0, groups: [] });

      const properties = await Property.find({ _id: { $in: rows.map((r) => r.propertyId) }, business: businessId })
        .select("propertyName propertyCode landlords")
        .lean();
      const propMap = new Map(properties.map((p) => [String(p._id), p]));

      const landlordIds = [
        ...new Set(
          properties.flatMap((p) =>
            (Array.isArray(p.landlords) ? p.landlords : [])
              .map((l) => String(l?.landlordId || ""))
              .filter(Boolean)
          )
        ),
      ].filter(mongoose.Types.ObjectId.isValid);

      const Landlord = (await import("../../models/Landlord.js")).default;
      const landlordDocs = landlordIds.length
        ? await Landlord.find({ _id: { $in: landlordIds } }).select("landlordName").lean()
        : [];
      const landlordMap = new Map(landlordDocs.map((l) => [String(l._id), l.landlordName || ""]));

      const groups = rows
        .sort((a, b) => b.balance - a.balance)
        .map((r) => {
          const prop  = propMap.get(String(r.propertyId));
          const refs  = Array.isArray(prop?.landlords) ? prop.landlords : [];
          const primary = refs.find((l) => l.isPrimary && l.landlordId) || refs.find((l) => l.landlordId);
          return {
            propertyId:   String(r.propertyId),
            propertyName: prop?.propertyName || "Unknown Property",
            propertyCode: prop?.propertyCode || "",
            landlordName: primary?.landlordId ? (landlordMap.get(String(primary.landlordId)) || "") : "",
            balance:      r.balance,
          };
        });

      return res.json({ success: true, tab, accountCode, accountName: account.name, total, groups });
    }

    // â”€â”€ 2140 Tax Payable â€” group by source transaction then by month â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (tab === "tax") {
      const agg = await FinancialLedgerEntry.aggregate([
        { $match: glMatch },
        {
          $group: {
            _id:                   "$sourceTransactionId",
            credit:                { $sum: creditExpr },
            debit:                 { $sum: debitExpr },
            transactionDate:       { $last: "$transactionDate" },
            notes:                 { $last: "$notes" },
            sourceTransactionType: { $last: "$sourceTransactionType" },
            property:              { $last: "$property" },
          },
        },
      ]).allowDiskUse(true);

      const rows = agg
        .map((r) => ({
          sourceId:   r._id,
          balance:    round2(r.credit - r.debit),
          date:       r.transactionDate,
          notes:      r.notes || "",
          sourceType: r.sourceTransactionType || "",
          propertyId: r.property,
        }))
        .filter((r) => r.balance > 0.005);

      const total = round2(rows.reduce((s, r) => s + r.balance, 0));
      if (!rows.length) return res.json({ success: true, tab, accountCode, accountName: account.name, total: 0, groups: [] });

      // Resolve reference numbers from source documents
      const invoiceIds   = rows.filter((r) => r.sourceType === "invoice"              && r.sourceId).map((r) => r.sourceId);
      const statementIds = rows.filter((r) => r.sourceType === "processed_statement"  && r.sourceId).map((r) => r.sourceId);

      const [invoiceDocs, statementDocs] = await Promise.all([
        invoiceIds.length
          ? TenantInvoice.find({ _id: { $in: invoiceIds } }).select("invoiceNumber description").lean()
          : [],
        statementIds.length
          ? (await import("../../models/ProcessedStatement.js")).default
              .find({ _id: { $in: statementIds } }).select("sourceStatementNumber periodStart periodEnd").lean()
          : [],
      ]);
      const invoiceMap   = new Map(invoiceDocs.map((d) => [String(d._id), d]));
      const statementMap = new Map(statementDocs.map((d) => [String(d._id), d]));

      const propIds = [...new Set(rows.map((r) => r.propertyId).filter(Boolean))];
      const props   = propIds.length
        ? await Property.find({ _id: { $in: propIds } }).select("propertyName").lean()
        : [];
      const propNameMap = new Map(props.map((p) => [String(p._id), p.propertyName]));

      const byMonth = new Map();
      rows.forEach((r) => {
        let reference = "";
        let narration = r.notes;
        if (r.sourceType === "invoice") {
          const inv = invoiceMap.get(String(r.sourceId));
          reference = inv?.invoiceNumber || "";
          narration = narration || inv?.description || "";
        } else if (r.sourceType === "processed_statement") {
          const stmt = statementMap.get(String(r.sourceId));
          reference = stmt?.sourceStatementNumber || "";
        }

        const d     = new Date(r.date || new Date());
        const key   = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const label = d.toLocaleString("en-KE", { month: "long", year: "numeric" });
        if (!byMonth.has(key)) byMonth.set(key, { month: key, monthLabel: label, subtotal: 0, rows: [] });
        const g = byMonth.get(key);
        g.subtotal = round2(g.subtotal + r.balance);
        g.rows.push({
          sourceId:   String(r.sourceId || ""),
          reference,
          narration,
          property:   r.propertyId ? (propNameMap.get(String(r.propertyId)) || "") : "",
          vatBalance: r.balance,
          date:       r.date,
        });
      });

      const groups = [...byMonth.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([, g]) => g);

      return res.json({ success: true, tab, accountCode, accountName: account.name, total, groups });
    }

    // â”€â”€ 2141 WHT Payable â€” group by source voucher then by month â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (tab === "wht") {
      const agg = await FinancialLedgerEntry.aggregate([
        { $match: glMatch },
        {
          $group: {
            _id:             "$sourceTransactionId",
            credit:          { $sum: creditExpr },
            debit:           { $sum: debitExpr },
            transactionDate: { $last: "$transactionDate" },
          },
        },
      ]).allowDiskUse(true);

      const rows = agg
        .map((r) => ({ sourceId: r._id, balance: round2(r.credit - r.debit), date: r.transactionDate }))
        .filter((r) => r.balance > 0.005);

      const total = round2(rows.reduce((s, r) => s + r.balance, 0));
      if (!rows.length) return res.json({ success: true, tab, accountCode, accountName: account.name, total: 0, groups: [] });

      const voucherIds = rows.map((r) => r.sourceId).filter(Boolean);
      const vouchers   = voucherIds.length
        ? await PaymentVoucher.find({ _id: { $in: voucherIds } })
            .populate("serviceProvider", "name")
            .populate("property", "propertyName")
            .select("voucherNo narration amount whtAmount paidDate serviceProvider property")
            .lean()
        : [];
      const vMap = new Map(vouchers.map((v) => [String(v._id), v]));

      const byMonth = new Map();
      rows.forEach((r) => {
        const v = vMap.get(String(r.sourceId));
        const d = new Date(v?.paidDate || r.date || new Date());
        const key   = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const label = d.toLocaleString("en-KE", { month: "long", year: "numeric" });
        if (!byMonth.has(key)) byMonth.set(key, { month: key, monthLabel: label, subtotal: 0, rows: [] });
        const g = byMonth.get(key);
        g.subtotal = round2(g.subtotal + r.balance);
        g.rows.push({
          sourceId:    String(r.sourceId),
          voucherNo:   v?.voucherNo   || "â€”",
          narration:   v?.narration   || "",
          vendor:      v?.serviceProvider?.name || "",
          property:    v?.property?.propertyName || "",
          grossAmount: round2(Math.abs(Number(v?.amount    || 0))),
          whtBalance:  r.balance,
          date:        v?.paidDate || r.date,
        });
      });

      const groups = [...byMonth.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([, g]) => g);

      return res.json({ success: true, tab, accountCode, accountName: account.name, total, groups });
    }

    // â”€â”€ 2100 Deposits / 2130 Unallocated â€” group by tenant then by property â”€â”€â”€
    const agg = await FinancialLedgerEntry.aggregate([
      { $match: glMatch },
      {
        $group: {
          _id:      "$tenant",
          credit:   { $sum: creditExpr },
          debit:    { $sum: debitExpr },
          property: { $last: "$property" },
        },
      },
    ]).allowDiskUse(true);

    const rows = agg
      .map((r) => ({ tenantId: r._id, balance: round2(r.credit - r.debit), propertyId: r.property }))
      .filter((r) => r.balance > 0.005 && r.tenantId);

    const total = round2(rows.reduce((s, r) => s + r.balance, 0));
    if (!rows.length) return res.json({ success: true, tab, accountCode, accountName: account.name, total: 0, groups: [] });

    const tenantIdList = rows.map((r) => r.tenantId);

    // Fetch tenants and (for deposits) the latest DEPOSIT_CHARGE invoices in parallel.
    const [tenants, invs] = await Promise.all([
      Tenant.find({ _id: { $in: tenantIdList }, business: businessId })
        .populate({ path: "unit", select: "unitNumber property", populate: { path: "property", select: "propertyName propertyCode" } })
        .select("name unit")
        .lean(),
      tab === "deposits"
        ? TenantInvoice.find({
            business: businessId,
            tenant:   { $in: tenantIdList },
            category: "DEPOSIT_CHARGE",
            ...(asOfDate ? { invoiceDate: { $lte: asOfDate } } : {}),
          })
            .select("tenant invoiceNumber amount invoiceDate")
            .sort({ invoiceDate: -1 })
            .lean()
        : Promise.resolve([]),
    ]);

    const tenantMap = new Map(tenants.map((t) => [String(t._id), t]));

    // Build invoice map (first entry per tenant wins â€” sorted by date desc so newest first)
    const invoiceMap = new Map();
    invs.forEach((inv) => {
      const key = String(inv.tenant);
      if (!invoiceMap.has(key)) invoiceMap.set(key, inv);
    });

    const byProp = new Map();
    rows.forEach((r) => {
      const tenant = tenantMap.get(String(r.tenantId));
      const prop   = tenant?.unit?.property;
      const propId   = String(prop?._id || r.propertyId || "unknown");
      const propName = prop?.propertyName || "Unknown Property";
      const propCode = prop?.propertyCode || "";

      if (!byProp.has(propId)) {
        byProp.set(propId, { propertyId: propId, propertyName: propName, propertyCode: propCode, subtotal: 0, rows: [] });
      }
      const g   = byProp.get(propId);
      g.subtotal = round2(g.subtotal + r.balance);

      const row = {
        tenantId:   String(r.tenantId),
        tenantName: tenant?.name || "Unknown Tenant",
        unitNumber: tenant?.unit?.unitNumber || "",
        balance:    r.balance,
      };
      if (tab === "deposits") {
        const inv = invoiceMap.get(String(r.tenantId));
        row.invoiceNumber = inv?.invoiceNumber || "";
        row.invoiceDate   = inv?.invoiceDate   || null;
        row.depositAmount = round2(Math.abs(Number(inv?.amount || 0)));
      }
      g.rows.push(row);
    });

    const groups = [...byProp.values()].sort((a, b) => b.subtotal - a.subtotal);

    return res.json({ success: true, tab, accountCode, accountName: account.name, total, groups });
  } catch (err) {
    next(err);
  }
};

// Returns monthly income/expense/net totals for the last N months in a single DB query.
// Used by AccountsDashboard to replace 6 individual income-statement calls.
// Applies the same account classifiers as getIncomeStatementReport so the chart
// matches the Income Statement â€” landlord pass-through accounts are excluded.
export const getIncomeMonthlySummary = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));
    const businessOid = new mongoose.Types.ObjectId(String(businessId));

    const months = Math.min(Math.max(parseInt(req.query.months || "6", 10), 1), 24);
    const now = new Date();

    const ranges = Array.from({ length: months }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
      return {
        label: d.toLocaleDateString("en-GB", { month: "short" }),
        startDate: d,
        endDate: end,
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      };
    });

    // Fetch company mode + all income/expense accounts (need code/name/subGroup for classifiers)
    const [company, allIncomeAccounts, allExpenseAccounts] = await Promise.all([
      Company.findById(businessId, { companyMode: 1, modules: 1 }).lean(),
      ChartOfAccount.find({ business: businessId, type: "income",  isPosting: { $ne: false }, isHeader: { $ne: true } }, { _id: 1, code: 1, name: 1, subGroup: 1 }).lean(),
      ChartOfAccount.find({ business: businessId, type: "expense", isPosting: { $ne: false }, isHeader: { $ne: true } }, { _id: 1, code: 1, name: 1, subGroup: 1 }).lean(),
    ]);

    // Apply the same classifier as the Income Statement so the chart matches it exactly
    const selfManaging = isSelfManagingLandlordCompany(company);
    const incomeClassifier  = selfManaging ? isSelfManagingLandlordIncomeAccount  : isOperatingIncomeAccount;
    const expenseClassifier = selfManaging ? isSelfManagingLandlordExpenseAccount : isOperatingExpenseAccount;

    const incomeAccounts  = allIncomeAccounts.filter(incomeClassifier);
    const expenseAccounts = allExpenseAccounts.filter(expenseClassifier);

    const incomeIdSet = new Set(incomeAccounts.map((a) => String(a._id)));
    const allIds = [
      ...incomeAccounts.map((a) => a._id),
      ...expenseAccounts.map((a) => a._id),
    ];

    if (!allIds.length) {
      return res.json(ranges.map((r) => ({ month: r.label, income: 0, expenses: 0, net: 0 })));
    }

    const debitExpr = {
      $cond: [
        { $gt: ["$debit", 0] },
        "$debit",
        { $cond: [{ $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "debit"] }, { $ifNull: ["$amount", 0] }, 0] },
      ],
    };
    const creditExpr = {
      $cond: [
        { $gt: ["$credit", 0] },
        "$credit",
        { $cond: [{ $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "credit"] }, { $ifNull: ["$amount", 0] }, 0] },
      ],
    };

    // Use the same date-range boundaries as buildLedgerMap (explicit $gte/$lte) instead
    // of $dateToString (UTC) so the monthly buckets match the Income Statement exactly.
    const monthBranches = ranges.map((r) => ({
      case: { $and: [{ $gte: ["$transactionDate", r.startDate] }, { $lte: ["$transactionDate", r.endDate] }] },
      then: r.key,
    }));

    const agg = await FinancialLedgerEntry.aggregate([
      {
        $match: {
          business: businessOid,
          accountId: { $in: allIds },
          status: { $in: REPORT_LEDGER_STATUSES },
          transactionDate: { $gte: ranges[0].startDate, $lte: ranges[ranges.length - 1].endDate },
        },
      },
      { $addFields: { ym: { $switch: { branches: monthBranches, default: null } } } },
      { $match: { ym: { $ne: null } } },
      {
        $group: {
          _id: { ym: "$ym", accountId: "$accountId" },
          debit: { $sum: debitExpr },
          credit: { $sum: creditExpr },
        },
      },
    ]).allowDiskUse(true);

    // Aggregate into month buckets
    const byMonth = new Map();
    for (const row of agg) {
      const ym = row._id.ym;
      if (!byMonth.has(ym)) byMonth.set(ym, { income: 0, expenses: 0 });
      const bucket = byMonth.get(ym);
      const isIncome = incomeIdSet.has(String(row._id.accountId));
      if (isIncome) {
        bucket.income += row.credit - row.debit; // credit-normal for income
      } else {
        bucket.expenses += row.debit - row.credit; // debit-normal for expense
      }
    }

    const result = ranges.map((r) => {
      const b = byMonth.get(r.key) || { income: 0, expenses: 0 };
      const income = round2(b.income);
      const expenses = round2(b.expenses);
      return { month: r.label, income, expenses, net: round2(income - expenses) };
    });

    return res.json(result);
  } catch (err) {
    next(err);
  }
};

export const getTenantSummaryReport = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "A valid business id is required."));

    const filterPropertyId = req.query.propertyId ? String(req.query.propertyId) : "";
    const filterStatus = req.query.status && req.query.status !== "all" ? String(req.query.status) : "";
    const filterSearch = req.query.search ? String(req.query.search).trim() : "";

    // Step 1: If propertyId filter provided, resolve unit IDs for that property up front
    let scopedUnitIds = null;
    if (filterPropertyId && mongoose.Types.ObjectId.isValid(filterPropertyId)) {
      const propertyUnits = await Unit.find({ business: businessId, property: toObjectId(filterPropertyId) })
        .select("_id")
        .lean();
      scopedUnitIds = propertyUnits.map((u) => u._id);
      if (scopedUnitIds.length === 0) {
        return res.json({ rows: [], summary: { totalTenants: 0, totalInvoiced: 0, totalPaid: 0, totalBalance: 0 } });
      }
    }

    // Step 2: Build and run tenant query
    const tenantQuery = { business: businessId };
    if (scopedUnitIds) tenantQuery.unit = { $in: scopedUnitIds };
    if (filterStatus === "active") {
      tenantQuery.status = { $in: ["active", "overdue"] };
    } else if (filterStatus === "inactive") {
      tenantQuery.status = { $in: ["inactive", "terminated", "moved_out", "evicted"] };
    }
    if (filterSearch) tenantQuery.tenantName = { $regex: escapeRegex(filterSearch), $options: "i" };

    const tenants = await Tenant.find(tenantQuery)
      .select("_id tenantName name email phone unit balance status")
      .limit(500)
      .lean();

    if (tenants.length === 0) {
      return res.json({ rows: [], summary: { totalTenants: 0, totalInvoiced: 0, totalPaid: 0, totalBalance: 0 } });
    }

    const tenantIds = tenants.map((t) => t._id);

    // Step 3+4: Fetch units, properties, and invoice aggregates all in parallel.
    const unitIds = [...new Set(tenants.map((t) => String(t.unit)).filter(Boolean))]
      .map((id) => toObjectId(id))
      .filter(Boolean);

    const [units, properties, invoiceAgg] = await Promise.all([
      Unit.find({ _id: { $in: unitIds } }).select("_id unitNumber name property").lean(),
      filterPropertyId && mongoose.Types.ObjectId.isValid(filterPropertyId)
        ? Property.find({ _id: toObjectId(filterPropertyId) }).select("_id propertyName name").lean()
        : Property.find({ business: businessId }).select("_id propertyName name").lean(),
      TenantInvoice.aggregate([
        {
          $match: {
            business: new mongoose.Types.ObjectId(String(businessId)),
            tenant: { $in: tenantIds },
            status: { $nin: ["cancelled", "reversed"] },
            postingStatus: { $nin: ["failed", "reversed"] },
          },
        },
        {
          $group: {
            _id: "$tenant",
            totalInvoiced: { $sum: "$amount" },
            invoiceCount: { $sum: 1 },
          },
        },
      ]),
    ]).allowDiskUse(true);

    const unitMap = new Map(units.map((u) => [String(u._id), u]));
    const propMap = new Map(properties.map((p) => [String(p._id), p]));
    const invoiceMap = new Map(invoiceAgg.map((a) => [String(a._id), a]));

    // Step 5: Join tenant data with invoice aggregates and unit/property lookups
    const rows = tenants.map((tenant) => {
      const unit = unitMap.get(String(tenant.unit || "")) || {};
      const propId = String(unit.property || "");
      const prop = propMap.get(propId) || {};

      const inv = invoiceMap.get(String(tenant._id)) || { totalInvoiced: 0, invoiceCount: 0 };
      const totalInvoiced = round2(Number(inv.totalInvoiced) || 0);
      // Tenant.balance is the authoritative maintained outstanding balance
      const balance = round2(Number(tenant.balance) || 0);
      const totalPaid = round2(Math.max(0, totalInvoiced - balance));

      return {
        tenantId: String(tenant._id),
        tenantName: tenant.tenantName || tenant.name || "Unknown Tenant",
        email: tenant.email || "â€”",
        phone: tenant.phone || "â€”",
        propertyName: prop.propertyName || prop.name || "â€”",
        propertyId: propId,
        unitNumber: unit.unitNumber || unit.name || "â€”",
        totalInvoiced,
        totalPaid,
        balance,
        invoiceCount: inv.invoiceCount || 0,
        status: String(tenant.status || "inactive").toLowerCase(),
      };
    });

    // Step 6: Compute aggregate summary totals
    const summary = rows.reduce(
      (acc, r) => {
        acc.totalInvoiced = round2(acc.totalInvoiced + r.totalInvoiced);
        acc.totalPaid = round2(acc.totalPaid + r.totalPaid);
        acc.totalBalance = round2(acc.totalBalance + r.balance);
        return acc;
      },
      { totalTenants: rows.length, totalInvoiced: 0, totalPaid: 0, totalBalance: 0 }
    );

    return res.json({ rows, summary });
  } catch (err) {
    next(err);
  }
};

// â”€â”€â”€ Rental Aged Analysis â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns one row per tenant with outstanding receivables bucketed into aging
// periods (current / 1-30 / 31-60 / 61-90 / 90+ days overdue).  All allocation
// math runs inside MongoDB â€” the browser just renders the pre-computed rows.
export const getRentalAgedAnalysisReport = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Missing business"));
    const businessOid = new mongoose.Types.ObjectId(String(businessId));

    const now = new Date();

    // â”€â”€ Build the base invoice match â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const match = {
      business: businessOid,
      category: { $in: ["RENT_CHARGE", "UTILITY_CHARGE", "LATE_PENALTY_CHARGE"] },
      status: { $nin: ["cancelled", "reversed"] },
    };

    // Optional single-category filter (narrows the $in to one value)
    if (req.query.category && ["RENT_CHARGE", "UTILITY_CHARGE", "LATE_PENALTY_CHARGE"].includes(req.query.category)) {
      match.category = req.query.category;
    }

    // Optional property filter â€” takes precedence over zone
    if (req.query.propertyId) {
      match.property = toObjectId(req.query.propertyId);
    } else if (req.query.zone) {
      const zoneLower = req.query.zone.toLowerCase().trim();
      const zoneProps = await Property.find(
        { business: businessId, zoneRegion: { $regex: `^${zoneLower}$`, $options: "i" } },
        { _id: 1 }
      ).lean();
      match.property = { $in: zoneProps.map((p) => p._id) };
    }

    // â”€â”€ Aggregation pipeline â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const pipeline = [
      { $match: match },

      // Join matching RentPayments via the index on allocations.invoice.
      // localField/foreignField syntax lets MongoDB use the existing index.
      {
        $lookup: {
          from: "rentpayments",
          localField: "_id",
          foreignField: "allocations.invoice",
          as: "_payments",
        },
      },

      // Sum applied amounts across non-reversed/non-cancelled payments,
      // counting only allocations that actually reference this invoice's _id.
      {
        $addFields: {
          _totalPaid: {
            $sum: {
              $map: {
                input: {
                  $filter: {
                    input: { $ifNull: ["$_payments", []] },
                    cond: {
                      $and: [
                        { $ne: [{ $ifNull: ["$$this.isReversed", false] }, true] },
                        { $ne: [{ $ifNull: ["$$this.isCancelled", false] }, true] },
                      ],
                    },
                  },
                },
                as: "pmt",
                in: {
                  $sum: {
                    $map: {
                      input: {
                        $filter: {
                          input: { $ifNull: ["$$pmt.allocations", []] },
                          cond: { $eq: ["$$this.invoice", "$_id"] },
                        },
                      },
                      as: "alloc",
                      in: { $ifNull: ["$$alloc.appliedAmount", 0] },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // outstanding = max(0, amount - totalPaid).  Drop zero-balance invoices early.
      {
        $addFields: {
          _outstanding: {
            $max: [0, { $subtract: [{ $ifNull: ["$amount", 0] }, "$_totalPaid"] }],
          },
        },
      },
      { $match: { _outstanding: { $gt: 0.005 } } },

      // Release the potentially large payments array before subsequent stages.
      { $project: { _payments: 0 } },

      // Effective due date: dueDate â†’ metadata chain â†’ invoiceDate
      {
        $addFields: {
          _effectiveDueDate: {
            $ifNull: [
              "$dueDate",
              {
                $ifNull: [
                  "$metadata.periodEndDate",
                  {
                    $ifNull: [
                      "$metadata.periodToDate",
                      {
                        $ifNull: [
                          "$metadata.periodStartDate",
                          { $ifNull: ["$metadata.periodFromDate", "$invoiceDate"] },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },

      // Overdue days (whole days; 0 = not yet due or due today â†’ current bucket)
      {
        $addFields: {
          _overdueDays: {
            $cond: {
              if: { $gt: [{ $ifNull: ["$_effectiveDueDate", null] }, null] },
              then: {
                $max: [
                  0,
                  {
                    $floor: {
                      $divide: [{ $subtract: [now, "$_effectiveDueDate"] }, 86400000],
                    },
                  },
                ],
              },
              else: 0,
            },
          },
        },
      },

      // Assign the outstanding balance to exactly one aging bucket
      {
        $addFields: {
          _current: { $cond: [{ $lte: ["$_overdueDays", 0] }, "$_outstanding", 0] },
          _days30: {
            $cond: [
              { $and: [{ $gte: ["$_overdueDays", 1] }, { $lte: ["$_overdueDays", 30] }] },
              "$_outstanding",
              0,
            ],
          },
          _days60: {
            $cond: [
              { $and: [{ $gte: ["$_overdueDays", 31] }, { $lte: ["$_overdueDays", 60] }] },
              "$_outstanding",
              0,
            ],
          },
          _days90: {
            $cond: [
              { $and: [{ $gte: ["$_overdueDays", 61] }, { $lte: ["$_overdueDays", 90] }] },
              "$_outstanding",
              0,
            ],
          },
          _days90Plus: {
            $cond: [{ $gte: ["$_overdueDays", 91] }, "$_outstanding", 0],
          },
        },
      },

      // Resolve display names (pipeline-form keeps projections tight)
      {
        $lookup: {
          from: "tenants",
          localField: "tenant",
          foreignField: "_id",
          as: "_tenant",
          pipeline: [{ $project: { tenantName: 1, name: 1 } }],
        },
      },
      {
        $lookup: {
          from: "properties",
          localField: "property",
          foreignField: "_id",
          as: "_property",
          pipeline: [{ $project: { propertyName: 1, name: 1 } }],
        },
      },
      {
        $lookup: {
          from: "units",
          localField: "unit",
          foreignField: "_id",
          as: "_unit",
          pipeline: [{ $project: { unitNumber: 1, name: 1 } }],
        },
      },
      {
        $lookup: {
          from: "landlords",
          localField: "landlord",
          foreignField: "_id",
          as: "_landlord",
          pipeline: [{ $project: { name: 1 } }],
        },
      },

      // Group by tenant â€” sum each aging bucket, track oldest effective due date
      {
        $group: {
          _id: "$tenant",
          tenantName: {
            $first: {
              $ifNull: [
                { $arrayElemAt: ["$_tenant.tenantName", 0] },
                { $arrayElemAt: ["$_tenant.name", 0] },
              ],
            },
          },
          propertyId: { $first: "$property" },
          propertyName: {
            $first: {
              $ifNull: [
                { $arrayElemAt: ["$_property.propertyName", 0] },
                { $arrayElemAt: ["$_property.name", 0] },
              ],
            },
          },
          unitId: { $first: "$unit" },
          unitNumber: {
            $first: {
              $ifNull: [
                { $arrayElemAt: ["$_unit.unitNumber", 0] },
                { $arrayElemAt: ["$_unit.name", 0] },
              ],
            },
          },
          landlordId: { $first: "$landlord" },
          landlordName: { $first: { $arrayElemAt: ["$_landlord.name", 0] } },
          current: { $sum: "$_current" },
          days30: { $sum: "$_days30" },
          days60: { $sum: "$_days60" },
          days90: { $sum: "$_days90" },
          days90Plus: { $sum: "$_days90Plus" },
          total: { $sum: "$_outstanding" },
          oldestDueDate: { $min: "$_effectiveDueDate" },
        },
      },

      { $sort: { total: -1 } },
    ];

    const rawRows = await TenantInvoice.aggregate(pipeline).allowDiskUse(true);

    const rows = rawRows.map((r) => ({
      tenantId: r._id,
      tenantName: r.tenantName || "Unknown Tenant",
      propertyId: r.propertyId,
      propertyName: r.propertyName || "N/A",
      unitId: r.unitId,
      unitNumber: r.unitNumber || "N/A",
      landlordId: r.landlordId,
      landlordName: r.landlordName || "",
      current: round2(r.current || 0),
      days30: round2(r.days30 || 0),
      days60: round2(r.days60 || 0),
      days90: round2(r.days90 || 0),
      days90Plus: round2(r.days90Plus || 0),
      total: round2(r.total || 0),
      oldestDueDate: r.oldestDueDate || null,
    }));

    const summary = rows.reduce(
      (acc, row) => {
        acc.current += row.current;
        acc.days30 += row.days30;
        acc.days60 += row.days60;
        acc.days90 += row.days90;
        acc.days90Plus += row.days90Plus;
        acc.totalOutstanding += row.total;
        return acc;
      },
      { current: 0, days30: 0, days60: 0, days90: 0, days90Plus: 0, totalOutstanding: 0 }
    );
    Object.keys(summary).forEach((k) => { summary[k] = round2(summary[k]); });

    return res.status(200).json({ success: true, rows, summary });
  } catch (err) {
    next(err);
  }
};

export default {
  getTrialBalanceReport,
  getIncomeStatementReport,
  getBalanceSheetReport,
  getCashFlowReport,
  getCashMonthlySummary,
  getIncomeMonthlySummary,
  getARAgingReport,
  getAPAgingReport,
  getRentalCollectionReport,
  getTenantPaidBalanceReport,
  getPropertyIncomeSummaryReport,
  getMRITaxSummaryReport,
  getTrialBalanceExceptions,
  getFinancialRatios,
  performYearEndClose,
  getLiabilitySubledger,
  getTenantSummaryReport,
  getRentalAgedAnalysisReport,
};
