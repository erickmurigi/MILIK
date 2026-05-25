import mongoose from "mongoose";
import InvStockEntry from "../models/InvStockEntry.js";
import { createError } from "../../../utils/error.js";

const VALID_TYPES = new Set([
  "purchase", "sale", "return", "transfer_out", "transfer_in",
  "adjustment", "writeoff", "opening",
]);

/**
 * Post a single stock movement and return the saved entry.
 * qty > 0 = stock in, qty < 0 = stock out.
 */
export const postStockEntry = async ({
  business,
  location,
  product,
  type,
  qty,
  unitCost = 0,
  reference = "",
  purchaseOrder = null,
  stockTransfer = null,
  posSale = null,
  batch = "",
  expiryDate = null,
  notes = "",
  createdBy = null,
}) => {
  if (!VALID_TYPES.has(type)) throw createError(400, `Invalid stock entry type: ${type}`);
  if (qty === 0) throw createError(400, "Stock entry qty cannot be zero");

  const totalCost = Math.round(Math.abs(Number(qty)) * Number(unitCost) * 100) / 100;

  return InvStockEntry.create({
    business,
    location,
    product,
    type,
    qty,
    unitCost: Number(unitCost) || 0,
    totalCost,
    reference: String(reference || "").trim(),
    purchaseOrder: purchaseOrder || null,
    stockTransfer: stockTransfer || null,
    posSale: posSale || null,
    batch: String(batch || "").trim(),
    expiryDate: expiryDate || null,
    notes: String(notes || "").trim(),
    createdBy: createdBy || null,
  });
};

/**
 * Returns the current stock balance for a single (business, location, product) tuple.
 */
export const getStockBalance = async (business, location, product) => {
  const result = await InvStockEntry.aggregate([
    {
      $match: {
        business: new mongoose.Types.ObjectId(String(business)),
        location: new mongoose.Types.ObjectId(String(location)),
        product: new mongoose.Types.ObjectId(String(product)),
      },
    },
    { $group: { _id: null, balance: { $sum: "$qty" } } },
  ]);
  return result[0]?.balance ?? 0;
};

/**
 * Returns a map of productId -> balance for a list of products in one location.
 * Efficient: single aggregation.
 */
export const getMultiProductBalances = async (business, location, productIds = []) => {
  if (!productIds.length) return {};

  const objectIds = productIds
    .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
    .map((id) => new mongoose.Types.ObjectId(String(id)));

  const rows = await InvStockEntry.aggregate([
    {
      $match: {
        business: new mongoose.Types.ObjectId(String(business)),
        location: new mongoose.Types.ObjectId(String(location)),
        product: { $in: objectIds },
      },
    },
    { $group: { _id: "$product", balance: { $sum: "$qty" } } },
  ]);

  const map = {};
  for (const row of rows) map[String(row._id)] = row.balance;
  return map;
};

/**
 * Returns a map of locationId -> productId -> balance for cross-location queries.
 * Used by the stock overview / transfers.
 */
export const getMultiLocationBalances = async (business, productIds = []) => {
  if (!productIds.length) return {};

  const objectIds = productIds
    .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
    .map((id) => new mongoose.Types.ObjectId(String(id)));

  const rows = await InvStockEntry.aggregate([
    {
      $match: {
        business: new mongoose.Types.ObjectId(String(business)),
        product: { $in: objectIds },
      },
    },
    {
      $group: {
        _id: { location: "$location", product: "$product" },
        balance: { $sum: "$qty" },
      },
    },
  ]);

  const map = {};
  for (const row of rows) {
    const loc = String(row._id.location);
    const prod = String(row._id.product);
    if (!map[loc]) map[loc] = {};
    map[loc][prod] = row.balance;
  }
  return map;
};

/**
 * Throws 409 if the current balance is insufficient for the requested qty.
 */
export const assertSufficientStock = async (business, location, product, requiredQty) => {
  const balance = await getStockBalance(business, location, product);
  if (balance < requiredQty) {
    throw createError(
      409,
      `Insufficient stock. Available: ${balance}, Required: ${requiredQty}`
    );
  }
  return balance;
};
