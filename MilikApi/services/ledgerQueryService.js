import mongoose from "mongoose";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";

const toDate = (value, fallback) => {
  const date = value ? new Date(value) : new Date(fallback);
  return Number.isNaN(date.getTime()) ? new Date(fallback) : date;
};

const toObjectIdOrRaw = (value) => {
  if (!value) return value;
  if (typeof value === "string" && mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  return value;
};

const BASE_STATUS_FILTER = {
  status: "approved",
  "metadata.includeInLandlordStatement": { $ne: false },
};

const signedAmountExpr = {
  $cond: [{ $eq: ["$direction", "debit"] }, { $multiply: [-1, "$amount"] }, "$amount"],
};

export const getEntriesForStatement = async (propertyId, landlordId, periodStart, periodEnd) => {
  const start = toDate(periodStart, new Date(0));
  const end = toDate(periodEnd, new Date());

  const match = {
    ...BASE_STATUS_FILTER,
    property: toObjectIdOrRaw(propertyId),
    landlord: toObjectIdOrRaw(landlordId),
    statementPeriodStart: { $lte: end },
    statementPeriodEnd: { $gte: start },
  };

  return FinancialLedgerEntry.find(match)
    .sort({ transactionDate: 1, createdAt: 1 })
    .lean();
};

export const getLedgerTotalsByCategory = async (filters = {}) => {
  const match = {
    ...BASE_STATUS_FILTER,
  };

  if (filters.businessId) match.business = toObjectIdOrRaw(filters.businessId);
  if (filters.propertyId) match.property = toObjectIdOrRaw(filters.propertyId);
  if (filters.landlordId) match.landlord = toObjectIdOrRaw(filters.landlordId);
  if (filters.tenantId) match.tenant = toObjectIdOrRaw(filters.tenantId);
  if (filters.unitId) match.unit = toObjectIdOrRaw(filters.unitId);
  if (filters.sourceTransactionType) match.sourceTransactionType = filters.sourceTransactionType;
  if (Array.isArray(filters.categories) && filters.categories.length > 0) {
    match.category = { $in: filters.categories };
  }

  if (filters.periodStart || filters.periodEnd) {
    const start = toDate(filters.periodStart, new Date(0));
    const end = toDate(filters.periodEnd, new Date());
    match.transactionDate = { $gte: start, $lte: end };
  }

  const rows = await FinancialLedgerEntry.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$category",
        count: { $sum: 1 },
        totalAmount: { $sum: signedAmountExpr },
        totalDebit: {
          $sum: {
            $cond: [{ $eq: ["$direction", "debit"] }, "$amount", 0],
          },
        },
        totalCredit: {
          $sum: {
            $cond: [{ $eq: ["$direction", "credit"] }, "$amount", 0],
          },
        },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const totalsByCategory = rows.reduce((acc, row) => {
    acc[row._id] = {
      count: row.count,
      totalAmount: row.totalAmount,
      totalDebit: row.totalDebit,
      totalCredit: row.totalCredit,
    };
    return acc;
  }, {});

  const netTotal = rows.reduce((sum, row) => sum + Number(row.totalAmount || 0), 0);

  return {
    filters,
    netTotal,
    totalsByCategory,
  };
};

export const getOpeningBalance = async (propertyId, landlordId, date) => {
  const asOfDate = toDate(date, new Date());

  const [result] = await FinancialLedgerEntry.aggregate([
    {
      $match: {
        ...BASE_STATUS_FILTER,
        property: toObjectIdOrRaw(propertyId),
        landlord: toObjectIdOrRaw(landlordId),
        transactionDate: { $lt: asOfDate },
      },
    },
    {
      $group: {
        _id: null,
        openingBalance: { $sum: signedAmountExpr },
      },
    },
  ]);

  return Number(result?.openingBalance || 0);
};

export const getLedgerSummaryForProperty = async (propertyId, periodStart, periodEnd) => {
  const start = toDate(periodStart, new Date(0));
  const end = toDate(periodEnd, new Date());

  const propertyMatch = {
    ...BASE_STATUS_FILTER,
    property: toObjectIdOrRaw(propertyId),
  };

  const periodRows = await FinancialLedgerEntry.aggregate([
    {
      $match: {
        ...propertyMatch,
        transactionDate: { $gte: start, $lte: end },
      },
    },
    {
      $group: {
        _id: {
          landlord: "$landlord",
          category: "$category",
        },
        count: { $sum: 1 },
        totalAmount: { $sum: signedAmountExpr },
      },
    },
    { $sort: { "_id.landlord": 1, "_id.category": 1 } },
  ]);

  const openingRows = await FinancialLedgerEntry.aggregate([
    {
      $match: {
        ...propertyMatch,
        transactionDate: { $lt: start },
      },
    },
    {
      $group: {
        _id: "$landlord",
        openingBalance: { $sum: signedAmountExpr },
      },
    },
  ]);

  const openingByLandlord = openingRows.reduce((acc, row) => {
    acc[String(row._id)] = Number(row.openingBalance || 0);
    return acc;
  }, {});

  const landlordSummaryMap = periodRows.reduce((acc, row) => {
    const landlordKey = String(row._id.landlord);
    const category = row._id.category;

    if (!acc[landlordKey]) {
      acc[landlordKey] = {
        landlordId: row._id.landlord,
        openingBalance: openingByLandlord[landlordKey] || 0,
        periodNet: 0,
        closingBalance: 0,
        categories: {},
      };
    }

    acc[landlordKey].categories[category] = {
      count: row.count,
      totalAmount: Number(row.totalAmount || 0),
    };

    acc[landlordKey].periodNet += Number(row.totalAmount || 0);
    acc[landlordKey].closingBalance =
      acc[landlordKey].openingBalance + acc[landlordKey].periodNet;

    return acc;
  }, {});

  const landlordSummaries = Object.values(landlordSummaryMap);
  const propertyNet = landlordSummaries.reduce((sum, row) => sum + row.periodNet, 0);

  const totalsByCategory = await getLedgerTotalsByCategory({
    propertyId,
    periodStart: start,
    periodEnd: end,
  });

  return {
    propertyId,
    periodStart: start,
    periodEnd: end,
    propertyNet,
    totalsByCategory: totalsByCategory.totalsByCategory,
    landlordSummaries,
  };
};

export default {
  getEntriesForStatement,
  getLedgerTotalsByCategory,
  getOpeningBalance,
  getLedgerSummaryForProperty,
};
