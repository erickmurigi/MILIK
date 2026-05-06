import mongoose from "mongoose";
import CarWashExpense from "../models/CarWashExpense.js";
import CarWashJob from "../models/CarWashJob.js";
import CarWashPayment from "../models/CarWashPayment.js";
import { parseDateRange, resolveActiveBusinessId } from "../services/businessScope.js";

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

const buildRangeSummary = async (business, start, end, type) => {
  const businessId = new mongoose.Types.ObjectId(String(business));
  const jobMatch = { business: businessId, createdAt: { $gte: start, $lt: end } };
  const paymentMatch = { business: businessId, paymentDate: { $gte: start, $lt: end } };

  const expenseMatch = { business: businessId, expenseDate: { $gte: start, $lt: end }, status: "paid" };
  const pendingExpenseMatch = { business: businessId, expenseDate: { $gte: start, $lt: end }, status: { $in: ["draft", "approved"] } };

  const [jobStatusRows, paymentRows, expenseRows, pendingExpenseRows, expenseCategoryRows, jobsCount, jobTrendRows, paymentTrendRows, serviceRows, staffRows] = await Promise.all([
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
    CarWashJob.countDocuments({ business, createdAt: { $gte: start, $lt: end } }),
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
    CarWashJob.aggregate([
      { $match: jobMatch },
      { $lookup: { from: "carwashstaffs", localField: "assignedStaff", foreignField: "_id", as: "staff" } },
      { $unwind: { path: "$staff", preserveNullAndEmptyArrays: true } },
      { $group: { _id: { $ifNull: ["$staff.name", "Unassigned"] }, jobs: { $sum: 1 }, value: { $sum: "$price" } } },
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

  const totalRevenue = Object.values(revenueByMethod).reduce((sum, amount) => sum + Number(amount || 0), 0);
  const totalExpenses = expenseRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const pendingExpenses = pendingExpenseRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const pendingExpenseCount = pendingExpenseRows.reduce((sum, row) => sum + Number(row.count || 0), 0);
  const paymentCount = paymentRows.reduce((sum, row) => sum + Number(row.count || 0), 0);
  const openJobs = Number(statusCounts.waiting || 0) + Number(statusCounts.washing || 0) + Number(statusCounts.done || 0);

  return {
    period: {
      type,
      start: isoDate(start),
      end: isoDate(new Date(end.getTime() - 1)),
    },
    jobsCount,
    todayJobsCount: jobsCount,
    totalRevenue,
    totalExpenses,
    pendingExpenses,
    pendingExpenseCount,
    netPosition: totalRevenue - totalExpenses,
    todayRevenue: totalRevenue,
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
    staffRows: staffRows.map((row) => ({ staff: row._id || "Unassigned", jobs: row.jobs || 0, value: row.value || 0 })),
  };
};

export const dailySummary = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { start, end } = parseDateRange(req.query.date);

    const paidExpenseMatch = { business: new mongoose.Types.ObjectId(String(business)), expenseDate: { $gte: start, $lt: end }, status: "paid" };
    const pendingExpenseMatch = { business: new mongoose.Types.ObjectId(String(business)), expenseDate: { $gte: start, $lt: end }, status: { $in: ["draft", "approved"] } };

    const [jobStatusRows, paymentRows, expenseRows, pendingExpenseRows, expenseCategoryRows, jobsCount] = await Promise.all([
      CarWashJob.aggregate([
        { $match: { business: new mongoose.Types.ObjectId(String(business)), createdAt: { $gte: start, $lt: end } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      CarWashPayment.aggregate([
        { $match: { business: new mongoose.Types.ObjectId(String(business)), paymentDate: { $gte: start, $lt: end } } },
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
      CarWashJob.countDocuments({ business, createdAt: { $gte: start, $lt: end } }),
    ]);

    const statusCounts = emptyStatusCounts();
    jobStatusRows.forEach((row) => {
      if (row?._id in statusCounts) statusCounts[row._id] = row.count;
    });

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
        todayJobsCount: jobsCount,
        todayRevenue,
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
    const { start, end } = getWeekRange(req.query.date || req.query.weekStart);
    const summary = await buildRangeSummary(business, start, end, "weekly");
    res.status(200).json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
};

export const monthlySummary = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { start, end } = getMonthRange(req.query.month);
    const summary = await buildRangeSummary(business, start, end, "monthly");
    res.status(200).json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
};
