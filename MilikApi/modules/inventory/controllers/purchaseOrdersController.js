import mongoose from "mongoose";
import InvPurchaseOrder from "../models/InvPurchaseOrder.js";
import InvProduct from "../models/InvProduct.js";
import { createError } from "../../../utils/error.js";
import {
  resolveActiveBusinessId,
  currentUserId,
  escapeRegex,
} from "../services/inventoryScope.js";
import InvStockEntry from "../models/InvStockEntry.js";
import { postStockEntry } from "../services/stockLedger.js";
import { nextSequenceNumber } from "../services/sequenceService.js";
import { postPurchaseReceiptLedger, reversePurchaseReceiptLedger } from "../services/inventoryAccountingService.js";

const populatePO = (q) =>
  q
    .populate("supplier", "name phone email")
    .populate("location", "name type")
    .populate("lines.product", "name sku unitOfMeasure costPrice")
    .populate("createdBy", "name username")
    .populate("updatedBy", "name username");

export const listPurchaseOrders = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };

    if (req.query.status) filter.status = String(req.query.status).trim();
    if (req.query.supplier && mongoose.Types.ObjectId.isValid(String(req.query.supplier))) {
      filter.supplier = String(req.query.supplier);
    }
    if (req.query.location && mongoose.Types.ObjectId.isValid(String(req.query.location))) {
      filter.location = String(req.query.location);
    }
    if (req.query.search) {
      filter.poNumber = new RegExp(escapeRegex(String(req.query.search).trim()), "i");
    }
    if (req.query.from || req.query.to) {
      filter.orderDate = {};
      if (req.query.from) filter.orderDate.$gte = new Date(req.query.from);
      if (req.query.to) filter.orderDate.$lte = new Date(req.query.to);
    }

    const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 100);
    const page = Math.max(Number(req.query.page || 1), 1);
    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      populatePO(InvPurchaseOrder.find(filter))
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      InvPurchaseOrder.countDocuments(filter),
    ]);

    res.json({ success: true, data: orders, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
};

export const getPurchaseOrder = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const order = await populatePO(
      InvPurchaseOrder.findOne({ _id: req.params.id, business })
    ).lean();
    if (!order) throw createError(404, "Purchase order not found");
    res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
};

export const createPurchaseOrder = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const { supplier, location, lines = [], expectedDate, notes } = req.body;

    if (!supplier || !mongoose.Types.ObjectId.isValid(String(supplier))) {
      throw createError(400, "Valid supplier is required");
    }
    if (!location || !mongoose.Types.ObjectId.isValid(String(location))) {
      throw createError(400, "Valid receiving location is required");
    }
    if (!Array.isArray(lines) || !lines.length) throw createError(400, "At least one line is required");

    const seenProducts = new Set();
    let totalAmount = 0;
    const processedLines = lines.map((l) => {
      if (!l.product || !mongoose.Types.ObjectId.isValid(String(l.product))) {
        throw createError(400, "Each line must have a valid product");
      }
      if (seenProducts.has(String(l.product))) throw createError(400, "Duplicate products in lines — combine quantities instead");
      seenProducts.add(String(l.product));
      if (!l.qtyOrdered || Number(l.qtyOrdered) <= 0) {
        throw createError(400, "Each line qtyOrdered must be positive");
      }
      const unitCost = Number(l.unitCost || 0);
      if (unitCost < 0) throw createError(400, "Unit cost cannot be negative");
      const totalCost = Math.round(Number(l.qtyOrdered) * unitCost * 100) / 100;
      totalAmount += totalCost;
      return {
        product: String(l.product),
        qtyOrdered: Number(l.qtyOrdered),
        qtyReceived: 0,
        unitCost,
        totalCost,
      };
    });

    const poNumber = await nextSequenceNumber(business, "po", "PO");

    const order = await InvPurchaseOrder.create({
      business,
      poNumber,
      supplier: String(supplier),
      location: String(location),
      lines: processedLines,
      orderDate: new Date(),
      expectedDate: expectedDate ? new Date(expectedDate) : null,
      totalAmount: Math.round(totalAmount * 100) / 100,
      notes: notes ? String(notes).trim() : "",
      status: "draft",
      createdBy: userId,
      updatedBy: userId,
    });

    res.status(201).json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
};

export const updatePurchaseOrder = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const order = await InvPurchaseOrder.findOne({ _id: req.params.id, business });
    if (!order) throw createError(404, "Purchase order not found");
    if (!["draft", "sent"].includes(order.status)) {
      throw createError(400, "Only draft or sent purchase orders can be edited");
    }

    if (req.body.supplier && mongoose.Types.ObjectId.isValid(String(req.body.supplier))) {
      order.supplier = String(req.body.supplier);
    }
    if (req.body.location && mongoose.Types.ObjectId.isValid(String(req.body.location))) {
      order.location = String(req.body.location);
    }
    if (req.body.expectedDate !== undefined) {
      order.expectedDate = req.body.expectedDate ? new Date(req.body.expectedDate) : null;
    }
    if (req.body.notes !== undefined) order.notes = String(req.body.notes).trim();
    if (req.body.status && ["draft", "sent"].includes(req.body.status)) {
      order.status = req.body.status;
    }

    if (Array.isArray(req.body.lines)) {
      let totalAmount = 0;
      order.lines = req.body.lines.map((l) => {
        const unitCost = Number(l.unitCost || 0);
        const totalCost = Math.round(Number(l.qtyOrdered) * unitCost * 100) / 100;
        totalAmount += totalCost;
        return {
          product: String(l.product),
          qtyOrdered: Number(l.qtyOrdered),
          qtyReceived: 0,
          unitCost,
          totalCost,
        };
      });
      order.totalAmount = Math.round(totalAmount * 100) / 100;
    }

    order.updatedBy = userId;
    await order.save();
    res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
};

// Receive goods against PO lines (supports partial)
export const receiveGoods = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const order = await InvPurchaseOrder.findOne({ _id: req.params.id, business });
    if (!order) throw createError(404, "Purchase order not found");
    if (!["sent", "draft", "partially_received"].includes(order.status)) {
      throw createError(400, "Purchase order cannot receive goods in its current status");
    }

    const receivedLines = req.body.lines; // [{ lineId, qtyReceived, unitCost? }]
    if (!Array.isArray(receivedLines) || !receivedLines.length) {
      throw createError(400, "Provide lines with quantities received");
    }

    for (const recv of receivedLines) {
      const line = order.lines.id(recv.lineId);
      if (!line) throw createError(400, `Line ${recv.lineId} not found on this PO`);

      const pending = Number(line.qtyOrdered) - Number(line.qtyReceived);
      const qty = Math.min(Number(recv.qtyReceived || 0), pending);
      if (qty <= 0) continue;

      const unitCost = Number(recv.unitCost ?? line.unitCost ?? 0);
      if (unitCost < 0) throw createError(400, "Unit cost cannot be negative");

      const [stockEntry] = await Promise.all([
        postStockEntry({
          business,
          location: String(order.location),
          product: String(line.product),
          type: "purchase",
          qty,
          unitCost,
          reference: order.poNumber,
          purchaseOrder: order._id,
          notes: `Goods received from PO ${order.poNumber}`,
          createdBy: userId,
        }),
        // Update product cost price to reflect latest purchase cost
        InvProduct.updateOne({ _id: line.product, business }, { $set: { costPrice: unitCost } }),
      ]);

      postPurchaseReceiptLedger({ businessId: business, stockEntry, poNumber: order.poNumber, userId }).catch((err) =>
        console.error("[INV GL] postPurchaseReceiptLedger failed:", err.message)
      );

      line.qtyReceived = Number(line.qtyReceived) + qty;
      if (recv.unitCost !== undefined) line.unitCost = unitCost;
      line.totalCost = Math.round(Number(line.qtyOrdered) * line.unitCost * 100) / 100;
    }

    const allReceived = order.lines.every(
      (l) => Number(l.qtyReceived) >= Number(l.qtyOrdered)
    );
    const anyReceived = order.lines.some((l) => Number(l.qtyReceived) > 0);
    order.status = allReceived ? "received" : anyReceived ? "partially_received" : order.status;
    if (allReceived) order.receivedAt = new Date();
    order.totalAmount = order.lines.reduce(
      (sum, l) => sum + (Number(l.qtyOrdered) * Number(l.unitCost)),
      0
    );
    order.updatedBy = userId;
    await order.save();

    res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
};

export const cancelPurchaseOrder = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const order = await InvPurchaseOrder.findOne({ _id: req.params.id, business });
    if (!order) throw createError(404, "Purchase order not found");
    if (["received", "cancelled"].includes(order.status)) {
      throw createError(400, "Cannot cancel a received or already-cancelled purchase order");
    }

    // If goods were partially received, reverse the stock entries and GL
    if (order.status === "partially_received") {
      const receivedLines = order.lines.filter((l) => Number(l.qtyReceived) > 0);

      // Fetch the original stock entries for this PO to get their IDs for GL reversal
      const stockEntries = await InvStockEntry.find({
        business,
        purchaseOrder: order._id,
        type: "purchase",
      }).select("_id product qtyReceived unitCost").lean();

      const stockEntryIds = stockEntries.map((e) => String(e._id));

      // Reverse each received line's stock entry (post negative purchase = return to supplier)
      for (const line of receivedLines) {
        const unitCost = Number(line.unitCost || 0);
        await postStockEntry({
          business,
          location: String(order.location),
          product: String(line.product),
          type: "adjustment",
          qty: -Number(line.qtyReceived),
          unitCost,
          reference: order.poNumber,
          purchaseOrder: order._id,
          notes: `PO ${order.poNumber} cancelled — reversing received qty`,
          createdBy: userId,
        });
      }

      // Reverse GL entries for all received stock entries
      reversePurchaseReceiptLedger({
        businessId: business,
        stockEntryIds,
        poNumber: order.poNumber,
        userId,
      }).catch((err) => console.error("[INV GL] reversePurchaseReceiptLedger failed:", err.message));
    }

    order.status = "cancelled";
    order.updatedBy = userId;
    await order.save();
    res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
};
