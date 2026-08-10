import mongoose from "mongoose";
import InvStockEntry from "../models/InvStockEntry.js";
import InvProduct from "../models/InvProduct.js";
import { createError } from "../../../utils/error.js";
import {
  resolveActiveBusinessId,
  currentUserId,
  escapeRegex,
  parseDateRange,
} from "../services/inventoryScope.js";
import { postStockEntry, getStockBalance as computeBalance } from "../services/stockLedger.js";
import { postStockAdjustmentLedger } from "../services/inventoryAccountingService.js";

const MANUAL_TYPES = new Set(["adjustment", "writeoff", "opening", "return"]);

export const listStockMovements = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };

    if (req.query.location && mongoose.Types.ObjectId.isValid(String(req.query.location))) {
      filter.location = String(req.query.location);
    }
    if (req.query.product && mongoose.Types.ObjectId.isValid(String(req.query.product))) {
      filter.product = String(req.query.product);
    }
    if (req.query.type) {
      const types = String(req.query.type).split(",").map((s) => s.trim()).filter(Boolean);
      filter.type = types.length === 1 ? types[0] : { $in: types };
    }
    if (req.query.reference) {
      filter.reference = new RegExp(escapeRegex(String(req.query.reference).trim()), "i");
    }
    if (req.query.date) {
      const { start, end } = parseDateRange(req.query.date);
      filter.createdAt = { $gte: start, $lt: end };
    } else if (req.query.from || req.query.to) {
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
      if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
    }

    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const page = Math.max(Number(req.query.page || 1), 1);
    const skip = (page - 1) * limit;

    const [entries, total] = await Promise.all([
      InvStockEntry.find(filter)
        .populate("location", "name type")
        .populate("product", "name sku unitOfMeasure")
        .populate("createdBy", "name username")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      InvStockEntry.countDocuments(filter),
    ]);

    res.json({ success: true, data: entries, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
};

export const getProductBalance = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { location, product } = req.query;

    if (!location || !mongoose.Types.ObjectId.isValid(String(location))) {
      throw createError(400, "Valid location is required");
    }
    if (!product || !mongoose.Types.ObjectId.isValid(String(product))) {
      throw createError(400, "Valid product is required");
    }

    const balance = await computeBalance(business, String(location), String(product));
    res.json({ success: true, data: { balance } });
  } catch (err) {
    next(err);
  }
};

// Manual stock entry: adjustment, write-off, opening stock
export const createManualEntry = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const { location, product, type, qty, unitCost, reference, batch, expiryDate, notes } = req.body;

    if (!location || !mongoose.Types.ObjectId.isValid(String(location))) {
      throw createError(400, "Valid location is required");
    }
    if (!product || !mongoose.Types.ObjectId.isValid(String(product))) {
      throw createError(400, "Valid product is required");
    }
    if (!type || !MANUAL_TYPES.has(type)) {
      throw createError(400, `Type must be one of: ${[...MANUAL_TYPES].join(", ")}`);
    }
    if (qty === undefined || qty === null || Number(qty) === 0) {
      throw createError(400, "Qty cannot be zero");
    }
    if (isNaN(Number(qty))) throw createError(400, "Qty must be a number");
    if (unitCost !== undefined && Number(unitCost) < 0) throw createError(400, "Unit cost cannot be negative");

    const invProduct = await InvProduct.findOne({ _id: product, business, active: true }).lean();
    if (!invProduct) throw createError(404, "Product not found");

    const entry = await postStockEntry({
      business,
      location: String(location),
      product: String(product),
      type,
      qty: Number(qty),
      unitCost: Number(unitCost || invProduct.costPrice || 0),
      reference: reference ? String(reference).trim() : `MANUAL-${type.toUpperCase()}`,
      batch: batch ? String(batch).trim() : "",
      expiryDate: expiryDate ? new Date(expiryDate) : null,
      notes: notes ? String(notes).trim() : "",
      createdBy: userId,
    });

    try {
      await postStockAdjustmentLedger({ businessId: business, stockEntry: entry, userId });
    } catch (err) {
      console.error("[INV GL] postStockAdjustmentLedger failed:", err);
    }

    const newBalance = await computeBalance(business, String(location), String(product));

    res.status(201).json({ success: true, data: entry, newBalance });
  } catch (err) {
    next(err);
  }
};

// Low-stock alert: products where balance ≤ reorderLevel (and reorderLevel > 0)
export const getLowStock = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);

    const balances = await InvStockEntry.aggregate([
      { $match: { business: new mongoose.Types.ObjectId(String(business)) } },
      { $group: { _id: "$product", balance: { $sum: "$qty" } } },
    ]);

    if (!balances.length) return res.json({ success: true, data: [], total: 0 });

    const productIds = balances.map((b) => b._id);
    const products = await InvProduct.find({
      _id: { $in: productIds },
      business,
      trackStock: true,
      reorderLevel: { $gt: 0 },
    })
      .populate("category", "name")
      .lean();

    const balanceMap = new Map(balances.map((b) => [String(b._id), b.balance]));

    const items = products
      .map((p) => ({
        product: p,
        balance: balanceMap.get(String(p._id)) ?? 0,
        reorderLevel: p.reorderLevel,
        deficit: Math.max(0, p.reorderLevel - (balanceMap.get(String(p._id)) ?? 0)),
      }))
      .filter((item) => item.balance <= item.reorderLevel)
      .sort((a, b) => a.balance - b.balance);

    res.json({ success: true, data: items, total: items.length });
  } catch (err) {
    next(err);
  }
};

// Stock valuation: balance × cost per product per location
export const stockValuation = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const locationFilter = req.query.location && mongoose.Types.ObjectId.isValid(String(req.query.location))
      ? { location: new mongoose.Types.ObjectId(String(req.query.location)) }
      : {};

    const rows = await InvStockEntry.aggregate([
      { $match: { business: new mongoose.Types.ObjectId(String(business)), ...locationFilter } },
      {
        $group: {
          _id: { location: "$location", product: "$product" },
          balance: { $sum: "$qty" },
          lastUnitCost: { $last: "$unitCost" },
        },
      },
      { $match: { balance: { $gt: 0 } } },
      {
        $lookup: {
          from: "invproducts",
          localField: "_id.product",
          foreignField: "_id",
          as: "productDoc",
        },
      },
      { $unwind: { path: "$productDoc", preserveNullAndEmptyArrays: false } },
      {
        $lookup: {
          from: "invlocations",
          localField: "_id.location",
          foreignField: "_id",
          as: "locationDoc",
        },
      },
      { $unwind: { path: "$locationDoc", preserveNullAndEmptyArrays: false } },
      {
        $project: {
          _id: 0,
          location: { _id: "$_id.location", name: "$locationDoc.name" },
          product: { _id: "$_id.product", name: "$productDoc.name", sku: "$productDoc.sku", unitOfMeasure: "$productDoc.unitOfMeasure" },
          balance: 1,
          unitCost: "$lastUnitCost",
          totalValue: { $multiply: ["$balance", "$lastUnitCost"] },
        },
      },
      { $sort: { "location.name": 1, "product.name": 1 } },
    ]);

    const grandTotal = rows.reduce((acc, r) => acc + r.totalValue, 0);
    res.json({ success: true, data: rows, grandTotal });
  } catch (err) {
    next(err);
  }
};
