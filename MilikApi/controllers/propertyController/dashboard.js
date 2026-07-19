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

// In-memory dashboard cache — avoids 20+ parallel aggregations on every page mount.
const dashboardCache = new Map(); // businessId -> { data, expiresAt }
const DASHBOARD_CACHE_TTL_MS = 60_000; // 60 s

// ── Aggregation expression helpers ───────────────────────────────────────────

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

const incomeContribExpr = {
  $sum: {
    $cond: {
      if: { $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "credit"] },
      then: amountExpr,
      else: { $multiply: [-1, amountExpr] },
    },
  },
};

const expenseContribExpr = {
  $sum: {
    $cond: {
      if: { $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "debit"] },
      then: amountExpr,
      else: { $multiply: [-1, amountExpr] },
    },
  },
};

// Reusable invoice amount expression (adjustedAmount → netAmount → amount)
const invAmountExpr = {
  $ifNull: [
    "$adjustedAmount",
    { $ifNull: ["$netAmount", { $ifNull: ["$amount", 0] }] },
  ],
};

// Reusable invoice recognition-date expression (bookingDate → invoiceDate → createdAt)
const invDateExpr = {
  $cond: [
    { $ifNull: ["$bookingDate", false] },
    "$bookingDate",
    {
      $cond: [
        { $ifNull: ["$invoiceDate", false] },
        "$invoiceDate",
        "$createdAt",
      ],
    },
  ],
};

// ── Route ─────────────────────────────────────────────────────────────────────

router.get("/summary", verifyUser, async (req, res) => {
  try {
    const rawBusiness = req.user.company?._id || req.user.company;
    const business = mongoose.Types.ObjectId.isValid(rawBusiness)
      ? new mongoose.Types.ObjectId(rawBusiness)
      : rawBusiness;

    const cacheKey = String(rawBusiness);
    const cached = dashboardCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return res.json(cached.data);
    }

    // ── Timezone-aware boundaries (Kenya = UTC+3) ─────────────────────────────
    // Dates are stored as UTC. A Kenya midnight like "2026-07-01 00:00 EAT" is
    // "2026-06-30 21:00 UTC" in the DB, so MongoDB's $month returns 6 (June)
    // without timezone awareness, causing a systematic 1-month shift on the chart.
    const TZ           = "Africa/Nairobi";
    const EAT_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC+3
    const nowUTC       = new Date();
    const nowKE        = new Date(nowUTC.getTime() + EAT_OFFSET_MS); // current moment in Kenya
    // Start-of-month/year in Kenya, expressed as UTC timestamps
    const monthStart   = new Date(Date.UTC(nowKE.getUTCFullYear(), nowKE.getUTCMonth(), 1) - EAT_OFFSET_MS);
    const yearStart    = new Date(Date.UTC(nowKE.getUTCFullYear(), 0,                    1) - EAT_OFFSET_MS);
    const in30Days     = new Date(nowUTC.getTime() + 30 * 24 * 60 * 60 * 1000);

    const receiptBaseMatch = {
      business,
      ledgerType: "receipts",
      isConfirmed: true,
      isCancelled: { $ne: true },
      isReversed: { $ne: true },
      reversalOf: null,
      postingStatus: { $ne: "reversed" },
    };

    const invoiceBaseMatch = {
      business,
      status: { $nin: ["cancelled", "reversed"] },
      category: { $in: ["RENT_CHARGE", "UTILITY_CHARGE"] },
    };

    // ── Single parallel batch — all aggregations at once ─────────────────────
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
      totalLandlordPayableAgg,
      // ── NEW: eliminates the large /tenant-invoices fetch on the frontend ──
      expectedByMonthRaw,    // 12-bucket billed amounts for the chart
      outstandingArrearsAgg, // total outstanding invoice balance
      propertyExpectedRaw,   // per-property billed this month
      propertyCollectedRaw,  // per-property collected this month (via unit→property)
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
      TenantInvoice.countDocuments({
        business,
        status: { $in: ["pending", "partially_paid", "part_paid"] },
        dueDate: { $lt: nowUTC },
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
        endDate: { $gte: nowUTC, $lte: in30Days },
      }),
      RentPayment.aggregate([
        {
          $match: {
            ...receiptBaseMatch,
            $or: [{ paymentDate: { $gte: monthStart } }, { createdAt: { $gte: monthStart } }],
          },
        },
        { $group: { _id: null, total: { $sum: { $ifNull: ["$amount", 0] } } } },
      ]),
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
                date: { $cond: [{ $ifNull: ["$paymentDate", false] }, "$paymentDate", "$createdAt"] },
                timezone: TZ,
              },
            },
            total: { $sum: { $ifNull: ["$amount", 0] } },
          },
        },
      ]),
      ProcessedStatement.aggregate([
        {
          $match: {
            business,
            status: { $ne: "reversed" },
            isNegativeStatement: { $ne: true },
            balanceDue: { $gt: 0 },
          },
        },
        { $group: { _id: null, total: { $sum: "$balanceDue" } } },
      ]),

      // expectedByMonth — 12-bucket invoice billed amounts for the chart
      // Uses timezone-aware $month so Kenya midnight dates (stored as prev-day UTC) land
      // in the correct month instead of shifting one month left.
      TenantInvoice.aggregate([
        { $match: { ...invoiceBaseMatch } },
        { $addFields: { recDate: invDateExpr } },
        { $match: { recDate: { $gte: yearStart } } },
        {
          $group: {
            _id: { $month: { date: "$recDate", timezone: TZ } },
            total: { $sum: invAmountExpr },
          },
        },
      ]),

      // outstandingArrears — total unpaid invoice balance across all properties
      TenantInvoice.aggregate([
        {
          $match: {
            business,
            status: { $in: ["pending", "partially_paid", "part_paid"] },
          },
        },
        {
          $group: {
            _id: null,
            total: {
              $sum: {
                $cond: [
                  { $gt: [{ $ifNull: ["$outstanding", 0] }, 0] },
                  "$outstanding",
                  invAmountExpr,
                ],
              },
            },
          },
        },
      ]),

      // propertyExpectedRaw — per-property billed amount for the current month
      TenantInvoice.aggregate([
        { $match: { ...invoiceBaseMatch } },
        { $addFields: { recDate: invDateExpr } },
        { $match: { recDate: { $gte: monthStart } } },
        {
          $group: {
            _id: "$property",
            expectedThisMonth: { $sum: invAmountExpr },
          },
        },
      ]),

      // propertyCollectedRaw — per-property collected receipts for the current month
      // Uses a pipeline $lookup so only the property field is transferred
      RentPayment.aggregate([
        {
          $match: {
            ...receiptBaseMatch,
            $or: [
              { paymentDate: { $gte: monthStart } },
              { paymentDate: null, createdAt: { $gte: monthStart } },
            ],
          },
        },
        {
          $lookup: {
            from: "units",
            let: { uid: "$unit" },
            pipeline: [
              { $match: { $expr: { $eq: ["$_id", "$$uid"] } } },
              { $project: { _id: 0, property: 1 } },
            ],
            as: "_u",
          },
        },
        {
          $group: {
            _id: { $arrayElemAt: ["$_u.property", 0] },
            collectedThisMonth: { $sum: { $abs: { $ifNull: ["$amount", 0] } } },
          },
        },
        { $match: { _id: { $ne: null } } },
      ]),
    ]);

    // ── Phase 2: ledger aggregations using known account IDs ──────────────────
    const incomeAccountIds  = chartAccounts.filter(isManagerIncomeAccount).map((a) => a._id);
    const expenseAccountIds = chartAccounts.filter(isManagerExpenseAccount).map((a) => a._id);

    const ledgerBaseMatch = { business, status: { $nin: ["draft", "void", "reversed"] } };

    const [totalRevenueAgg, monthRevenueAgg, monthExpenseAgg] = await Promise.all([
      incomeAccountIds.length
        ? FinancialLedgerEntry.aggregate([
            { $match: { ...ledgerBaseMatch, accountId: { $in: incomeAccountIds } } },
            { $group: { _id: null, total: incomeContribExpr } },
          ])
        : Promise.resolve([]),
      incomeAccountIds.length
        ? FinancialLedgerEntry.aggregate([
            { $match: { ...ledgerBaseMatch, accountId: { $in: incomeAccountIds }, transactionDate: { $gte: monthStart } } },
            { $group: { _id: null, total: incomeContribExpr } },
          ])
        : Promise.resolve([]),
      expenseAccountIds.length
        ? FinancialLedgerEntry.aggregate([
            { $match: { ...ledgerBaseMatch, accountId: { $in: expenseAccountIds }, transactionDate: { $gte: monthStart } } },
            { $group: { _id: null, total: expenseContribExpr } },
          ])
        : Promise.resolve([]),
    ]);

    // ── Build response ─────────────────────────────────────────────────────────
    const totalRevenue        = Number(totalRevenueAgg[0]?.total   || 0);
    const monthlyRevenue      = Number(monthRevenueAgg[0]?.total   || 0);
    const currentMonthExpenses= Number(monthExpenseAgg[0]?.total   || 0);
    const collectedThisMonth  = Number(collectedThisMonthAgg[0]?.total || 0);
    const totalLandlordPayable= Number(totalLandlordPayableAgg[0]?.total || 0);
    const outstandingArrears  = Number(outstandingArrearsAgg[0]?.total || 0);

    // collectedByMonth — 0-indexed [Jan…Dec]
    const monthMap = {};
    for (const row of collectedByMonthRaw) monthMap[row._id] = Number(row.total || 0);
    const collectedByMonth = Array.from({ length: 12 }, (_, i) => monthMap[i + 1] || 0);

    // expectedByMonth — 0-indexed [Jan…Dec]
    const expMap = {};
    for (const row of expectedByMonthRaw) expMap[row._id] = Number(row.total || 0);
    const expectedByMonth = Array.from({ length: 12 }, (_, i) => expMap[i + 1] || 0);

    // propertyStats — [{ propertyId, expectedThisMonth, collectedThisMonth }]
    const propExpMap = {};
    for (const r of propertyExpectedRaw)  propExpMap[String(r._id)]  = Number(r.expectedThisMonth  || 0);
    const propColMap = {};
    for (const r of propertyCollectedRaw) propColMap[String(r._id)]  = Number(r.collectedThisMonth || 0);
    const allPropIds = new Set([...Object.keys(propExpMap), ...Object.keys(propColMap)]);
    const propertyStats = [...allPropIds].map((pid) => ({
      propertyId:       pid,
      expectedThisMonth:  propExpMap[pid] || 0,
      collectedThisMonth: propColMap[pid] || 0,
    }));

    const vacantUnits     = Math.max(totalUnits - occupiedUnits, 0);
    const occupancyRate   = totalUnits > 0 ? (occupiedUnits / totalUnits) * 100 : 0;
    const collectionRate  = Number(totalMonthlyRentDueAgg?.[0]?.total || 0) > 0
      ? (monthlyRevenue / Number(totalMonthlyRentDueAgg[0].total)) * 100 : 0;

    const payload = {
      totalUnits,
      occupiedUnits,
      vacantUnits,
      totalRevenue,
      totalDeposits:      Number(totalDepositsAgg?.[0]?.total || 0),
      monthlyRevenue,
      collectedThisMonth,
      collectedByMonth,
      expectedByMonth,
      outstandingArrears,
      propertyStats,
      pendingPayments,
      activeTenants,
      overdueTenants,
      pendingMaintenance,
      completedMaintenance,
      activeLandlords,
      occupancyRate,
      collectionRate,
      currentMonthExpenses,
      netProfit:          monthlyRevenue - currentMonthExpenses,
      overdueInvoiceCount,
      draftVoucherCount,
      pendingStatementCount,
      unpostedReceiptCount,
      leasesExpiringSoonCount,
      totalLandlordPayable,
    };
    dashboardCache.set(cacheKey, { data: payload, expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS });
    return res.json(payload);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
