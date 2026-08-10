import InvSupplierPayment from "../models/InvSupplierPayment.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import { createError } from "../../../utils/error.js";
import { resolveActiveBusinessId, currentUserId } from "../services/inventoryScope.js";
import { nextSequenceNumber } from "../services/sequenceService.js";
import { postSupplierPaymentLedger, reverseSupplierPaymentLedger } from "../services/inventoryAccountingService.js";

const populatePayment = (q) =>
  q
    .populate("supplier",          "name phone email")
    .populate("purchaseOrder",     "poNumber totalAmount")
    .populate("cashbookAccountId", "name code type")
    .populate("createdBy",         "name username");

export const listSupplierPayments = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };
    if (req.query.supplier)     filter.supplier     = String(req.query.supplier);
    if (req.query.purchaseOrder)filter.purchaseOrder = String(req.query.purchaseOrder);
    if (req.query.status)       filter.status       = String(req.query.status);
    if (req.query.from || req.query.to) {
      filter.paymentDate = {};
      if (req.query.from) filter.paymentDate.$gte = new Date(req.query.from);
      if (req.query.to) {
        const to = new Date(req.query.to);
        to.setDate(to.getDate() + 1);
        filter.paymentDate.$lt = to;
      }
    }

    const payments = await populatePayment(InvSupplierPayment.find(filter))
      .sort({ paymentDate: -1, createdAt: -1 })
      .lean();

    res.json({ success: true, data: payments });
  } catch (err) {
    next(err);
  }
};

export const createSupplierPayment = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const { supplier, purchaseOrder, amount, cashbookAccountId, paymentDate, reference, notes } = req.body;

    if (!supplier)                   throw createError(400, "Supplier is required");
    if (!amount || Number(amount) <= 0) throw createError(400, "Amount must be positive");
    if (!cashbookAccountId)          throw createError(400, "Cashbook account is required");
    if (!paymentDate)                throw createError(400, "Payment date is required");

    const cashbookAcc = await ChartOfAccount.findOne({ _id: cashbookAccountId, business }).lean();
    if (!cashbookAcc)                throw createError(404, "Cashbook account not found");
    if (!cashbookAcc.isPosting || cashbookAcc.isHeader) {
      throw createError(400, "Selected account is not a posting account");
    }

    const paymentNumber = await nextSequenceNumber(business, "supplier_payment", "SPY");

    const payment = await InvSupplierPayment.create({
      business,
      paymentNumber,
      supplier:            String(supplier),
      purchaseOrder:       purchaseOrder ? String(purchaseOrder) : null,
      amount:              Math.round(Number(amount) * 100) / 100,
      cashbookAccountId:   String(cashbookAccountId),
      cashbookAccountName: cashbookAcc.name,
      paymentDate:         new Date(paymentDate),
      reference:           reference ? String(reference).trim() : "",
      notes:               notes     ? String(notes).trim()     : "",
      status:   "confirmed",
      createdBy: userId,
      updatedBy: userId,
    });

    try {
      await postSupplierPaymentLedger({ businessId: business, payment, userId });
    } catch (err) {
      console.error("[INV GL] postSupplierPaymentLedger failed:", err);
    }

    const populated = await populatePayment(InvSupplierPayment.findById(payment._id)).lean();
    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    next(err);
  }
};

export const voidSupplierPayment = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const payment  = await InvSupplierPayment.findOne({ _id: req.params.id, business });
    if (!payment)                    throw createError(404, "Payment not found");
    if (payment.status === "voided") throw createError(400, "Payment is already voided");

    payment.status    = "voided";
    payment.voidedAt  = new Date();
    payment.voidedBy  = userId;
    payment.updatedBy = userId;
    await payment.save();

    try {
      await reverseSupplierPaymentLedger({ businessId: business, paymentId: payment._id, userId });
    } catch (err) {
      console.error("[INV GL] reverseSupplierPaymentLedger failed:", err);
    }

    res.json({ success: true, data: payment });
  } catch (err) {
    next(err);
  }
};
