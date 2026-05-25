import mongoose from "mongoose";
import InvProduct from "../models/InvProduct.js";
import InvStockEntry from "../models/InvStockEntry.js";
import InvLocation from "../models/InvLocation.js";
import { createError } from "../../../utils/error.js";
import {
  resolveActiveBusinessId,
  currentUserId,
  escapeRegex,
  parseBoolean,
} from "../services/inventoryScope.js";
import { getMultiLocationBalances } from "../services/stockLedger.js";

export const listProducts = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };

    const active = parseBoolean(req.query.active);
    if (active !== undefined) filter.active = active;
    if (req.query.category && mongoose.Types.ObjectId.isValid(String(req.query.category))) {
      filter.category = String(req.query.category);
    }
    if (req.query.trackStock !== undefined) filter.trackStock = parseBoolean(req.query.trackStock);
    if (req.query.search) {
      const rx = new RegExp(escapeRegex(String(req.query.search).trim()), "i");
      filter.$or = [{ name: rx }, { sku: rx }, { barcode: rx }];
    }

    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const page = Math.max(Number(req.query.page || 1), 1);
    const skip = (page - 1) * limit;

    const [products, total] = await Promise.all([
      InvProduct.find(filter)
        .populate("category", "name")
        .sort({ name: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      InvProduct.countDocuments(filter),
    ]);

    // Optionally attach per-location balances when a locationId is provided
    if (req.query.location && mongoose.Types.ObjectId.isValid(String(req.query.location))) {
      const locationId = String(req.query.location);
      const productIds = products.map((p) => p._id);
      const balanceMap = await getMultiLocationBalances(business, productIds);
      const locBalances = balanceMap[locationId] || {};
      for (const p of products) p.stockBalance = locBalances[String(p._id)] ?? 0;
    }

    res.json({ success: true, data: products, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
};

export const getProduct = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const product = await InvProduct.findOne({ _id: req.params.id, business })
      .populate("category", "name")
      .lean();
    if (!product) throw createError(404, "Product not found");

    // Attach balances across all locations
    if (req.query.withStock === "true") {
      const locations = await InvLocation.find({ business, active: true }).lean();
      const balanceMap = await getMultiLocationBalances(business, [product._id]);
      product.stockByLocation = locations.map((loc) => ({
        location: loc._id,
        locationName: loc.name,
        balance: balanceMap[String(loc._id)]?.[String(product._id)] ?? 0,
      }));
    }

    res.json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
};

export const createProduct = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const {
      name, sku, barcode, category, unitOfMeasure,
      costPrice, sellingPrice, vatRate, trackStock, serialized, reorderLevel,
      description, imageUrl,
    } = req.body;

    if (!name?.trim()) throw createError(400, "Product name is required");
    if (sellingPrice === undefined || sellingPrice === null) throw createError(400, "Selling price is required");

    const product = await InvProduct.create({
      business,
      name: String(name).trim(),
      sku: sku ? String(sku).trim().toUpperCase() : undefined,
      barcode: barcode ? String(barcode).trim() : undefined,
      category: category && mongoose.Types.ObjectId.isValid(String(category)) ? String(category) : undefined,
      unitOfMeasure: unitOfMeasure ? String(unitOfMeasure).trim() : "Unit",
      costPrice: Number(costPrice || 0),
      sellingPrice: Number(sellingPrice),
      vatRate: Number(vatRate || 0),
      trackStock: parseBoolean(trackStock, true),
      serialized: parseBoolean(serialized, false),
      reorderLevel: Number(reorderLevel || 0),
      description: description ? String(description).trim() : "",
      imageUrl: imageUrl ? String(imageUrl).trim() : "",
    });

    res.status(201).json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
};

export const updateProduct = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const product = await InvProduct.findOne({ _id: req.params.id, business });
    if (!product) throw createError(404, "Product not found");

    const allowed = [
      "name", "sku", "barcode", "unitOfMeasure", "costPrice", "sellingPrice",
      "vatRate", "trackStock", "serialized", "reorderLevel", "description", "imageUrl", "active",
    ];
    for (const key of allowed) {
      if (req.body[key] !== undefined) product[key] = req.body[key];
    }
    if (req.body.name) product.name = String(req.body.name).trim();
    if (req.body.sku) product.sku = String(req.body.sku).trim().toUpperCase();
    if (req.body.category !== undefined) {
      product.category = req.body.category && mongoose.Types.ObjectId.isValid(String(req.body.category))
        ? String(req.body.category)
        : undefined;
    }

    await product.save();
    res.json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
};

export const deleteProduct = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const product = await InvProduct.findOne({ _id: req.params.id, business }).lean();
    if (!product) throw createError(404, "Product not found");

    const hasEntries = await InvStockEntry.exists({ business, product: product._id });
    if (hasEntries) throw createError(400, "Cannot delete a product with stock movements. Deactivate it instead.");

    await InvProduct.deleteOne({ _id: product._id });
    res.json({ success: true, message: "Product deleted" });
  } catch (err) {
    next(err);
  }
};

// Lookup by barcode or SKU — used by POS scanner
export const lookupProduct = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const q = String(req.query.q || "").trim();
    if (!q) throw createError(400, "Search query is required");

    const product = await InvProduct.findOne({
      business,
      active: true,
      $or: [{ barcode: q }, { sku: q.toUpperCase() }],
    })
      .populate("category", "name")
      .lean();

    if (!product) throw createError(404, "Product not found");
    res.json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
};
