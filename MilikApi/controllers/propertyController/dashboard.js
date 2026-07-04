// controllers/propertyController/dashboard.js

import express from "express";
import mongoose from "mongoose";
import Tenant from "../../models/Tenant.js";
import RentPayment from "../../models/RentPayment.js";
import Maintenance from "../../models/Maintenance.js";
import Unit from "../../models/Unit.js";
import Landlord from "../../models/Landlord.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import TenantInvoice from "../../models/TenantInvoice.js";
import PaymentVoucher from "../../models/PaymentVoucher.js";
import ProcessedStatement from "../../models/ProcessedStatement.js";
import Lease from "../../models/Lease.js";
import { verifyUser } from "../verifyToken.js";
import { isManagerIncomeAccount, isManagerExpenseAccount } from "../../utils/accountClassifiers.js";

const router = express.Router();

// isManagerIncomeAccount and isManagerExpenseAccount are imported from accountClassifiers.js

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
    // JWT stores company as a string — aggregate $match needs an actual ObjectId to match stored values
    const rawBusiness = req.user.company?._id || req.user.company;
    const business = mongoose.Types.ObjectId.isValid(rawBusiness)
      ? new mongoose.Types.ObjectId(rawBusiness)
      : rawBusiness;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const yearStart  = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);

    const receiptBaseMatch = {
      business,
      ledgerType: "receipts",
      isConfirmed: true,
      isCancelled: { $ne: true },
      isReversed: { $ne: true },
      reversalOf: null, // null matches both missing field and explicit null (default value on new docs)
      postingStatus: { $ne: "reversed" },
    };

    const in30Days = new Date(now);
    in30Days.setDate(in30Days.getDate() + 30);

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
      overdueInvoiceCount,
      draftVoucherCount,
      pendingStatementCount,
      unpostedReceiptCount,
      leasesExpiringSoonCount,
      collectedThisMonthAgg,
      collectedByMonthRaw,
    ] = await Promise.all([
      Unit.countDocuments({ business, ownerOccupied: { $ne: true } }),
      Unit.countDocuments({
        business,
        ownerOccupied: { $ne: true },
        $or: [{ status: "occupied" }, { isVacant: false }],
      }),
      RentPayment.countDocuments({ business, isConfirmed: { $ne: true } }),
      Tenant.countDocuments({ business, status: "active" }),
      Tenant.countDocuments({ business, status: "overdue" }),
      Maintenance.countDocuments({ business, status: "pending" }),
      Maintenance.countDocuments({ business, status: "completed" }),
      Landlord.countDocuments({ business, status: "active" }),
      Tenant.aggregate([
        { $match: { business, status: { $in: ["active", "overdue"] } } },
        { $group: { _id: null, total: { $sum: { $ifNull: ["$rent", 0] } } } },
      ]),
      RentPayment.aggregate([
        { $match: { ...receiptBaseMatch, paymentType: "deposit" } },
        { $group: { _id: null, total: { $sum: { $ifNull: ["$amount", 0] } } } },
      ]),
      ChartOfAccount.find({ business, isPosting: { $ne: false }, isHeader: { $ne: true } })
        .select("_id code name type subGroup")
        .lean(),
      // Action-centre counts (used by frontend QuickActions without fetching full collections)
      TenantInvoice.countDocuments({
        business,
        status: { $in: ["pending", "partially_paid", "part_paid"] },
        dueDate: { $lt: now },
      }),
      PaymentVoucher.countDocuments({ business, status: "draft" }),
      ProcessedStatement.countDocuments({
        business,
        status: { $ne: "reversed" },
        $or: [
          { status: { $in: ["processed", "unpaid", "part_paid"] } },
          { balanceDue: { $gt: 0 } },
          { recoveryBalance: { $gt: 0 } },
        ],
      }),
      RentPayment.countDocuments({
        business,
        reversalOf: null,
        isReversed: { $ne: true },
        isCancelled: { $ne: true },
        $or: [{ postingStatus: "unposted" }, { isConfirmed: { $ne: true } }],
      }),
      Lease.countDocuments({
        business,
        status: { $nin: ["inactive", "terminated", "expired", "cancelled"] },
        endDate: { $gte: now, $lte: in30Days },
      }),
      // Direct receipt sum — authoritative "collected this month" regardless of ledger setup
      RentPayment.aggregate([
        {
          $match: {
            ...receiptBaseMatch,
            $or: [{ paymentDate: { $gte: monthStart } }, { createdAt: { $gte: monthStart } }],
          },
        },
        { $group: { _id: null, total: { $sum: { $ifNull: ["$amount", 0] } } } },
      ]),
      // Monthly breakdown for current year (12 buckets) — drives the FinancialOverview chart
      RentPayment.aggregate([
        {
          $match: {
            ...receiptBaseMatch,
            $or: [
              { paymentDate: { $gte: yearStart } },
              { paymentDate: null, createdAt: { $gte: yearStart } },
            ],
          },
        },
        {
          $group: {
            _id: {
              $month: {
                $cond: [
                  { $ifNull: ["$paymentDate", false] },
                  "$paymentDate",
                  "$createdAt",
                ],
              },
            },
            total: { $sum: { $ifNull: ["$amount", 0] } },
          },
        },
      ]),
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
    const collectedThisMonth = Number(collectedThisMonthAgg[0]?.total || 0);

    // Build a 12-element array [Jan, Feb, ..., Dec] of confirmed receipt totals
    const monthMap = {};
    for (const row of collectedByMonthRaw) monthMap[row._id] = Number(row.total || 0);
    const collectedByMonth = Array.from({ length: 12 }, (_, i) => monthMap[i + 1] || 0);

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
      collectedThisMonth,
      collectedByMonth,
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
      // Action-centre counts
      overdueInvoiceCount,
      draftVoucherCount,
      pendingStatementCount,
      unpostedReceiptCount,
      leasesExpiringSoonCount,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
