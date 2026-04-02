import mongoose from "mongoose";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import { ensureSystemChartOfAccounts } from "../../services/chartOfAccountsService.js";
import { computeAccountBalance, getNormalBalanceSide } from "../../services/accountingClassificationService.js";

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

const isManagerIncomeAccount = (account = {}) => {
  const code = String(account.code || "").trim();
  const name = String(account.name || "").trim().toLowerCase();
  const subGroup = String(account.subGroup || "").trim().toLowerCase();

  if (code === "4200" || code === "4210") return true;
  if (name.includes("management fee") || name.includes("commission income")) return true;
  if (name.includes("late fee") || name.includes("penalty")) return true;
  if (subGroup === "other income" && !name.includes("property income")) return true;

  if (["4100", "4101", "4102", "4300"].includes(code)) return false;
  if (name.includes("rent income")) return false;
  if (name.includes("service charge income")) return false;
  if (name.includes("utility recharge income")) return false;
  if (name.includes("other property income")) return false;

  return false;
};

const isManagerExpenseAccount = (account = {}) => {
  const code = String(account.code || "").trim();
  const name = String(account.name || "").trim().toLowerCase();
  const subGroup = String(account.subGroup || "").trim().toLowerCase();

  if (["5200", "5201", "5202"].includes(code)) return true;
  if (subGroup === "administrative expenses" || subGroup === "finance costs") return true;
  if (name.includes("management expense")) return true;
  if (name.includes("bank charges")) return true;
  if (name.includes("legal") || name.includes("compliance")) return true;
  if (
    name.includes("salary") ||
    name.includes("wage") ||
    name.includes("office") ||
    name.includes("internet") ||
    name.includes("software") ||
    name.includes("subscription") ||
    name.includes("marketing") ||
    name.includes("transport")
  ) return true;

  if (["5100", "5101", "5102", "5103", "5104"].includes(code)) return false;
  if (subGroup === "property expenses") return false;
  if (name.includes("maintenance expense")) return false;
  if (name.includes("repairs expense")) return false;
  if (name.includes("cleaning expense")) return false;
  if (name.includes("security expense")) return false;
  if (name.includes("utility expense")) return false;

  return false;
};

const buildLedgerMap = async ({ businessId, asOfDate = null, startDate = null, endDate = null }) => {
  const match = {
    business: businessId,
    accountId: { $ne: null },
    status: { $nin: ["draft", "void"] },
  };

  if (startDate || endDate || asOfDate) {
    match.transactionDate = {};
    if (startDate) match.transactionDate.$gte = startDate;
    if (endDate) match.transactionDate.$lte = endDate;
    if (asOfDate) match.transactionDate.$lte = asOfDate;
  }

  const entries = await FinancialLedgerEntry.find(match)
    .select("accountId debit credit amount direction")
    .lean();

  const map = new Map();
  for (const entry of entries) {
    const key = String(entry.accountId);
    const current = map.get(key) || { debit: 0, credit: 0 };
    const amount = getEntryAmount(entry);
    const debit = Number(entry.debit || 0) || (String(entry.direction).toLowerCase() === "debit" ? amount : 0);
    const credit = Number(entry.credit || 0) || (String(entry.direction).toLowerCase() === "credit" ? amount : 0);
    current.debit += debit;
    current.credit += credit;
    map.set(key, current);
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

    await ensureSystemChartOfAccounts(businessId);

    const accounts = await ChartOfAccount.find({
      business: businessId,
      isPosting: { $ne: false },
      isHeader: { $ne: true },
    })
      .sort({ code: 1 })
      .lean();

    const ledgerMap = await buildLedgerMap({ businessId, asOfDate });

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

    await ensureSystemChartOfAccounts(businessId);

    const accounts = await ChartOfAccount.find({
      business: businessId,
      isPosting: { $ne: false },
      isHeader: { $ne: true },
      type: { $in: ["income", "expense"] },
    })
      .sort({ code: 1 })
      .lean();

    const ledgerMap = await buildLedgerMap({ businessId, startDate, endDate });

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

      if (account.type === "income" && isManagerIncomeAccount(account)) {
        incomeRows.push(row);
      }

      if (account.type === "expense" && isManagerExpenseAccount(account)) {
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
      reportBasis: "Property manager income and operating expenses only",
      exclusions: [
        "Rent collected on behalf of landlords",
        "Property control movements",
        "Landlord remittance payable",
        "Landlord/property deductions such as repairs and utilities",
      ],
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

    await ensureSystemChartOfAccounts(businessId);

    const accounts = await ChartOfAccount.find({
      business: businessId,
      isPosting: { $ne: false },
      isHeader: { $ne: true },
      type: { $in: ["asset", "liability", "equity", "income", "expense"] },
    })
      .sort({ code: 1 })
      .lean();

    const ledgerMap = await buildLedgerMap({ businessId, asOfDate });

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

export default {
  getTrialBalanceReport,
  getIncomeStatementReport,
  getBalanceSheetReport,
};
