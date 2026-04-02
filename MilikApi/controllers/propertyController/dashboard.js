// controllers/propertyController/dashboard.js

import express from "express";
import Tenant from "../../models/Tenant.js";
import RentPayment from "../../models/RentPayment.js";
import Maintenance from "../../models/Maintenance.js";
import Unit from "../../models/Unit.js";
import Landlord from "../../models/Landlord.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import { verifyUser } from "../verifyToken.js";

const router = express.Router();

const getEntryAmount = (entry = {}) =>
  Number(entry.amount || 0) || Math.max(Number(entry.debit || 0), Number(entry.credit || 0), 0);

const isManagerIncomeAccount = (account = {}) => {
  const code = String(account.code || "").trim();
  const name = String(account.name || "").trim().toLowerCase();
  const subGroup = String(account.subGroup || "").trim().toLowerCase();
  if (["4200", "4210", "4103"].includes(code)) return true;
  if (
    name.includes("management fee") ||
    name.includes("commission income") ||
    name.includes("late fee") ||
    name.includes("penalty")
  ) {
    return true;
  }
  if (subGroup === "other income" && !name.includes("property income")) return true;
  return false;
};

const isManagerExpenseAccount = (account = {}) => {
  const code = String(account.code || "").trim();
  const name = String(account.name || "").trim().toLowerCase();
  const subGroup = String(account.subGroup || "").trim().toLowerCase();
  if (["5200", "5201", "5202"].includes(code)) return true;
  if (subGroup === "administrative expenses" || subGroup === "finance costs") return true;
  if (
    name.includes("management expense") ||
    name.includes("bank charges") ||
    name.includes("legal") ||
    name.includes("compliance")
  ) {
    return true;
  }
  return false;
};

const sumLedgerForAccounts = (entries = [], accountMap = new Map(), predicate = () => false) =>
  entries.reduce((sum, entry) => {
    const account = accountMap.get(String(entry.accountId || ""));
    if (!account || !predicate(account)) return sum;
    const amount = getEntryAmount(entry);
    const direction = String(entry.direction || "").toLowerCase();
    if (account.type === "income") return sum + (direction === "credit" ? amount : -amount);
    if (account.type === "expense") return sum + (direction === "debit" ? amount : -amount);
    return sum;
  }, 0);

router.get("/summary", verifyUser, async (req, res) => {
  try {
    const business = req.user.company;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

    const receiptBaseMatch = {
      business,
      ledgerType: "receipts",
      isConfirmed: true,
      isCancelled: { $ne: true },
      isReversed: { $ne: true },
      reversalOf: { $exists: false },
      postingStatus: { $ne: "reversed" },
      receiptNumber: { $type: "string", $ne: "" },
    };

    const [
      totalUnits,
      occupiedUnits,
      pendingPayments,
      activeTenants,
      overdueTenants,
      pendingMaintenance,
      completedMaintenance,
      activeLandlords,
      totalMonthlyRentDueAgg,
      totalDepositsAgg,
      chartAccounts,
      allLedgerEntries,
      monthLedgerEntries,
    ] = await Promise.all([
      Unit.countDocuments({ business }),
      Unit.countDocuments({
        business,
        $or: [{ status: "occupied" }, { isVacant: false }],
      }),
      RentPayment.countDocuments({ business, isConfirmed: { $ne: true } }),
      Tenant.countDocuments({ business, status: "active" }),
      Tenant.countDocuments({ business, $or: [{ status: "overdue" }, { balance: { $gt: 0 } }] }),
      Maintenance.countDocuments({ business, status: "pending" }),
      Maintenance.countDocuments({ business, status: "completed" }),
      Landlord.countDocuments({ business, status: "active" }),
      Tenant.aggregate([
        { $match: { business } },
        { $group: { _id: null, total: { $sum: { $ifNull: ["$rent", 0] } } } },
      ]),
      RentPayment.aggregate([
        { $match: { ...receiptBaseMatch, paymentType: "deposit" } },
        { $group: { _id: null, total: { $sum: { $ifNull: ["$amount", 0] } } } },
      ]),
      ChartOfAccount.find({ business, isPosting: { $ne: false }, isHeader: { $ne: true } })
        .select("_id code name type subGroup")
        .lean(),
      FinancialLedgerEntry.find({
        business,
        accountId: { $ne: null },
        status: { $nin: ["draft", "void", "reversed"] },
      })
        .select("accountId amount debit credit direction")
        .lean(),
      FinancialLedgerEntry.find({
        business,
        accountId: { $ne: null },
        status: { $nin: ["draft", "void", "reversed"] },
        transactionDate: { $gte: monthStart },
      })
        .select("accountId amount debit credit direction")
        .lean(),
    ]);

    const vacantUnits = Math.max(totalUnits - occupiedUnits, 0);
    const accountMap = new Map(chartAccounts.map((account) => [String(account._id), account]));

    const totalRevenue = sumLedgerForAccounts(allLedgerEntries, accountMap, isManagerIncomeAccount);
    const monthlyRevenue = sumLedgerForAccounts(monthLedgerEntries, accountMap, isManagerIncomeAccount);
    const currentMonthExpenses = sumLedgerForAccounts(monthLedgerEntries, accountMap, isManagerExpenseAccount);

    const totalMonthlyRentDue = Number(totalMonthlyRentDueAgg?.[0]?.total || 0);
    const totalDeposits = Number(totalDepositsAgg?.[0]?.total || 0);
    const occupancyRate = totalUnits > 0 ? (occupiedUnits / totalUnits) * 100 : 0;
    const collectionRate = totalMonthlyRentDue > 0 ? (monthlyRevenue / totalMonthlyRentDue) * 100 : 0;
    const netProfit = monthlyRevenue - currentMonthExpenses;

    return res.json({
      totalUnits,
      occupiedUnits,
      vacantUnits,
      totalRevenue,
      totalDeposits,
      monthlyRevenue,
      pendingPayments,
      activeTenants,
      overdueTenants,
      pendingMaintenance,
      completedMaintenance,
      activeLandlords,
      occupancyRate,
      collectionRate,
      currentMonthExpenses,
      netProfit,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
