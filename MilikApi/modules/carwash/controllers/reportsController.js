import mongoose from "mongoose";
import CarWashExpense from "../models/CarWashExpense.js";
import CarWashJob from "../models/CarWashJob.js";
import CarWashPayment from "../models/CarWashPayment.js";
import CarWashStaffCommission from "../models/CarWashStaffCommission.js";
import CarWashStaff from "../models/CarWashStaff.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import { parseDateRange, resolveActiveBusinessId, resolveActiveBranchId } from "../services/businessScope.js";
import { backfillCarWashPaymentLedger, deduplicateCarWashLedgerEntries, repairOrphanedCarWashLedgerEntries } from "../services/carwashAccountingService.js";

const CW_LEDGER_SOURCE_TYPES = ["carwash_payment", "carwash_expense", "carwash_commission", "carwash_commission_payout"];

const CATEGORY_LABELS = {
  CARWASH_PAYMENT:           "Payment Revenue",
  CARWASH_EXPENSE:           "Operating Expense",
  CARWASH_COMMISSION_ACCRUAL: "Commission Accrual",
  CARWASH_COMMISSION_PAYOUT:  "Commission Payout",
  REVERSAL:                   "Reversal",
};

export const listLedgerEntries = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const businessOid = new mongoose.Types.ObjectId(String(business));

    const filter = { business: businessOid, sourceTransactionType: { $in: CW_LEDGER_SOURCE_TYPES } };

    if (req.query.status && req.query.status !== "all") filter.status = req.query.status;
    if (req.query.category && req.query.category !== "all") filter.category = req.query.category;
    if (req.query.direction && req.query.direction !== "all") filter.direction = req.query.direction;
    if (req.query.sourceType) filter.sourceTransactionType = req.query.sourceType;

    if (req.query.startDate || req.query.endDate) {
      filter.transactionDate = {};
      if (req.query.startDate) filter.transactionDate.$gte = new Date(new Date(req.query.startDate).setHours(0, 0, 0, 0));
      if (req.query.endDate)   filter.transactionDate.$lte = new Date(new Date(req.query.endDate).setHours(23, 59, 59, 999));
    }

    const page  = Math.max(parseInt(req.query.page  || 1,   10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || 100, 10) || 100, 1), 500);

    const [entries, total] = await Promise.all([
      FinancialLedgerEntry.find(filter)
        .populate("accountId", "code name type subGroup")
        .sort({ transactionDate: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      FinancialLedgerEntry.countDocuments(filter),
    ]);

    res.status(200).json({ success: true, data: { entries, total, page, pages: Math.ceil(total / limit) }, entries, total });
  } catch (error) {
    next(error);
  }
};

const parseDateRangePair = (fromRaw, toRaw) => {
  const now = new Date();
  const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1);
  defaultStart.setHours(0, 0, 0, 0);

  const start = (() => {
    if (!fromRaw) return defaultStart;
    const d = new Date(fromRaw);
    if (Number.isNaN(d.getTime())) return defaultStart;
    d.setHours(0, 0, 0, 0);
    return d;
  })();

  const end = (() => {
    if (!toRaw) {
      const e = new Date(start);
      e.setMonth(e.getMonth() + 1);
      return e;
    }
    const d = new Date(toRaw);
    if (Number.isNaN(d.getTime())) {
      const e = new Date(start);
      e.setMonth(e.getMonth() + 1);
      return e;
    }
    d.setHours(23, 59, 59, 999);
    return new Date(d.getTime() + 1);
  })();

  return { start, end };
};

const emptyStatusCounts = () => ({
  waiting: 0,
  washing: 0,
  done: 0,
  paid: 0,
  cancelled: 0,
});

const paymentMethods = ["cash", "mpesa", "bank", "card", "other"];

const isoDate = (date) => date.toISOString().slice(0, 10);

const startOfDay = (value = null) => {
  const date = value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  safeDate.setHours(0, 0, 0, 0);
  return safeDate;
};

const getWeekRange = (dateValue = null) => {
  const start = startOfDay(dateValue);
  const day = start.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + offset);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
};

const getMonthRange = (monthValue = null) => {
  const raw = monthValue ? String(monthValue) : "";
  const [yearRaw, monthRaw] = raw.split("-");
  const year = Number(yearRaw);
  const monthIndex = Number(monthRaw) - 1;
  const now = new Date();
  const start =
    Number.isFinite(year) && Number.isFinite(monthIndex) && monthIndex >= 0 && monthIndex <= 11
      ? new Date(year, monthIndex, 1)
      : new Date(now.getFullYear(), now.getMonth(), 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  return { start, end };
};

const blankRevenueByMethod = () =>
  paymentMethods.reduce((acc, method) => {
    acc[method] = 0;
    return acc;
  }, {});

const buildTrendRows = (start, end, jobRows, paymentRows) => {
  const jobsByDay = jobRows.reduce((acc, row) => {
    acc[row._id] = Number(row.count || 0);
    return acc;
  }, {});
  const paymentsByDay = paymentRows.reduce((acc, row) => {
    acc[row._id] = { revenue: Number(row.amount || 0), payments: Number(row.count || 0) };
    return acc;
  }, {});

  const rows = [];
  const cursor = new Date(start);
  while (cursor < end) {
    const key = isoDate(cursor);
    rows.push({
      date: key,
      jobs: jobsByDay[key] || 0,
      revenue: paymentsByDay[key]?.revenue || 0,
      payments: paymentsByDay[key]?.payments || 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return rows;
};

const buildRangeSummary = async (business, start, end, type, branchId = null) => {
  const businessId = new mongoose.Types.ObjectId(String(business));
  const branchFilter = branchId ? { branch: new mongoose.Types.ObjectId(String(branchId)) } : {};
  const jobMatch = { business: businessId, createdAt: { $gte: start, $lt: end }, ...branchFilter };
  const paymentMatch = { business: businessId, paymentDate: { $gte: start, $lt: end }, ...branchFilter };

  const expenseMatch = { business: businessId, expenseDate: { $gte: start, $lt: end }, status: "paid", ...branchFilter };
  const pendingExpenseMatch = { business: businessId, expenseDate: { $gte: start, $lt: end }, status: { $in: ["draft", "approved"] }, ...branchFilter };

  const [jobStatusRows, paymentRows, expenseRows, pendingExpenseRows, expenseCategoryRows, jobTrendRows, paymentTrendRows, serviceRows, staffRows] = await Promise.all([
    CarWashJob.aggregate([{ $match: jobMatch }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    CarWashPayment.aggregate([{ $match: paymentMatch }, { $group: { _id: "$method", amount: { $sum: "$amount" }, count: { $sum: 1 } } }]),
    CarWashExpense.aggregate([{ $match: expenseMatch }, { $group: { _id: "$status", amount: { $sum: "$amount" }, count: { $sum: 1 } } }]),
    CarWashExpense.aggregate([{ $match: pendingExpenseMatch }, { $group: { _id: null, amount: { $sum: "$amount" }, count: { $sum: 1 } } }]),
    CarWashExpense.aggregate([
      { $match: expenseMatch },
      { $group: { _id: "$category", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
      { $sort: { amount: -1, count: -1 } },
      { $limit: 20 },
    ]),
    CarWashJob.aggregate([
      { $match: jobMatch },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    CarWashPayment.aggregate([
      { $match: paymentMatch },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$paymentDate" } },
          amount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    CarWashJob.aggregate([
      { $match: jobMatch },
      { $group: { _id: "$serviceName", jobs: { $sum: 1 }, value: { $sum: "$price" } } },
      { $sort: { jobs: -1, value: -1 } },
      { $limit: 20 },
    ]),
    // Group by staff ID (no $lookup) — resolve names in one batched query after
    CarWashJob.aggregate([
      { $match: jobMatch },
      { $unwind: { path: "$assignedStaff", preserveNullAndEmptyArrays: true } },
      { $group: { _id: "$assignedStaff", jobs: { $sum: 1 }, value: { $sum: "$price" } } },
      { $sort: { jobs: -1, value: -1 } },
      { $limit: 20 },
    ]),
  ]);

  const statusCounts = emptyStatusCounts();
  jobStatusRows.forEach((row) => {
    if (row?._id in statusCounts) statusCounts[row._id] = row.count;
  });

  const revenueByMethod = { ...blankRevenueByMethod() };
  paymentRows.forEach((row) => {
    revenueByMethod[row._id || "other"] = Number(row.amount || 0);
  });

  const jobsCount = Object.values(statusCounts).reduce((sum, n) => sum + n, 0);
  const totalRevenue = Object.values(revenueByMethod).reduce((sum, amount) => sum + Number(amount || 0), 0);
  const totalExpenses = expenseRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const pendingExpenses = pendingExpenseRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const pendingExpenseCount = pendingExpenseRows.reduce((sum, row) => sum + Number(row.count || 0), 0);
  const paymentCount = paymentRows.reduce((sum, row) => sum + Number(row.count || 0), 0);
  const openJobs = Number(statusCounts.waiting || 0) + Number(statusCounts.washing || 0) + Number(statusCounts.ready || 0) + Number(statusCounts.done || 0);

  return {
    period: {
      type,
      start: isoDate(start),
      end: isoDate(new Date(end.getTime() - 1)),
    },
    jobsCount,
    totalRevenue,
    totalExpenses,
    pendingExpenses,
    pendingExpenseCount,
    netPosition: totalRevenue - totalExpenses,
    cashTotal: revenueByMethod.cash || 0,
    mpesaTotal: revenueByMethod.mpesa || 0,
    nonCashTotal: Math.max(totalRevenue - Number(revenueByMethod.cash || 0), 0),
    paymentCount,
    openJobs,
    averageJobValue: jobsCount ? totalRevenue / jobsCount : 0,
    revenueByMethod,
    expenseRows: expenseCategoryRows.map((row) => ({ category: row._id || "Unspecified", amount: row.amount || 0, count: row.count || 0 })),
    statusCounts,
    trendRows: buildTrendRows(start, end, jobTrendRows, paymentTrendRows),
    serviceRows: serviceRows.map((row) => ({ service: row._id || "Unspecified", jobs: row.jobs || 0, value: row.value || 0 })),
    staffRows: await (async () => {
      const ids = staffRows.map((r) => r._id).filter(Boolean);
      const docs = ids.length ? await CarWashStaff.find({ _id: { $in: ids } }).select("name").lean() : [];
      const nameMap = new Map(docs.map((s) => [String(s._id), s.name]));
      return staffRows.map((row) => ({
        staff: row._id ? (nameMap.get(String(row._id)) || "Unassigned") : "Unassigned",
        jobs: row.jobs || 0,
        value: row.value || 0,
      }));
    })(),
  };
};

export const dailySummary = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const branchId = resolveActiveBranchId(req);
    const { start, end } = parseDateRange(req.query.date);
    const businessOId = new mongoose.Types.ObjectId(String(business));
    const branchFilter = branchId ? { branch: new mongoose.Types.ObjectId(String(branchId)) } : {};

    const paidExpenseMatch = { business: businessOId, expenseDate: { $gte: start, $lt: end }, status: "paid", ...branchFilter };
    const pendingExpenseMatch = { business: businessOId, expenseDate: { $gte: start, $lt: end }, status: { $in: ["draft", "approved"] }, ...branchFilter };

    const [jobStatusRows, paymentRows, expenseRows, pendingExpenseRows, expenseCategoryRows] = await Promise.all([
      CarWashJob.aggregate([
        { $match: { business: businessOId, createdAt: { $gte: start, $lt: end }, ...branchFilter } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      CarWashPayment.aggregate([
        { $match: { business: businessOId, paymentDate: { $gte: start, $lt: end }, ...branchFilter } },
        { $group: { _id: "$method", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
      ]),
      CarWashExpense.aggregate([
        { $match: paidExpenseMatch },
        { $group: { _id: "$status", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
      ]),
      CarWashExpense.aggregate([
        { $match: pendingExpenseMatch },
        { $group: { _id: null, amount: { $sum: "$amount" }, count: { $sum: 1 } } },
      ]),
      CarWashExpense.aggregate([
        { $match: paidExpenseMatch },
        { $group: { _id: "$category", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
        { $sort: { amount: -1, count: -1 } },
        { $limit: 20 },
      ]),
    ]);

    const statusCounts = emptyStatusCounts();
    jobStatusRows.forEach((row) => {
      if (row?._id in statusCounts) statusCounts[row._id] = row.count;
    });
    const jobsCount = Object.values(statusCounts).reduce((sum, n) => sum + n, 0);

    const revenueByMethod = paymentRows.reduce((acc, row) => {
      acc[row._id || "other"] = Number(row.amount || 0);
      return acc;
    }, {});
    const todayRevenue = Object.values(revenueByMethod).reduce((sum, amount) => sum + Number(amount || 0), 0);
    const totalExpenses = expenseRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const pendingExpenses = pendingExpenseRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const pendingExpenseCount = pendingExpenseRows.reduce((sum, row) => sum + Number(row.count || 0), 0);

    res.status(200).json({
      success: true,
      data: {
        date: start.toISOString().slice(0, 10),
        jobsCount,
        totalRevenue: todayRevenue,
        totalExpenses,
        pendingExpenses,
        pendingExpenseCount,
        netPosition: todayRevenue - totalExpenses,
        cashTotal: revenueByMethod.cash || 0,
        mpesaTotal: revenueByMethod.mpesa || 0,
        revenueByMethod,
        paymentCount: paymentRows.reduce((sum, row) => sum + Number(row.count || 0), 0),
        expenseRows: expenseCategoryRows.map((row) => ({ category: row._id || "Unspecified", amount: row.amount || 0, count: row.count || 0 })),
        statusCounts,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const weeklySummary = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const branchId = resolveActiveBranchId(req);
    const { start, end } = getWeekRange(req.query.date || req.query.weekStart);
    const summary = await buildRangeSummary(business, start, end, "weekly", branchId);
    res.status(200).json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
};

export const monthlySummary = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const branchId = resolveActiveBranchId(req);
    const { start, end } = getMonthRange(req.query.month);
    const summary = await buildRangeSummary(business, start, end, "monthly", branchId);
    res.status(200).json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
};

export const serviceReport = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const businessId = new mongoose.Types.ObjectId(String(business));
    const branchId = resolveActiveBranchId(req);
    const { start, end } = parseDateRangePair(req.query.from, req.query.to);
    const categoryFilter = String(req.query.category || "").trim();
    const branchFilter = branchId ? { branch: new mongoose.Types.ObjectId(String(branchId)) } : {};

    const jobTypeFilter = req.query.jobType && ["vehicle", "carpet"].includes(req.query.jobType) ? { jobType: req.query.jobType } : {};
    const jobMatch = { business: businessId, createdAt: { $gte: start, $lt: end }, ...branchFilter, ...jobTypeFilter };
    const paymentMatch = { business: businessId, paymentDate: { $gte: start, $lt: end }, ...branchFilter };

    const [serviceJobRows, paymentByServiceRows] = await Promise.all([
      CarWashJob.aggregate([
        { $match: jobMatch },
        { $lookup: { from: "carwashservices", localField: "service", foreignField: "_id", as: "serviceDoc" } },
        { $unwind: { path: "$serviceDoc", preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: { $ifNull: ["$serviceName", "Unspecified"] },
            category: { $first: { $ifNull: ["$serviceDoc.category", ""] } },
            jobs: { $sum: 1 },
            totalPrice: { $sum: "$price" },
            paidJobs: { $sum: { $cond: [{ $eq: ["$paymentStatus", "paid"] }, 1, 0] } },
            cancelledJobs: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] } },
          },
        },
        { $sort: { jobs: -1, totalPrice: -1 } },
      ]),
      CarWashPayment.aggregate([
        { $match: paymentMatch },
        { $lookup: { from: "carwashjobs", localField: "job", foreignField: "_id", as: "jobDoc" } },
        { $unwind: { path: "$jobDoc", preserveNullAndEmptyArrays: true } },
        ...(jobTypeFilter.jobType ? [{ $match: { "jobDoc.jobType": jobTypeFilter.jobType } }] : []),
        {
          $group: {
            _id: { $ifNull: ["$jobDoc.serviceName", "Unspecified"] },
            revenue: { $sum: "$amount" },
            payments: { $sum: 1 },
            cash: { $sum: { $cond: [{ $eq: ["$method", "cash"] }, "$amount", 0] } },
            mpesa: { $sum: { $cond: [{ $eq: ["$method", "mpesa"] }, "$amount", 0] } },
          },
        },
      ]),
    ]);

    const jobMap     = new Map(serviceJobRows.map((r) => [r._id, r]));
    const revenueMap = new Map(paymentByServiceRows.map((r) => [r._id, r]));

    const serviceSet = new Set([
      ...serviceJobRows.map((r) => r._id),
      ...paymentByServiceRows.map((r) => r._id),
    ]);

    let rows = [...serviceSet].map((service) => {
      const j = jobMap.get(service)     || { jobs: 0, totalPrice: 0, paidJobs: 0, cancelledJobs: 0, category: "" };
      const p = revenueMap.get(service) || { revenue: 0, payments: 0, cash: 0, mpesa: 0 };
      return {
        service,
        category:      j.category      || "",
        jobs:          j.jobs,
        paidJobs:      j.paidJobs,
        cancelledJobs: j.cancelledJobs,
        totalPrice:    j.totalPrice,
        revenue:       p.revenue,
        payments:      p.payments,
        cash:          p.cash,
        mpesa:         p.mpesa,
      };
    });

    if (categoryFilter) {
      rows = rows.filter((r) => r.category.toLowerCase() === categoryFilter.toLowerCase());
    }

    const totalJobs = rows.reduce((s, r) => s + r.jobs, 0);
    const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);

    rows = rows
      .map((r) => ({
        ...r,
        avgPrice: r.jobs ? r.totalPrice / r.jobs : 0,
        avgRevenue: r.jobs ? r.revenue / r.jobs : 0,
        revenueShare: totalRevenue ? (r.revenue / totalRevenue) * 100 : 0,
        jobShare: totalJobs ? (r.jobs / totalJobs) * 100 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue || b.jobs - a.jobs);

    res.status(200).json({
      success: true,
      data: {
        period: { from: isoDate(start), to: isoDate(new Date(end.getTime() - 1)) },
        totalJobs,
        totalRevenue,
        serviceCount: rows.length,
        categoryFilter: categoryFilter || null,
        jobTypeFilter: jobTypeFilter.jobType || null,
        rows,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Reverse orphaned entries AND deduplicate double-posted entries.
export const repairLedger = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const [orphan, dedup] = await Promise.all([
      repairOrphanedCarWashLedgerEntries(business, req),
      deduplicateCarWashLedgerEntries(business, req),
    ]);
    const totalReversed = orphan.reversed + dedup.reversed;
    const allErrors = [...orphan.errors, ...dedup.errors];
    res.json({
      success: true,
      message: `Repair complete: ${orphan.reversed} orphaned + ${dedup.reversed} duplicate entr${totalReversed === 1 ? "y" : "ies"} reversed, ${allErrors.length} errors.`,
      orphanedReversed: orphan.reversed,
      duplicatesReversed: dedup.reversed,
      totalReversed,
      errors: allErrors,
    });
  } catch (error) {
    next(error);
  }
};

// Retroactively post Dr/Cr ledger entries for payments that have none.
// Safe to call multiple times — it skips payments that already have entries.
export const backfillPaymentLedger = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { paymentsPosted, commissionsPosted, expensesPosted, skipped, errors } = await backfillCarWashPaymentLedger(business, req);
    const posted = paymentsPosted + commissionsPosted + (expensesPosted || 0);
    res.json({
      success: true,
      message: `Backfill complete: ${paymentsPosted} payments + ${commissionsPosted} commissions + ${expensesPosted || 0} expenses posted, ${skipped} skipped, ${errors.length} errors.`,
      paymentsPosted,
      commissionsPosted,
      expensesPosted: expensesPosted || 0,
      posted,
      skipped,
      errors,
    });
  } catch (error) {
    next(error);
  }
};

export const staffReport = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const businessId = new mongoose.Types.ObjectId(String(business));
    const branchId = resolveActiveBranchId(req);
    const { start, end } = parseDateRangePair(req.query.from, req.query.to);
    const branchFilter = branchId ? { branch: new mongoose.Types.ObjectId(String(branchId)) } : {};
    const jobTypeFilter = req.query.jobType && ["vehicle", "carpet"].includes(req.query.jobType) ? { jobType: req.query.jobType } : {};

    const jobMatch = { business: businessId, createdAt: { $gte: start, $lt: end }, ...branchFilter, ...jobTypeFilter };
    const paymentMatch = { business: businessId, paymentDate: { $gte: start, $lt: end }, ...branchFilter };
    const commissionMatch = { business: businessId, earnedAt: { $gte: start, $lt: end }, status: { $ne: "cancelled" }, ...branchFilter };

    const [staffJobRows, paymentByStaffRows, commissionByStaffRows] = await Promise.all([
      CarWashJob.aggregate([
        { $match: jobMatch },
        { $lookup: { from: "carwashstaffs", localField: "assignedStaff", foreignField: "_id", as: "staffDoc" } },
        { $unwind: { path: "$staffDoc", preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: { staffId: { $ifNull: ["$staffDoc._id", null] }, staffName: { $ifNull: ["$staffDoc.name", "Unassigned"] } },
            jobs: { $sum: 1 },
            totalPrice: { $sum: "$price" },
            paidJobs: { $sum: { $cond: [{ $eq: ["$paymentStatus", "paid"] }, 1, 0] } },
          },
        },
        { $sort: { jobs: -1 } },
      ]),
      // Group payments by job first (many→few) before lookups — far fewer docs to join
      CarWashPayment.aggregate([
        { $match: paymentMatch },
        { $group: {
          _id:      "$job",
          revenue:  { $sum: "$amount" },
          payments: { $sum: 1 },
          cash:     { $sum: { $cond: [{ $eq: ["$method", "cash"]  }, "$amount", 0] } },
          mpesa:    { $sum: { $cond: [{ $eq: ["$method", "mpesa"] }, "$amount", 0] } },
        }},
        { $lookup: { from: "carwashjobs",   localField: "_id",                foreignField: "_id", as: "jobDoc"  } },
        { $unwind: { path: "$jobDoc",  preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "carwashstaffs", localField: "jobDoc.assignedStaff", foreignField: "_id", as: "staffDoc" } },
        { $unwind: { path: "$staffDoc", preserveNullAndEmptyArrays: true } },
        { $group: {
          _id:      { staffId: { $ifNull: ["$staffDoc._id", null] }, staffName: { $ifNull: ["$staffDoc.name", "Unassigned"] } },
          revenue:  { $sum: "$revenue" },
          payments: { $sum: "$payments" },
          cash:     { $sum: "$cash" },
          mpesa:    { $sum: "$mpesa" },
        }},
      ]),
      CarWashStaffCommission.aggregate([
        { $match: commissionMatch },
        { $lookup: { from: "carwashstaffs", localField: "staff", foreignField: "_id", as: "staffDoc" } },
        { $unwind: { path: "$staffDoc", preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: { staffId: { $ifNull: ["$staffDoc._id", null] }, staffName: { $ifNull: ["$staffDoc.name", "Unassigned"] } },
            totalCommission: { $sum: "$commissionAmount" },
            commissionCount: { $sum: 1 },
          },
        },
      ]),
    ]);

    const totalJobs = staffJobRows.reduce((s, r) => s + r.jobs, 0);
    const paymentMap = new Map(paymentByStaffRows.map((r) => [String(r._id.staffId), r]));
    const commissionMap = new Map(commissionByStaffRows.map((r) => [String(r._id.staffId), r]));
    const totalRevenue = paymentByStaffRows.reduce((s, r) => s + r.revenue, 0);
    const totalCommission = commissionByStaffRows.reduce((s, r) => s + r.totalCommission, 0);

    const rows = staffJobRows
      .map((row) => {
        const staffName = row._id.staffName;
        const staffIdKey = String(row._id.staffId);
        const p = paymentMap.get(staffIdKey) || { revenue: 0, payments: 0, cash: 0, mpesa: 0 };
        const c = commissionMap.get(staffIdKey) || { totalCommission: 0, commissionCount: 0 };
        return {
          staff: staffName,
          jobs: row.jobs,
          paidJobs: row.paidJobs,
          totalPrice: row.totalPrice,
          revenue: p.revenue,
          payments: p.payments,
          cash: p.cash,
          mpesa: p.mpesa,
          commission: c.totalCommission,
          commissionCount: c.commissionCount,
          netRevenue: p.revenue - c.totalCommission,
          avgPrice: row.jobs ? row.totalPrice / row.jobs : 0,
          revenueShare: totalRevenue ? (p.revenue / totalRevenue) * 100 : 0,
          jobShare: totalJobs ? (row.jobs / totalJobs) * 100 : 0,
        };
      })
      .sort((a, b) => b.revenue - a.revenue || b.jobs - a.jobs);

    res.status(200).json({
      success: true,
      data: {
        period: { from: isoDate(start), to: isoDate(new Date(end.getTime() - 1)) },
        totalJobs,
        totalRevenue,
        totalCommission,
        staffCount: rows.length,
        jobTypeFilter: jobTypeFilter.jobType || null,
        rows,
      },
    });
  } catch (error) {
    next(error);
  }
};
