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

// ── Account classifiers (unchanged logic) ────────────────────────────────────

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
  ) return true;
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
  ) return true;
  return false;
};

// ── Aggregation expression helpers ───────────────────────────────────────────

// Replicates: Number(entry.amount || 0) || Math.max(debit, credit, 0)
const amountExpr = {
  $cond: {
    if: { $gt: [{ $ifNull: ["$amount", 0] }, 0] },
    then: { $toDouble: { $ifNull: ["$amount", 0] } },
    else: {
      $max: [
        { $toDouble: { $ifNull: ["$debit", 0] } },
        { $toDouble: { $ifNull: ["$credit", 0] } },
        0,
      ],
    },
  },
};

// income: credit entry adds, debit entry subtracts
const incomeContribExpr = {
  $sum: {
    $cond: {
      if: { $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "credit"] },
      then: amountExpr,
      else: { $multiply: [-1, amountExpr] },
    },
  },
};

// expense: debit entry adds, credit entry subtracts
const expenseContribExpr = {
  $sum: {
    $cond: {
      if: { $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "debit"] },
      then: amountExpr,
      else: { $multiply: [-1, amountExpr] },
    },
  },
};

// ── Route ─────────────────────────────────────────────────────────────────────

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

    // ── Phase 1: counts + chart accounts (all parallel) ──────────────────────
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
    ]);

    // ── Phase 2: targeted ledger aggregations using known account IDs ─────────
    // Classify accounts in JS (small list — no DB round trip needed).
    // Then query MongoDB with $in so it uses the (business, accountId, status) index
    // and aggregates server-side — zero ledger documents transferred to Node.
    const incomeAccountIds = chartAccounts
      .filter(isManagerIncomeAccount)
      .map((a) => a._id);

    const expenseAccountIds = chartAccounts
      .filter(isManagerExpenseAccount)
      .map((a) => a._id);

    const ledgerBaseMatch = {
      business,
      status: { $nin: ["draft", "void", "reversed"] },
    };

    const [totalRevenueAgg, monthRevenueAgg, monthExpenseAgg] = await Promise.all([
      // All-time manager revenue
      incomeAccountIds.length
        ? FinancialLedgerEntry.aggregate([
            { $match: { ...ledgerBaseMatch, accountId: { $in: incomeAccountIds } } },
            { $group: { _id: null, total: incomeContribExpr } },
          ])
        : Promise.resolve([]),

      // Current-month manager revenue
      incomeAccountIds.length
        ? FinancialLedgerEntry.aggregate([
            {
              $match: {
                ...ledgerBaseMatch,
                accountId: { $in: incomeAccountIds },
                transactionDate: { $gte: monthStart },
              },
            },
            { $group: { _id: null, total: incomeContribExpr } },
          ])
        : Promise.resolve([]),

      // Current-month manager expenses
      expenseAccountIds.length
        ? FinancialLedgerEntry.aggregate([
            {
              $match: {
                ...ledgerBaseMatch,
                accountId: { $in: expenseAccountIds },
                transactionDate: { $gte: monthStart },
              },
            },
            { $group: { _id: null, total: expenseContribExpr } },
          ])
        : Promise.resolve([]),
    ]);

    const totalRevenue = Number(totalRevenueAgg[0]?.total || 0);
    const monthlyRevenue = Number(monthRevenueAgg[0]?.total || 0);
    const currentMonthExpenses = Number(monthExpenseAgg[0]?.total || 0);

    const vacantUnits = Math.max(totalUnits - occupiedUnits, 0);
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
