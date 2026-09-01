import mongoose from "mongoose";
import InvProduct from "../models/InvProduct.js";
import InvStockEntry from "../models/InvStockEntry.js";
import InvLocation from "../models/InvLocation.js";
import { createError } from "../../../utils/error.js";
import {
  resolveActiveBusinessId,
  currentUserId,
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
      filter.$text = { $search: String(req.query.search).trim() };
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
    if (sellingPrice === undefined || sellingPrice === null || isNaN(Number(sellingPrice))) {
      throw createError(400, "Selling price is required and must be a number");
    }
    if (Number(sellingPrice) < 0) throw createError(400, "Selling price cannot be negative");
    if (Number(costPrice || 0) < 0) throw createError(400, "Cost price cannot be negative");
    const parsedVat = Number(vatRate || 0);
    if (![0, 8, 16].includes(parsedVat)) throw createError(400, "VAT rate must be 0, 8, or 16");
    if (Number(reorderLevel || 0) < 0) throw createError(400, "Reorder level cannot be negative");

    const product = await InvProduct.create({
      business,
      name: String(name).trim(),
      sku: sku ? String(sku).trim().toUpperCase() : undefined,
      barcode: barcode ? String(barcode).trim() : undefined,
      category: category && mongoose.Types.ObjectId.isValid(String(category)) ? String(category) : undefined,
      unitOfMeasure: unitOfMeasure ? String(unitOfMeasure).trim() : "pcs",
      costPrice: Number(costPrice || 0),
      sellingPrice: Number(sellingPrice),
      vatRate: parsedVat,
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

    const b = req.body;
    if (b.name !== undefined) {
      if (!String(b.name).trim()) throw createError(400, "Product name cannot be empty");
      product.name = String(b.name).trim();
    }
    if (b.sku !== undefined) product.sku = b.sku ? String(b.sku).trim().toUpperCase() : null;
    if (b.barcode !== undefined) product.barcode = b.barcode ? String(b.barcode).trim() : null;
    if (b.unitOfMeasure !== undefined) product.unitOfMeasure = String(b.unitOfMeasure).trim() || "pcs";
    if (b.description !== undefined) product.description = String(b.description).trim();
    if (b.imageUrl !== undefined) product.imageUrl = String(b.imageUrl).trim();
    if (b.costPrice !== undefined) {
      if (isNaN(Number(b.costPrice)) || Number(b.costPrice) < 0) throw createError(400, "Cost price cannot be negative");
      product.costPrice = Number(b.costPrice);
    }
    if (b.sellingPrice !== undefined) {
      if (isNaN(Number(b.sellingPrice)) || Number(b.sellingPrice) < 0) throw createError(400, "Selling price cannot be negative");
      product.sellingPrice = Number(b.sellingPrice);
    }
    if (b.vatRate !== undefined) {
      const vat = Number(b.vatRate);
      if (![0, 8, 16].includes(vat)) throw createError(400, "VAT rate must be 0, 8, or 16");
      product.vatRate = vat;
    }
    if (b.reorderLevel !== undefined) {
      if (isNaN(Number(b.reorderLevel)) || Number(b.reorderLevel) < 0) throw createError(400, "Reorder level cannot be negative");
      product.reorderLevel = Number(b.reorderLevel);
    }
    if (b.trackStock !== undefined) product.trackStock = Boolean(b.trackStock);
    if (b.serialized !== undefined) product.serialized = Boolean(b.serialized);
    if (b.active !== undefined) product.active = Boolean(b.active);
    if (b.category !== undefined) {
      product.category = b.category && mongoose.Types.ObjectId.isValid(String(b.category))
        ? String(b.category)
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

export const bulkImportProducts = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) throw createError(400, "No rows provided");
    if (rows.length > 500) throw createError(400, "Maximum 500 rows per import");

    const VAT_ALLOWED = new Set([0, 8, 16]);
    const results = { created: 0, skipped: 0, errors: [] };

    // Validate every row in memory first, then insert in one batch instead of
    // one create() round trip per row.
    const skuSeen = new Map();
    const toInsert = [];
    rows.forEach((r, i) => {
      const rowNum = i + 2; // 1-indexed + header
      const name = String(r.name || "").trim();
      if (!name) { results.errors.push({ row: rowNum, reason: "Name is required" }); results.skipped++; return; }

      const sellingPrice = Number(r.sellingPrice ?? r.selling_price ?? 0);
      if (isNaN(sellingPrice) || sellingPrice < 0) { results.errors.push({ row: rowNum, name, reason: "Invalid selling price" }); results.skipped++; return; }

      const vatRate = Number(r.vatRate ?? r.vat_rate ?? r.vat ?? 16);
      const resolvedVat = VAT_ALLOWED.has(vatRate) ? vatRate : 16;

      const sku = r.sku ? String(r.sku).trim().toUpperCase() : null;
      const barcode = r.barcode ? String(r.barcode).trim() : null;

      // Catch in-batch duplicate SKUs up front — a unique-index race inside the
      // same insertMany batch can't otherwise be attributed to a single row.
      if (sku && skuSeen.has(sku)) {
        results.errors.push({ row: rowNum, name, reason: `Duplicate SKU "${sku}" within this import` });
        results.skipped++;
        return;
      }
      if (sku) skuSeen.set(sku, rowNum);

      toInsert.push({
        rowNum,
        name,
        doc: {
          business,
          name,
          sku: sku || null,
          barcode: barcode || null,
          category: undefined,
          unitOfMeasure: r.unitOfMeasure || r.unit_of_measure || r.unit || "pcs",
          costPrice: Number(r.costPrice ?? r.cost_price ?? r.cost ?? 0),
          sellingPrice,
          vatRate: resolvedVat,
          trackStock: String(r.trackStock ?? r.track_stock ?? "true").toLowerCase() !== "false",
          serialized: String(r.serialized ?? "false").toLowerCase() === "true",
          reorderLevel: Number(r.reorderLevel ?? r.reorder_level ?? 0),
          description: String(r.description || "").trim(),
        },
      });
    });

    if (toInsert.length) {
      try {
        const inserted = await InvProduct.insertMany(toInsert.map((r) => r.doc), { ordered: false });
        results.created += inserted.length;
      } catch (bulkErr) {
        const insertedDocs = bulkErr.insertedDocs || [];
        results.created += insertedDocs.length;
        const writeErrors = bulkErr.writeErrors || [];
        if (writeErrors.length) {
          for (const we of writeErrors) {
            const row = toInsert[we.index];
            const code = we.code ?? we.err?.code;
            const reason = code === 11000 ? "Duplicate SKU" : (we.errmsg || we.err?.errmsg || "Insert failed");
            results.errors.push({ row: row?.rowNum, name: row?.name, reason });
            results.skipped++;
          }
        } else {
          for (const row of toInsert) {
            results.errors.push({ row: row.rowNum, name: row.name, reason: bulkErr.message || "Insert failed" });
            results.skipped++;
          }
        }
      }
    }

    res.status(201).json({ success: true, ...results });
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
