import mongoose from "mongoose";
import InvStockTransfer from "../models/InvStockTransfer.js";
import InvProduct from "../models/InvProduct.js";
import { createError } from "../../../utils/error.js";
import {
  resolveActiveBusinessId,
  currentUserId,
  escapeRegex,
} from "../services/inventoryScope.js";
import { postStockEntry, assertSufficientStock } from "../services/stockLedger.js";
import { nextSequenceNumber } from "../services/sequenceService.js";

const populateTransfer = (q) =>
  q
    .populate("fromLocation", "name type")
    .populate("toLocation", "name type")
    .populate("lines.product", "name sku unitOfMeasure")
    .populate("dispatchedBy", "name username")
    .populate("receivedBy", "name username")
    .populate("createdBy", "name username");

export const listTransfers = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };

    if (req.query.status) filter.status = String(req.query.status).trim();
    if (req.query.fromLocation && mongoose.Types.ObjectId.isValid(String(req.query.fromLocation))) {
      filter.fromLocation = String(req.query.fromLocation);
    }
    if (req.query.toLocation && mongoose.Types.ObjectId.isValid(String(req.query.toLocation))) {
      filter.toLocation = String(req.query.toLocation);
    }
    if (req.query.search) {
      filter.transferNumber = new RegExp(escapeRegex(String(req.query.search).trim()), "i");
    }
    if (req.query.from || req.query.to) {
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
      if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
    }

    const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 100);
    const page = Math.max(Number(req.query.page || 1), 1);
    const skip = (page - 1) * limit;

    const [transfers, total] = await Promise.all([
      populateTransfer(InvStockTransfer.find(filter))
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      InvStockTransfer.countDocuments(filter),
    ]);

    res.json({ success: true, data: transfers, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
};

export const getTransfer = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const transfer = await populateTransfer(
      InvStockTransfer.findOne({ _id: req.params.id, business })
    ).lean();
    if (!transfer) throw createError(404, "Transfer not found");
    res.json({ success: true, data: transfer });
  } catch (err) {
    next(err);
  }
};

export const createTransfer = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const { fromLocation, toLocation, lines = [], notes } = req.body;

    if (!fromLocation || !mongoose.Types.ObjectId.isValid(String(fromLocation))) {
      throw createError(400, "Valid fromLocation is required");
    }
    if (!toLocation || !mongoose.Types.ObjectId.isValid(String(toLocation))) {
      throw createError(400, "Valid toLocation is required");
    }
    if (String(fromLocation) === String(toLocation)) {
      throw createError(400, "Source and destination location cannot be the same");
    }
    if (!Array.isArray(lines) || !lines.length) throw createError(400, "At least one line is required");

    for (const line of lines) {
      if (!line.product || !mongoose.Types.ObjectId.isValid(String(line.product))) {
        throw createError(400, "Each line must have a valid product");
      }
      if (!line.qtyDispatched || Number(line.qtyDispatched) <= 0) {
        throw createError(400, "Each line qtyDispatched must be positive");
      }
    }

    const transferNumber = await nextSequenceNumber(business, "transfer", "TRF");

    const transfer = await InvStockTransfer.create({
      business,
      transferNumber,
      fromLocation: String(fromLocation),
      toLocation: String(toLocation),
      lines: lines.map((l) => ({
        product: String(l.product),
        qtyDispatched: Number(l.qtyDispatched),
        qtyReceived: 0,
        unitCost: Number(l.unitCost || 0),
        notes: l.notes ? String(l.notes).trim() : "",
      })),
      notes: notes ? String(notes).trim() : "",
      status: "draft",
      createdBy: userId,
      updatedBy: userId,
    });

    res.status(201).json({ success: true, data: transfer });
  } catch (err) {
    next(err);
  }
};

export const updateTransfer = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const transfer = await InvStockTransfer.findOne({ _id: req.params.id, business });
    if (!transfer) throw createError(404, "Transfer not found");
    if (transfer.status !== "draft") throw createError(400, "Only draft transfers can be edited");

    if (req.body.fromLocation && mongoose.Types.ObjectId.isValid(String(req.body.fromLocation))) {
      transfer.fromLocation = String(req.body.fromLocation);
    }
    if (req.body.toLocation && mongoose.Types.ObjectId.isValid(String(req.body.toLocation))) {
      transfer.toLocation = String(req.body.toLocation);
    }
    if (req.body.notes !== undefined) transfer.notes = String(req.body.notes).trim();
    if (Array.isArray(req.body.lines)) {
      transfer.lines = req.body.lines.map((l) => ({
        product: String(l.product),
        qtyDispatched: Number(l.qtyDispatched),
        qtyReceived: 0,
        unitCost: Number(l.unitCost || 0),
        notes: l.notes ? String(l.notes).trim() : "",
      }));
    }
    transfer.updatedBy = userId;
    await transfer.save();

    res.json({ success: true, data: transfer });
  } catch (err) {
    next(err);
  }
};

// Dispatch: deduct from fromLocation, move status to in_transit
export const dispatchTransfer = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const transfer = await InvStockTransfer.findOne({ _id: req.params.id, business });
    if (!transfer) throw createError(404, "Transfer not found");
    if (transfer.status !== "draft") throw createError(400, "Only draft transfers can be dispatched");

    // Check all lines have sufficient stock
    for (const line of transfer.lines) {
      await assertSufficientStock(
        business,
        String(transfer.fromLocation),
        String(line.product),
        Number(line.qtyDispatched)
      );
    }

    // Post transfer_out entries
    for (const line of transfer.lines) {
      const product = await InvProduct.findById(line.product).lean();
      await postStockEntry({
        business,
        location: String(transfer.fromLocation),
        product: String(line.product),
        type: "transfer_out",
        qty: -Number(line.qtyDispatched),
        unitCost: Number(line.unitCost || product?.costPrice || 0),
        reference: transfer.transferNumber,
        stockTransfer: transfer._id,
        notes: `Transfer out to ${transfer.toLocation} — ${transfer.transferNumber}`,
        createdBy: userId,
      });
    }

    transfer.status = "in_transit";
    transfer.dispatchedAt = new Date();
    transfer.dispatchedBy = userId;
    transfer.updatedBy = userId;
    await transfer.save();

    res.json({ success: true, data: transfer });
  } catch (err) {
    next(err);
  }
};

// Receive: add to toLocation; supports partial receipt
export const receiveTransfer = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const transfer = await InvStockTransfer.findOne({ _id: req.params.id, business });
    if (!transfer) throw createError(404, "Transfer not found");
    if (!["in_transit", "partially_received"].includes(transfer.status)) {
      throw createError(400, "Transfer is not in transit");
    }

    const receivedLines = req.body.lines; // [{ lineId, qtyReceived }]
    if (!Array.isArray(receivedLines) || !receivedLines.length) {
      throw createError(400, "Provide lines with quantities received");
    }

    for (const recv of receivedLines) {
      const line = transfer.lines.id(recv.lineId);
      if (!line) throw createError(400, `Line ${recv.lineId} not found on this transfer`);

      const pending = Number(line.qtyDispatched) - Number(line.qtyReceived);
      const qty = Math.min(Number(recv.qtyReceived || 0), pending);
      if (qty <= 0) continue;

      await postStockEntry({
        business,
        location: String(transfer.toLocation),
        product: String(line.product),
        type: "transfer_in",
        qty,
        unitCost: Number(line.unitCost || 0),
        reference: transfer.transferNumber,
        stockTransfer: transfer._id,
        notes: `Transfer in from ${transfer.fromLocation} — ${transfer.transferNumber}`,
        createdBy: userId,
      });

      line.qtyReceived = Number(line.qtyReceived) + qty;
    }

    const allReceived = transfer.lines.every(
      (l) => Number(l.qtyReceived) >= Number(l.qtyDispatched)
    );
    transfer.status = allReceived ? "received" : "partially_received";
    if (allReceived) {
      transfer.receivedAt = new Date();
      transfer.receivedBy = userId;
    }
    transfer.updatedBy = userId;
    await transfer.save();

    res.json({ success: true, data: transfer });
  } catch (err) {
    next(err);
  }
};

export const cancelTransfer = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const transfer = await InvStockTransfer.findOne({ _id: req.params.id, business });
    if (!transfer) throw createError(404, "Transfer not found");
    if (!["draft", "in_transit"].includes(transfer.status)) {
      throw createError(400, "Cannot cancel a transfer that has been received");
    }

    // If already in_transit, reverse the transfer_out entries
    if (transfer.status === "in_transit") {
      for (const line of transfer.lines) {
        const product = await InvProduct.findById(line.product).lean();
        await postStockEntry({
          business,
          location: String(transfer.fromLocation),
          product: String(line.product),
          type: "transfer_in",
          qty: Number(line.qtyDispatched),
          unitCost: Number(line.unitCost || product?.costPrice || 0),
          reference: transfer.transferNumber,
          stockTransfer: transfer._id,
          notes: `Reversal — transfer cancelled: ${transfer.transferNumber}`,
          createdBy: userId,
        });
      }
    }

    transfer.status = "cancelled";
    transfer.updatedBy = userId;
    await transfer.save();

    res.json({ success: true, data: transfer });
  } catch (err) {
    next(err);
  }
};
