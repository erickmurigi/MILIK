/**
 * propertyLedger.js — HTTP controllers for Property GL reports.
 * All work is delegated to propertyLedgerService aggregation pipelines.
 * Zero in-memory processing here — thin controllers only.
 */

import mongoose from "mongoose";
import Property from "../../models/Property.js";
import {
  getPropertyTrialBalance,
  getPropertyIncomeStatement,
  getPropertyBalanceSheet,
  getPropertyLedgerJournals,
} from "../../services/propertyLedgerService.js";

const isValidObjectId = (v) => mongoose.isValidObjectId(v);

const resolveBusinessId = (req) =>
  req.user?.company || req.user?.business || req.query.business || null;

// Guard: ensure the property exists, belongs to this business, and has Property GL.
const resolvePropertyLedgerGuard = async (req, res) => {
  const businessId = resolveBusinessId(req);
  const { propertyId } = req.params;

  if (!businessId) {
    res.status(400).json({ success: false, error: "Business context required." });
    return null;
  }
  if (!isValidObjectId(propertyId)) {
    res.status(400).json({ success: false, error: "Invalid propertyId." });
    return null;
  }

  const property = await Property.findOne({ _id: propertyId, business: businessId })
    .select("propertyCode propertyName accountLedgerType propertyLedgerEnabled")
    .lean();

  if (!property) {
    res.status(404).json({ success: false, error: "Property not found." });
    return null;
  }

  const v = String(property.accountLedgerType || "").toLowerCase().trim();
  const isPropertyGL = v.startsWith("off") || v === "property-gl";
  if (!isPropertyGL) {
    res.status(400).json({
      success: false,
      error: "Property Ledger is only available for Property GL properties.",
    });
    return null;
  }

  return { property, businessId, propertyId };
};

// GET /property-ledger/:propertyId/trial-balance
export const getPropertyLedgerTrialBalance = async (req, res, next) => {
  try {
    const ctx = await resolvePropertyLedgerGuard(req, res);
    if (!ctx) return;

    const { asOfDate, includeZeroBalances } = req.query;
    const result = await getPropertyTrialBalance({
      propertyId: ctx.propertyId,
      asOfDate:   asOfDate || new Date().toISOString().split("T")[0],
      includeZeroBalances: includeZeroBalances === "true",
    });

    return res.status(200).json({
      success: true,
      property: { _id: ctx.property._id, code: ctx.property.propertyCode, name: ctx.property.propertyName },
      ledgerEnabled: !!ctx.property.propertyLedgerEnabled,
      ...result,
    });
  } catch (err) {
    next(err);
  }
};

// GET /property-ledger/:propertyId/income-statement
export const getPropertyLedgerIncomeStatement = async (req, res, next) => {
  try {
    const ctx = await resolvePropertyLedgerGuard(req, res);
    if (!ctx) return;

    const { startDate, endDate } = req.query;
    const result = await getPropertyIncomeStatement({
      propertyId: ctx.propertyId,
      startDate,
      endDate,
    });

    return res.status(200).json({
      success: true,
      property: { _id: ctx.property._id, code: ctx.property.propertyCode, name: ctx.property.propertyName },
      ledgerEnabled: !!ctx.property.propertyLedgerEnabled,
      ...result,
    });
  } catch (err) {
    next(err);
  }
};

// GET /property-ledger/:propertyId/balance-sheet
export const getPropertyLedgerBalanceSheet = async (req, res, next) => {
  try {
    const ctx = await resolvePropertyLedgerGuard(req, res);
    if (!ctx) return;

    const { asOfDate, includeZeroBalances } = req.query;
    const result = await getPropertyBalanceSheet({
      propertyId: ctx.propertyId,
      asOfDate:   asOfDate || new Date().toISOString().split("T")[0],
      includeZeroBalances: includeZeroBalances === "true",
    });

    return res.status(200).json({
      success: true,
      property: { _id: ctx.property._id, code: ctx.property.propertyCode, name: ctx.property.propertyName },
      ledgerEnabled: !!ctx.property.propertyLedgerEnabled,
      ...result,
    });
  } catch (err) {
    next(err);
  }
};

// GET /property-ledger/:propertyId/journals
export const getPropertyLedgerJournalEntries = async (req, res, next) => {
  try {
    const ctx = await resolvePropertyLedgerGuard(req, res);
    if (!ctx) return;

    const { startDate, endDate, page = 1, limit = 50 } = req.query;
    const result = await getPropertyLedgerJournals({
      propertyId: ctx.propertyId,
      startDate,
      endDate,
      page:  parseInt(page, 10)  || 1,
      limit: Math.min(parseInt(limit, 10) || 50, 200),
    });

    return res.status(200).json({
      success: true,
      property: { _id: ctx.property._id, code: ctx.property.propertyCode, name: ctx.property.propertyName },
      ledgerEnabled: !!ctx.property.propertyLedgerEnabled,
      ...result,
    });
  } catch (err) {
    next(err);
  }
};
