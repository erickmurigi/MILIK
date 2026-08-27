import mongoose from "mongoose";
import ExpenseProperty from "../../models/ExpenseProperty.js";
import { createError } from "../../utils/error.js";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const resolveBusinessContext = (req) => {
  return req.user?.company || req.query?.business || req.body?.business || null;
};

const buildDateFilter = (startDate, endDate) => {
  if (!startDate && !endDate) return undefined;

  const dateFilter = {};
  if (startDate) dateFilter.$gte = new Date(startDate);
  if (endDate) dateFilter.$lte = new Date(endDate);

  return Object.keys(dateFilter).length ? dateFilter : undefined;
};

// Create expense
export const createExpense = async (req, res, next) => {
  try {
    const business = resolveBusinessContext(req);

    if (!business) {
      return next(createError(400, "Business/company context is required"));
    }

    if (!isValidObjectId(business)) {
      return next(createError(400, "Invalid business/company id"));
    }

    const newExpense = new ExpenseProperty({
      ...req.body,
      business,
    });

    const savedExpense = await newExpense.save();
    await savedExpense.populate([
      { path: "property", select: "name address landlord" },
      { path: "unit", select: "unitNumber" },
    ]);

    return res.status(201).json(savedExpense);
  } catch (err) {
    next(err);
  }
};

// Get all expenses
export const getExpenses = async (req, res, next) => {
  const { category, property, unit, startDate, endDate } = req.query;

  try {
    const business = resolveBusinessContext(req);

    if (!business) {
      return next(createError(400, "Business/company context is required"));
    }

    if (!isValidObjectId(business)) {
      return next(createError(400, "Invalid business/company id"));
    }

    const filter = { business };

    if (category) filter.category = category;
    if (property) filter.property = property;
    if (unit) filter.unit = unit;

    const dateFilter = buildDateFilter(startDate, endDate);
    if (dateFilter) filter.date = dateFilter;

    const expenses = await ExpenseProperty.find(filter)
      .populate("property", "name address")
      .populate("unit", "unitNumber")
      .sort({ date: -1, createdAt: -1 })
      .limit(1000)
      .lean();

    return res.status(200).json(expenses);
  } catch (err) {
    next(err);
  }
};

// Get single expense
export const getExpense = async (req, res, next) => {
  try {
    const business = resolveBusinessContext(req);

    if (!business) {
      return next(createError(400, "Business/company context is required"));
    }

    const expense = await ExpenseProperty.findOne({
      _id: req.params.id,
      business,
    })
      .populate("property", "name address landlord")
      .populate("unit", "unitNumber")
      .lean();

    if (!expense) {
      return next(createError(404, "Expense not found"));
    }

    return res.status(200).json(expense);
  } catch (err) {
    next(err);
  }
};

// Update expense
export const updateExpense = async (req, res, next) => {
  try {
    const business = resolveBusinessContext(req);

    if (!business) {
      return next(createError(400, "Business/company context is required"));
    }

    const updatedExpense = await ExpenseProperty.findOneAndUpdate(
      { _id: req.params.id, business },
      { $set: { ...req.body, business } },
      { new: true }
    )
      .populate("property", "name address landlord")
      .populate("unit", "unitNumber")
      .lean();

    if (!updatedExpense) {
      return next(createError(404, "Expense not found"));
    }

    return res.status(200).json(updatedExpense);
  } catch (err) {
    next(err);
  }
};

// Delete expense
export const deleteExpense = async (req, res, next) => {
  try {
    const business = resolveBusinessContext(req);

    if (!business) {
      return next(createError(400, "Business/company context is required"));
    }

    const deleted = await ExpenseProperty.findOneAndDelete({
      _id: req.params.id,
      business,
    });

    if (!deleted) {
      return next(createError(404, "Expense not found"));
    }

    return res.status(200).json({ message: "Expense deleted successfully" });
  } catch (err) {
    next(err);
  }
};

// Get expense summary
export const getExpenseSummary = async (req, res, next) => {
  const { startDate, endDate } = req.query;

  try {
    const business = resolveBusinessContext(req);

    if (!business) {
      return next(createError(400, "Business/company context is required"));
    }

    if (!isValidObjectId(business)) {
      return next(createError(400, "Invalid business/company id"));
    }

    const match = { business: new mongoose.Types.ObjectId(String(business)) };

    const dateFilter = buildDateFilter(startDate, endDate);
    if (dateFilter) match.date = dateFilter;

    const expenses = await ExpenseProperty.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$category",
          totalAmount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { totalAmount: -1 } },
    ]);

    const total = await ExpenseProperty.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    return res.status(200).json({
      categories: expenses,
      totalAmount: total[0]?.totalAmount || 0,
      totalCount: total[0]?.count || 0,
    });
  } catch (err) {
    next(err);
  }
};

// Get expenses by property
export const getPropertyExpenses = async (req, res, next) => {
  const { propertyId } = req.params;
  const { startDate, endDate } = req.query;

  try {
    const business = resolveBusinessContext(req);

    if (!business) {
      return next(createError(400, "Business/company context is required"));
    }

    if (!isValidObjectId(business)) {
      return next(createError(400, "Invalid business/company id"));
    }

    if (!isValidObjectId(propertyId)) {
      return next(createError(400, "Invalid property id"));
    }

    const filter = {
      business,
      property: propertyId,
    };

    const dateFilter = buildDateFilter(startDate, endDate);
    if (dateFilter) filter.date = dateFilter;

    const expenses = await ExpenseProperty.find(filter)
      .populate("property", "name address")
      .populate("unit", "unitNumber")
      .sort({ date: -1, createdAt: -1 })
      .limit(1000)
      .lean();

    const summary = await ExpenseProperty.aggregate([
      {
        $match: {
          business: new mongoose.Types.ObjectId(String(business)),
          property: new mongoose.Types.ObjectId(String(propertyId)),
          ...(dateFilter ? { date: dateFilter } : {}),
        },
      },
      {
        $group: {
          _id: "$category",
          totalAmount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { totalAmount: -1 } },
    ]);

    return res.status(200).json({
      expenses,
      summary,
    });
  } catch (err) {
    next(err);
  }
};