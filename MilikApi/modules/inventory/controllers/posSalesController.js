import mongoose from "mongoose";
import POSSale from "../models/POSSale.js";
import POSSession from "../models/POSSession.js";
import InvProduct from "../models/InvProduct.js";
import { createError } from "../../../utils/error.js";
import {
  resolveActiveBusinessId,
  currentUserId,
  escapeRegex,
  parseDateRange,
} from "../services/inventoryScope.js";
import { postStockEntry, assertSufficientStock } from "../services/stockLedger.js";
import { nextSequenceNumber } from "../services/sequenceService.js";
import { postPosSaleLedger, reversePosSaleLedger } from "../services/inventoryAccountingService.js";

const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

const populateSale = (q) =>
  q
    .populate("location", "name type")
    .populate("session", "sessionNumber openedAt")
    .populate("cashier", "name username")
    .populate("voidedBy", "name username");

export const listSales = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };

    if (req.query.status) filter.status = String(req.query.status).trim();
    if (req.query.location && mongoose.Types.ObjectId.isValid(String(req.query.location))) {
      filter.location = String(req.query.location);
    }
    if (req.query.session && mongoose.Types.ObjectId.isValid(String(req.query.session))) {
      filter.session = String(req.query.session);
    }
    if (req.query.cashier && mongoose.Types.ObjectId.isValid(String(req.query.cashier))) {
      filter.cashier = String(req.query.cashier);
    }
    if (req.query.receiptNumber) {
      filter.receiptNumber = new RegExp(escapeRegex(String(req.query.receiptNumber).trim()), "i");
    }
    if (req.query.customer) {
      const rx = new RegExp(escapeRegex(String(req.query.customer).trim()), "i");
      filter.$or = [{ customerName: rx }, { customerPhone: rx }];
    }
    if (req.query.date) {
      const { start, end } = parseDateRange(req.query.date);
      filter.createdAt = { $gte: start, $lt: end };
    } else if (req.query.from || req.query.to) {
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
      if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
    }

    const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 100);
    const page = Math.max(Number(req.query.page || 1), 1);
    const skip = (page - 1) * limit;

    const [sales, total] = await Promise.all([
      populateSale(POSSale.find(filter))
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      POSSale.countDocuments(filter),
    ]);

    res.json({ success: true, data: sales, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
};

export const getSale = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const sale = await populateSale(POSSale.findOne({ _id: req.params.id, business })).lean();
    if (!sale) throw createError(404, "Sale not found");
    res.json({ success: true, data: sale });
  } catch (err) {
    next(err);
  }
};

export const createSale = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const {
      location, session, lines = [], payments = [],
      customerName, customerPhone, amountTendered, notes,
    } = req.body;

    if (!location || !mongoose.Types.ObjectId.isValid(String(location))) {
      throw createError(400, "Valid location is required");
    }
    if (!session || !mongoose.Types.ObjectId.isValid(String(session))) {
      throw createError(400, "Valid session is required");
    }

    const activeSession = await POSSession.findOne({ _id: session, business, status: "open" }).lean();
    if (!activeSession) throw createError(400, "Session is not open");
    if (String(activeSession.location) !== String(location)) {
      throw createError(400, "Session does not belong to this location");
    }

    if (!Array.isArray(lines) || !lines.length) throw createError(400, "At least one sale line is required");
    if (!Array.isArray(payments) || !payments.length) throw createError(400, "At least one payment is required");

    // Validate and enrich each line
    let subtotal = 0;
    let totalDiscount = 0;
    let totalVat = 0;
    const enrichedLines = [];

    for (const line of lines) {
      if (!line.product || !mongoose.Types.ObjectId.isValid(String(line.product))) {
        throw createError(400, "Each line must have a valid product");
      }
      const qty = Number(line.qty || 0);
      if (qty <= 0) throw createError(400, "Line qty must be positive");

      const product = await InvProduct.findOne({ _id: line.product, business, active: true }).lean();
      if (!product) throw createError(404, `Product ${line.product} not found`);

      // Block sale if tracked product has insufficient stock
      if (product.trackStock) {
        await assertSufficientStock(business, String(location), String(line.product), qty);
      }

      const unitPrice = Number(line.unitPrice ?? product.sellingPrice ?? 0);
      const discount = Number(line.discount || 0);
      const vatRate = Number(line.vatRate ?? product.vatRate ?? 0);
      const netPrice = round2(unitPrice - discount);
      const lineTotal = round2(netPrice * qty);
      const vatAmount = round2(lineTotal * (vatRate / 100));

      subtotal += round2(unitPrice * qty);
      totalDiscount += round2(discount * qty);
      totalVat += vatAmount;

      enrichedLines.push({
        product: String(line.product),
        productName: product.name,
        sku: product.sku || "",
        qty,
        unitPrice,
        discount,
        vatRate,
        vatAmount,
        lineTotal,
        costPrice: product.costPrice || 0,
      });
    }

    const grandTotal = round2(subtotal - totalDiscount + totalVat);
    const paymentTotal = round2(payments.reduce((s, p) => s + Number(p.amount || 0), 0));

    if (paymentTotal < grandTotal) {
      throw createError(400, `Payment total (${paymentTotal}) is less than grand total (${grandTotal})`);
    }

    const receiptNumber = await nextSequenceNumber(business, "receipt", "RCP");

    const sale = await POSSale.create({
      business,
      location: String(location),
      session: String(session),
      receiptNumber,
      lines: enrichedLines,
      payments: payments.map((p) => ({
        method: String(p.method),
        amount: round2(Number(p.amount || 0)),
        ref: p.ref ? String(p.ref).trim() : "",
      })),
      subtotal: round2(subtotal),
      totalDiscount: round2(totalDiscount),
      totalVat: round2(totalVat),
      grandTotal,
      amountTendered: round2(Number(amountTendered || paymentTotal)),
      change: round2(Number(amountTendered || paymentTotal) - grandTotal),
      customerName: customerName ? String(customerName).trim() : "",
      customerPhone: customerPhone ? String(customerPhone).trim() : "",
      cashier: userId,
      notes: notes ? String(notes).trim() : "",
      status: "completed",
    });

    // Deduct stock for tracked products
    for (const line of enrichedLines) {
      const product = await InvProduct.findById(line.product).lean();
      if (!product?.trackStock) continue;
      await postStockEntry({
        business,
        location: String(location),
        product: String(line.product),
        type: "sale",
        qty: -line.qty,
        unitCost: line.costPrice,
        reference: receiptNumber,
        posSale: sale._id,
        notes: `POS sale: ${receiptNumber}`,
        createdBy: userId,
      });
    }

    // Post GL entries — non-blocking; GL failure never rejects the sale
    postPosSaleLedger({ businessId: business, sale, userId }).catch((err) =>
      console.error("[INV GL] postPosSaleLedger failed:", err.message)
    );

    res.status(201).json({ success: true, data: sale });
  } catch (err) {
    next(err);
  }
};

export const voidSale = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const { voidReason } = req.body;

    const sale = await POSSale.findOne({ _id: req.params.id, business });
    if (!sale) throw createError(404, "Sale not found");
    if (sale.status !== "completed") throw createError(400, "Only completed sales can be voided");
    if (!voidReason?.trim()) throw createError(400, "Void reason is required");

    // Reverse stock entries for tracked products
    for (const line of sale.lines) {
      const product = await InvProduct.findById(line.product).lean();
      if (!product?.trackStock) continue;
      await postStockEntry({
        business,
        location: String(sale.location),
        product: String(line.product),
        type: "return",
        qty: line.qty,
        unitCost: line.costPrice,
        reference: sale.receiptNumber,
        posSale: sale._id,
        notes: `Void of sale ${sale.receiptNumber}: ${voidReason}`,
        createdBy: userId,
      });
    }

    sale.status = "voided";
    sale.voidedBy = userId;
    sale.voidedAt = new Date();
    sale.voidReason = String(voidReason).trim();
    await sale.save();

    // Reverse GL entries for the original sale
    reversePosSaleLedger({ businessId: business, sale, userId }).catch((err) =>
      console.error("[INV GL] reversePosSaleLedger failed:", err.message)
    );

    res.json({ success: true, data: sale });
  } catch (err) {
    next(err);
  }
};

// Sales summary per session or date range — used by session close report
export const salesSummary = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business, status: "completed" };

    if (req.query.session && mongoose.Types.ObjectId.isValid(String(req.query.session))) {
      filter.session = String(req.query.session);
    }
    if (req.query.location && mongoose.Types.ObjectId.isValid(String(req.query.location))) {
      filter.location = String(req.query.location);
    }
    if (req.query.date) {
      const { start, end } = parseDateRange(req.query.date);
      filter.createdAt = { $gte: start, $lt: end };
    }

    const [summary] = await POSSale.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          subtotal: { $sum: "$subtotal" },
          totalDiscount: { $sum: "$totalDiscount" },
          totalVat: { $sum: "$totalVat" },
          grandTotal: { $sum: "$grandTotal" },
        },
      },
    ]);

    const paymentBreakdown = await POSSale.aggregate([
      { $match: filter },
      { $unwind: "$payments" },
      { $group: { _id: "$payments.method", total: { $sum: "$payments.amount" } } },
    ]);

    res.json({
      success: true,
      data: {
        count: summary?.count ?? 0,
        subtotal: round2(summary?.subtotal ?? 0),
        totalDiscount: round2(summary?.totalDiscount ?? 0),
        totalVat: round2(summary?.totalVat ?? 0),
        grandTotal: round2(summary?.grandTotal ?? 0),
        byPaymentMethod: Object.fromEntries(paymentBreakdown.map((r) => [r._id, round2(r.total)])),
      },
    });
  } catch (err) {
    next(err);
  }
};
