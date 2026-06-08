import mongoose from "mongoose";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import Company from "../../models/Company.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import Tenant from "../../models/Tenant.js";
import TenantInvoice from "../../models/TenantInvoice.js";
import RentPayment from "../../models/RentPayment.js";
import Property from "../../models/Property.js";
import Unit from "../../models/Unit.js";
import ExpenseProperty from "../../models/ExpenseProperty.js";
import PaymentVoucher from "../../models/PaymentVoucher.js";
import { computeTenantInvoiceSnapshotsBatch } from "./tenantInvoices.js";
import { ensureSystemChartOfAccounts } from "../../services/chartOfAccountsService.js";
import { computeAccountBalance, getNormalBalanceSide } from "../../services/accountingClassificationService.js";
import { escapeRegex } from "../../utils/escapeRegex.js";
import { isOperatingIncomeAccount, isOperatingExpenseAccount } from "../../utils/accountClassifiers.js";

const toObjectId = (value) => {
  const raw = typeof value === "object" && value?._id ? value._id : value;
  if (!raw || !mongoose.Types.ObjectId.isValid(String(raw))) return null;
  return new mongoose.Types.ObjectId(String(raw));
};

const resolveBusinessId = (req) => {
  const fromQuery = req.query?.business || req.query?.company;
  const fromBody = req.body?.business || req.body?.company;
  const fromUser = req.user?.company?._id || req.user?.company || req.user?.businessId;

  if (req.user?.isSystemAdmin || req.user?.superAdminAccess) {
    return toObjectId(fromQuery || fromBody || fromUser);
  }

  return toObjectId(fromUser || fromQuery || fromBody);
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

const round2 = (value) => Number((Number(value || 0)).toFixed(2));

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
  const match = {
    business: businessId,
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

  // Aggregate in MongoDB — avoids transferring every entry document to Node.js.
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
  ]);

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
      return res.status(400).json({ success: false, error: "A valid business id is required." });
    }

    const includeZeroBalances = String(req.query.includeZeroBalances || "false").toLowerCase() === "true";
    const asOfDate = normalizeDate(req.query.asOfDate, true);
    if (!asOfDate) {
      return res.status(400).json({ success: false, error: "Invalid as-of date supplied." });
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
      return res.status(400).json({ success: false, error: "A valid business id is required." });
    }

    const startDate = normalizeDate(req.query.startDate || new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    const endDate = normalizeDate(req.query.endDate || new Date(), true);
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: "Invalid report dates supplied." });
    }
    if (startDate > endDate) {
      return res.status(400).json({ success: false, error: "Start date cannot be after end date." });
    }

    // Optional property scope — filters ledger entries by the property dimension.
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
      Company.findById(businessId, { modules: 1 }).lean(),
    ]);

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

      if (account.type === "income" && isOperatingIncomeAccount(account)) {
        incomeRows.push(row);
      }

      if (account.type === "expense" && isOperatingExpenseAccount(account)) {
        expenseRows.push(row);
      }
    }

    const incomeSections = buildSectionBuckets(incomeRows);
    const expenseSections = buildSectionBuckets(expenseRows);

    const totalIncome = round2(incomeRows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    const totalExpenses = round2(expenseRows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    const netProfit = round2(totalIncome - totalExpenses);

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
      reportBasis: "All operating income and expenses for this company",
      exclusions: company?.modules?.propertyManagement ? [
        "Rent collected on behalf of landlords",
        "Property control movements",
        "Landlord remittance payable",
        "Landlord/property deductions such as repairs and utilities",
      ] : [],
    });
  } catch (error) {
    next(error);
  }
};

export const getBalanceSheetReport = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) {
      return res.status(400).json({ success: false, error: "A valid business id is required." });
    }

    const includeZeroBalances = String(req.query.includeZeroBalances || "false").toLowerCase() === "true";
    const asOfDate = normalizeDate(req.query.asOfDate, true);
    if (!asOfDate) {
      return res.status(400).json({ success: false, error: "Invalid as-of date supplied." });
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

const buildReceiptAllocationTotals = (receipt = {}) => {
  const totals = emptyAllocationTotals();
  const allocationRows = normalizeArray(receipt?.allocations);
  let allocatedAmount = 0;

  allocationRows.forEach((row) => {
    const amount = round2(Number(row?.appliedAmount || 0));
    if (amount <= 0) return;
    allocatedAmount += amount;
    addCategorizedAmount(totals, row?.category, amount);
  });

  return {
    ...totals,
    allocatedAmount: round2(allocatedAmount),
    unappliedAmount: round2(Math.max(0, Math.abs(Number(receipt?.amount || 0)) - allocatedAmount)),
  };
};

const buildReceiptRow = (receipt = {}) => {
  const unit = receipt?.unit || {};
  const property = unit?.property || {};
  const tenant = receipt?.tenant || {};
  const landlord = pickPrimaryLandlord(property);
  const allocationTotals = buildReceiptAllocationTotals(receipt);

  return {
    receiptId: String(receipt?._id || ""),
    receiptNumber: receipt?.receiptNumber || "",
    paymentDate: receipt?.paymentDate || receipt?.createdAt || null,
    paymentMethod: receipt?.paymentMethod || "",
    cashbook: receipt?.cashbook || "",
    amount: round2(Math.abs(Number(receipt?.amount || 0))),
    allocatedAmount: allocationTotals.allocatedAmount,
    unappliedAmount: allocationTotals.unappliedAmount,
    rentApplied: allocationTotals.rentApplied,
    utilityApplied: allocationTotals.utilityApplied,
    penaltyApplied: allocationTotals.penaltyApplied,
    depositApplied: allocationTotals.depositApplied,
    otherApplied: allocationTotals.otherApplied,
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
    $or: [
      { postingStatus: { $exists: false } },
      { postingStatus: null },
      { postingStatus: "" },
      { postingStatus: "posted" },
    ],
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
      return res.status(400).json({ success: false, error: "A valid business id is required." });
    }

    const startDate = normalizeDate(req.query.startDate || req.query.dateFrom || req.query.from);
    const endDate = normalizeDate(req.query.endDate || req.query.dateTo || req.query.to, true);
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: "Valid start and end dates are required." });
    }

    const paymentQuery = buildEffectiveReceiptQuery({
      businessId,
      startDate,
      endDate,
      dateField: "paymentDate",
    });

    if (req.query.tenantId) paymentQuery.tenant = toObjectId(req.query.tenantId);
    if (req.query.unitId) paymentQuery.unit = toObjectId(req.query.unitId);
    if (req.query.paymentMethod) paymentQuery.paymentMethod = req.query.paymentMethod;
    // Push property filter to DB — RentPayment has a direct property field
    if (req.query.propertyId) paymentQuery.property = toObjectId(req.query.propertyId);
    if (req.query.cashbook) paymentQuery.cashbook = { $regex: escapeRegex(req.query.cashbook), $options: "i" };

    const invoiceQuery = {
      business: businessId,
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
    if (req.query.tenantId) invoiceQuery.tenant = toObjectId(req.query.tenantId);
    if (req.query.unitId) invoiceQuery.unit = toObjectId(req.query.unitId);
    if (req.query.landlordId) invoiceQuery.landlord = toObjectId(req.query.landlordId);

    // Run payment fetch and invoice aggregate in parallel — they are independent queries.
    const [receipts, periodInvoiced] = await Promise.all([
      RentPayment.find(paymentQuery)
        .populate("tenant", "name tenantName")
        .populate({
          path: "unit",
          select: "unitNumber name property",
          populate: { path: "property", select: "propertyName name landlords" },
        })
        .sort({ paymentDate: -1, createdAt: -1 })
        .lean(),
      TenantInvoice.aggregate([
        { $match: invoiceQuery },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
    ]);

    const filteredRows = receipts
      .map(buildReceiptRow)
      .filter((row) => {
        // landlordId cannot be pushed to DB (derived from property.landlords array)
        if (req.query.landlordId && String(row.landlordId) !== String(req.query.landlordId)) return false;
        return true;
      });

    const propertySummaryMap = new Map();
    const tenantSet = new Set();
    const propertySet = new Set();
    const summary = {
      totalCollected: 0,
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
      collectionRate: null,
    };

    filteredRows.forEach((row) => {
      summary.totalCollected += row.amount;
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
        allocatedAmount: 0,
        unappliedAmount: 0,
        rentApplied: 0,
        utilityApplied: 0,
        penaltyApplied: 0,
        tenantIds: new Set(),
        unitIds: new Set(),
      };
      bucket.paymentCount += 1;
      bucket.totalCollected += row.amount;
      bucket.allocatedAmount += row.allocatedAmount;
      bucket.unappliedAmount += row.unappliedAmount;
      bucket.rentApplied += row.rentApplied;
      bucket.utilityApplied += row.utilityApplied;
      bucket.penaltyApplied += row.penaltyApplied;
      if (row.tenantId) bucket.tenantIds.add(String(row.tenantId));
      if (row.unitId) bucket.unitIds.add(String(row.unitId));
      propertySummaryMap.set(key, bucket);
    });

    summary.totalCollected = round2(summary.totalCollected);
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

    summary.collectionRate = summary.periodInvoiced > 0 ? round2((summary.totalCollected / summary.periodInvoiced) * 100) : null;

    const byProperty = Array.from(propertySummaryMap.values())
      .map((bucket) => ({
        propertyId: bucket.propertyId,
        propertyName: bucket.propertyName,
        paymentCount: bucket.paymentCount,
        tenantCount: bucket.tenantIds.size,
        unitCount: bucket.unitIds.size,
        totalCollected: round2(bucket.totalCollected),
        allocatedAmount: round2(bucket.allocatedAmount),
        unappliedAmount: round2(bucket.unappliedAmount),
        rentApplied: round2(bucket.rentApplied),
        utilityApplied: round2(bucket.utilityApplied),
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
      rows: filteredRows,
    });
  } catch (error) {
    next(error);
  }
};

export const getTenantPaidBalanceReport = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) {
      return res.status(400).json({ success: false, error: "A valid business id is required." });
    }

    const asOfDate = normalizeDate(req.query.asOfDate, true) || normalizeDate(null, true);
    const tenantQuery = { business: businessId };
    if (req.query.tenantId) tenantQuery._id = toObjectId(req.query.tenantId);

    const filterPropertyId = req.query.propertyId ? String(req.query.propertyId) : "";
    const filterLandlordId = req.query.landlordId ? String(req.query.landlordId) : "";
    const filterSearch = safeLower(req.query.search || "");
    const filterStatus = req.query.status && req.query.status !== "all" ? req.query.status : "";

    // ── Step 1: batch-fetch tenants, units, properties in 3 parallel queries ──
    // Avoids the N+1 problem of cursor+nested-populate (2 queries per tenant).
    const [allTenants, allUnits, allProperties] = await Promise.all([
      Tenant.find(tenantQuery).select("_id tenantName name unit").sort({ name: 1, createdAt: 1 }).lean(),
      Unit.find({ business: businessId }).select("_id unitNumber name property").lean(),
      Property.find({ business: businessId }).select("_id propertyName name landlords").lean(),
    ]);

    const unitMap = new Map(allUnits.map((u) => [String(u._id), u]));
    const propMap = new Map(allProperties.map((p) => [String(p._id), p]));

    // ── Step 2: build base rows and apply cheap filters before snapshot cost ──
    const baseRows = allTenants
      .map((tenant) => {
        const unit = unitMap.get(String(tenant.unit || "")) || {};
        const property = propMap.get(String(unit.property || "")) || {};
        const landlord = pickPrimaryLandlord(property);
        return {
          tenantId: String(tenant._id),
          tenantName: tenant.tenantName || tenant.name || "Unknown Tenant",
          unitId: String(unit._id || tenant.unit || ""),
          unitNumber: unit.unitNumber || unit.name || "N/A",
          propertyId: String(property._id || unit.property || ""),
          propertyName: property.propertyName || property.name || "N/A",
          landlordId: String(landlord?.landlordId || ""),
          landlordName: landlord?.name || "N/A",
        };
      })
      .filter((row) => !filterPropertyId || row.propertyId === filterPropertyId)
      .filter((row) => !filterLandlordId || row.landlordId === filterLandlordId)
      .filter((row) => !filterSearch || `${row.tenantName} ${row.propertyName} ${row.unitNumber}`.toLowerCase().includes(filterSearch));

    // ── Step 3: snapshot computation in chunks of 500 ──
    const REPORT_CHUNK = 500;
    const allRows = [];

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
        const invoices = normalizeArray(snapshot.invoiceSnapshots);
        const receipts = normalizeArray(snapshot.receiptAllocations);

        let totalInvoiced = 0;
        let totalPaidApplied = 0;
        let outstanding = 0;
        let rentBalance = 0;
        let utilityBalance = 0;
        let penaltyBalance = 0;
        let depositBalance = 0;
        let otherBalance = 0;
        let oldestDueDateMs = null;

        for (const invoice of invoices) {
          const amount = Number(invoice?.amount || 0);
          const applied = Number(invoice?.applied || 0);
          const remaining = Number(invoice?.outstanding || 0);
          const category = String(invoice?.category || "").toUpperCase();
          totalInvoiced += amount;
          totalPaidApplied += applied;
          outstanding += remaining;
          if (category === "RENT_CHARGE") rentBalance += remaining;
          else if (category === "UTILITY_CHARGE") utilityBalance += remaining;
          else if (category === "LATE_PENALTY_CHARGE") penaltyBalance += remaining;
          else if (category === "DEPOSIT_CHARGE") depositBalance += remaining;
          else otherBalance += remaining;
          if (remaining > 0) {
            const reportDueDate = resolveInvoiceDueDateForReports(invoice);
            if (reportDueDate) {
              const ms = new Date(reportDueDate).getTime();
              if (!oldestDueDateMs || ms < oldestDueDateMs) oldestDueDateMs = ms;
            }
          }
        }

        let unappliedCredit = 0;
        let lastPaymentDateMs = null;
        for (const receipt of receipts) {
          unappliedCredit += Number(receipt?.unappliedAmount || 0);
          if (receipt?.paymentDate) {
            const ms = new Date(receipt.paymentDate).getTime();
            if (!lastPaymentDateMs || ms > lastPaymentDateMs) lastPaymentDateMs = ms;
          }
        }

        const netBalance = round2(outstanding - unappliedCredit);
        const status = netBalance > 0.009 ? "owing" : netBalance < -0.009 ? "credit" : "settled";

        if (filterStatus && status !== filterStatus) continue;

        allRows.push({
          ...row,
          totalInvoiced: round2(totalInvoiced),
          totalPaidApplied: round2(totalPaidApplied),
          outstanding: round2(outstanding),
          unappliedCredit: round2(unappliedCredit),
          netBalance,
          rentBalance: round2(rentBalance),
          utilityBalance: round2(utilityBalance),
          penaltyBalance: round2(penaltyBalance),
          depositBalance: round2(depositBalance),
          otherBalance: round2(otherBalance),
          oldestDueDate: oldestDueDateMs ? new Date(oldestDueDateMs).toISOString() : null,
          lastPaymentDate: lastPaymentDateMs ? new Date(lastPaymentDateMs).toISOString() : null,
          status,
        });
      }
    }

    const rows = allRows;

    const summary = rows.reduce((acc, row) => {
      acc.totalInvoiced += row.totalInvoiced;
      acc.totalPaidApplied += row.totalPaidApplied;
      acc.totalOutstanding += row.outstanding;
      acc.totalUnappliedCredit += row.unappliedCredit;
      acc.netBalance += row.netBalance;
      if (row.status === "owing") acc.owingCount += 1;
      if (row.status === "credit") acc.creditCount += 1;
      if (row.status === "settled") acc.settledCount += 1;
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
      tenantCount: rows.length,
    });

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
      return res.status(400).json({ success: false, error: "A valid business id is required." });
    }

    const startDate = normalizeDate(req.query.startDate || req.query.dateFrom || req.query.from);
    const endDate = normalizeDate(req.query.endDate || req.query.dateTo || req.query.to, true);
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: "Valid start and end dates are required." });
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
      business: businessId,
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

    const receiptMatch = buildEffectiveReceiptQuery({ businessId, startDate, endDate, dateField: "paymentDate" });

    const expenseMatch = { business: businessId, date: { $gte: startDate, $lte: endDate } };
    if (propertyIds) expenseMatch.property = { $in: propertyIds };

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
      ]),
      // RentPayment has no `property` field — resolve via unit lookup
      RentPayment.aggregate([
        { $match: receiptMatch },
        { $lookup: { from: "units", localField: "unit", foreignField: "_id", as: "_unit" } },
        { $addFields: { _propertyId: { $arrayElemAt: ["$_unit.property", 0] } } },
        ...(propertyIds ? [{ $match: { _propertyId: { $in: propertyIds } } }] : []),
        {
          $group: {
            _id: "$_propertyId",
            totalCollected: { $sum: "$amount" },
            paymentCount: { $sum: 1 },
          },
        },
      ]),
      ExpenseProperty.aggregate([
        { $match: expenseMatch },
        {
          $group: {
            _id: { property: "$property", category: "$category" },
            total: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]),
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
            business: businessId,
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
      ]);
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
      return res.status(400).json({ success: false, error: "A valid business id is required." });
    }

    const startDate = normalizeDate(req.query.startDate || new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    const endDate = normalizeDate(req.query.endDate || new Date(), true);
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: "Invalid report dates supplied." });
    }
    if (startDate > endDate) {
      return res.status(400).json({ success: false, error: "Start date cannot be after end date." });
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

    const [openingAgg, periodAgg] = await Promise.all([
      FinancialLedgerEntry.aggregate([
        { $match: { business: businessId, accountId: { $in: cashAccountIds }, status: { $in: REPORT_LEDGER_STATUSES }, transactionDate: { $lte: openingEndDate } } },
        { $group: { _id: "$accountId", debit: { $sum: debitExpr }, credit: { $sum: creditExpr } } },
      ]),
      FinancialLedgerEntry.aggregate([
        { $match: { business: businessId, accountId: { $in: cashAccountIds }, status: { $in: REPORT_LEDGER_STATUSES }, transactionDate: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: "$sourceTransactionType", debit: { $sum: debitExpr }, credit: { $sum: creditExpr } } },
      ]),
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
      // Skip items where reversals fully cancel the original in the same period — net-zero has no cash flow impact.
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
      return res.status(400).json({ success: false, error: "A valid business id is required." });
    }

    const startDate = normalizeDate(req.query.startDate || req.query.dateFrom || req.query.from);
    const endDate = normalizeDate(req.query.endDate || req.query.dateTo || req.query.to, true);
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: "Valid start and end dates are required." });
    }

    const MRI_RATE = 0.10;

    let propertyIds = null;
    if (req.query.propertyId) {
      const pid = toObjectId(req.query.propertyId);
      if (pid) propertyIds = [pid];
    }

    const receiptMatch = buildEffectiveReceiptQuery({ businessId, startDate, endDate, dateField: "paymentDate" });

    const byPropertyMonth = await RentPayment.aggregate([
      { $match: receiptMatch },
      { $lookup: { from: "units", localField: "unit", foreignField: "_id", as: "_unit" } },
      { $addFields: { _propertyId: { $arrayElemAt: ["$_unit.property", 0] } } },
      ...(propertyIds ? [{ $match: { _propertyId: { $in: propertyIds } } }] : []),
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
    ]);

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

// ─── AR / AP Aging helpers ────────────────────────────────────────────────────
const AGING_BUCKETS = [
  { key: "current",   label: "Current",    min: null, max: 0   },
  { key: "d1_30",     label: "1–30 days",  min: 1,    max: 30  },
  { key: "d31_60",    label: "31–60 days", min: 31,   max: 60  },
  { key: "d61_90",    label: "61–90 days", min: 61,   max: 90  },
  { key: "d90plus",   label: "90+ days",   min: 91,   max: null },
];

const assignBucket = (daysOverdue) => {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "d1_30";
  if (daysOverdue <= 60) return "d31_60";
  if (daysOverdue <= 90) return "d61_90";
  return "d90plus";
};

// ─── AR Aging ─────────────────────────────────────────────────────────────────
export const getARAgingReport = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return res.status(400).json({ message: "Missing business" });

    const asOf = req.query.asOf ? new Date(req.query.asOf) : new Date();
    asOf.setHours(23, 59, 59, 999);

    // Fetch outstanding invoices with display fields (property/unit not in snapshot engine)
    const invoices = await TenantInvoice.find({
      business: businessId,
      status: { $in: ["pending", "partially_paid"] },
    })
      .populate("tenant", "name email phone")
      .populate("property", "propertyName")
      .populate("unit", "unitName")
      .lean();

    if (!invoices.length) {
      return res.status(200).json({
        success: true,
        asOf,
        rows: [],
        totals: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 },
        buckets: AGING_BUCKETS,
      });
    }

    const tenantIds = [
      ...new Set(invoices.map((inv) => String(inv.tenant?._id || inv.tenant)).filter(Boolean)),
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

      const applied = round2(inv.amount - outstanding);
      const daysOverdue = Math.floor((asOf - new Date(inv.dueDate)) / 86_400_000);
      const bucket = assignBucket(daysOverdue);
      totals[bucket] = round2(totals[bucket] + outstanding);
      totals.total = round2(totals.total + outstanding);

      rows.push({
        invoiceId: inv._id,
        invoiceNumber: inv.invoiceNumber,
        tenantId: inv.tenant?._id,
        tenantName: inv.tenant?.name || "—",
        propertyName: inv.property?.propertyName || "—",
        unitName: inv.unit?.unitName || "—",
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

    rows.sort((a, b) => b.daysOverdue - a.daysOverdue);

    return res.status(200).json({ success: true, asOf, rows, totals, buckets: AGING_BUCKETS });
  } catch (error) {
    next(error);
  }
};

// ─── AP Aging ─────────────────────────────────────────────────────────────────
export const getAPAgingReport = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return res.status(400).json({ message: "Missing business" });

    const asOf = req.query.asOf ? new Date(req.query.asOf) : new Date();
    asOf.setHours(23, 59, 59, 999);

    const vouchers = await PaymentVoucher.find({
      business: businessId,
      status: { $in: ["draft", "approved"] },
    })
      .populate("property", "propertyName")
      .populate("landlord", "name")
      .lean();

    const totals = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 };
    const rows = [];

    for (const v of vouchers) {
      const outstanding = round2(v.amount || 0);
      if (outstanding <= 0) continue;

      const daysOverdue = Math.floor((asOf - new Date(v.dueDate)) / 86_400_000);
      const bucket = assignBucket(daysOverdue);
      totals[bucket] = round2(totals[bucket] + outstanding);
      totals.total = round2(totals.total + outstanding);

      rows.push({
        voucherId: v._id,
        reference: v.reference || v.voucherNo || String(v._id).slice(-6),
        narration: v.narration || "—",
        category: v.category,
        status: v.status,
        propertyName: v.property?.propertyName || "—",
        landlordName: v.landlord?.name || "—",
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

// ─── Cash Monthly Summary ─────────────────────────────────────────────────────
// Returns cashIn / cashOut per month for the last N months (default 6).
// cashIn  = debits  to cashbook accounts (money received into cash/bank)
// cashOut = credits from cashbook accounts (money paid out of cash/bank)
export const getCashMonthlySummary = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return res.status(400).json({ message: "Missing business" });

    const months = Math.max(1, Math.min(24, Number(req.query.months || 6)));
    const from = new Date();
    from.setMonth(from.getMonth() - (months - 1));
    from.setDate(1);
    from.setHours(0, 0, 0, 0);

    const businessOid = new mongoose.Types.ObjectId(String(businessId));

    // 1100/1110/1130 = standard cash/bank; 1310/1311 = carwash and property-sale receipt control accounts
    const cashbookAccounts = await ChartOfAccount.find(
      { business: businessId, code: { $in: ["1100", "1110", "1130", "1310", "1311"] } },
      { _id: 1 }
    ).lean();

    if (!cashbookAccounts.length) return res.status(200).json({ success: true, data: [] });

    const accountIds = cashbookAccounts.map((a) => a._id);

    const rows = await FinancialLedgerEntry.aggregate([
      {
        $match: {
          business: businessOid,
          accountId: { $in: accountIds },
          transactionDate: { $gte: from },
          status: { $ne: "reversed" },
        },
      },
      {
        $group: {
          _id: {
            y: { $year: "$transactionDate" },
            m: { $month: "$transactionDate" },
            dir: "$direction",
          },
          total: { $sum: "$amount" },
        },
      },
    ]);

    // Build lookup: "YYYY-M" → { cashIn, cashOut }
    const map = {};
    for (const row of rows) {
      const key = `${row._id.y}-${row._id.m}`;
      if (!map[key]) map[key] = { cashIn: 0, cashOut: 0 };
      if (row._id.dir === "debit")  map[key].cashIn  = round2(map[key].cashIn  + row.total);
      if (row._id.dir === "credit") map[key].cashOut = round2(map[key].cashOut + row.total);
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

export default {
  getTrialBalanceReport,
  getIncomeStatementReport,
  getBalanceSheetReport,
  getCashFlowReport,
  getCashMonthlySummary,
  getARAgingReport,
  getAPAgingReport,
  getRentalCollectionReport,
  getTenantPaidBalanceReport,
  getPropertyIncomeSummaryReport,
  getMRITaxSummaryReport,
};
