import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import SalePayment from "../models/SalePayment.js";
import SaleDeal from "../models/SaleDeal.js";
import { currentUserId, generateSequentialNumber, resolveActiveBusinessId } from "../services/businessScope.js";
import {
  postPropertySalePaymentLedger,
  reversePropertySalePaymentLedger,
} from "../services/propertySaleAccountingService.js";

// Deep-populate: deal includes nested listing + buyer so receipt/table fields work
const populatePayment = (query) =>
  query.populate({
    path: "deal",
    select: "dealNumber agreedPrice status",
    populate: [
      { path: "listing", select: "title listingNumber propertyType" },
      { path: "buyer",   select: "fullName buyerNumber phone email" },
    ],
  });

const sanitizePaymentBody = (body) => {
  const out = { ...body };
  if ("amount" in out)      out.amount      = out.amount      !== "" && out.amount      != null ? Number(out.amount)      : 0;
  if ("paymentDate" in out) out.paymentDate = out.paymentDate || null;
  return out;
};

// Resolve a cashbook ChartOfAccount from an _id sent by the frontend
const resolveCashbook = async (businessId, cashbookId) => {
  if (!cashbookId || !mongoose.isValidObjectId(String(cashbookId))) return null;
  return ChartOfAccount.findOne({
    _id: cashbookId,
    business: businessId,
    isPosting: { $ne: false },
    isHeader:  { $ne: true },
  }).lean();
};

export const listPayments = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const bId = new mongoose.Types.ObjectId(String(business));
    const { deal = "", buyer = "", paymentType = "", paymentMethod = "", status = "", search = "", dateFrom = "", dateTo = "" } = req.query;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const skip  = (page - 1) * limit;

    const filter = { business };
    if (deal)          filter.deal          = new mongoose.Types.ObjectId(String(deal));
    if (buyer)         filter.buyer         = new mongoose.Types.ObjectId(String(buyer));
    if (paymentType)   filter.paymentType   = paymentType;
    if (paymentMethod) filter.paymentMethod = paymentMethod;
    if (status)        filter.status        = status;
    if (search)        filter.paymentNumber = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    if (dateFrom || dateTo) {
      filter.paymentDate = {};
      if (dateFrom) filter.paymentDate.$gte = new Date(dateFrom);
      if (dateTo)   filter.paymentDate.$lte = new Date(dateTo + "T23:59:59.999Z");
    }

    const collectedMatch = { business: bId, status: "paid" };
    if (deal) collectedMatch.deal = new mongoose.Types.ObjectId(String(deal));

    const [payments, total, [agg]] = await Promise.all([
      populatePayment(SalePayment.find(filter).sort({ paymentDate: -1 }).skip(skip).limit(limit)).lean(),
      SalePayment.countDocuments(filter),
      SalePayment.aggregate([
        { $match: collectedMatch },
        { $group: { _id: null, totalCollected: { $sum: "$amount" } } },
      ]),
    ]);

    res.status(200).json({ data: payments, total, totalCollected: agg?.totalCollected || 0, page, pages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    next(err);
  }
};

export const getPayment = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const payment = await populatePayment(SalePayment.findOne({ _id: req.params.id, business })).lean();
    if (!payment) return next(createError(404, "Payment not found"));
    res.status(200).json(payment);
  } catch (err) {
    next(err);
  }
};

export const createPayment = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);

    const deal = await SaleDeal.findOne({ _id: req.body.deal, business }).lean();
    if (!deal) return next(createError(400, "Deal not found"));
    if (deal.status !== "active") return next(createError(400, "Payments can only be recorded for active deals"));

    // Resolve cashbook in parallel with the deal's paid-to-date total — independent lookups
    const [totalPaidResult, cashbookAcc] = await Promise.all([
      SalePayment.aggregate([
        { $match: { business: new mongoose.Types.ObjectId(String(business)), deal: deal._id, status: "paid" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      resolveCashbook(business, req.body.cashbook),
    ]);
    const totalPaid  = totalPaidResult[0]?.total || 0;
    const remaining  = deal.agreedPrice - totalPaid;
    if (Number(req.body.amount) > remaining + 0.01) {
      return next(createError(400, `Payment of ${Number(req.body.amount).toLocaleString()} exceeds remaining balance of ${remaining.toLocaleString("en-KE", { minimumFractionDigits: 2 })}`));
    }

    if (req.body.cashbook && !cashbookAcc) {
      return next(createError(400, "Selected cashbook account not found"));
    }

    const paymentNumber = await generateSequentialNumber(SalePayment, business, "PMT");
    const payment = await SalePayment.create({
      ...sanitizePaymentBody(req.body),
      business,
      paymentNumber,
      cashbook: cashbookAcc?._id || null,
      listing:  deal.listing,
      buyer:    deal.buyer,
      status:   "paid",
      createdBy: userId,
      updatedBy: userId,
    });

    try {
      await postPropertySalePaymentLedger({
        businessId: business,
        payment,
        userId,
        cashbookAccountId: cashbookAcc?._id || null,
      });
    } catch (glErr) {
      // GL failed — delete the payment so DB and ledger stay in sync
      await SalePayment.deleteOne({ _id: payment._id });
      return next(createError(422, `Payment saved but GL posting failed: ${glErr.message}. Payment has been rolled back.`));
    }

    const populated = await populatePayment(SalePayment.findById(payment._id)).lean();
    res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
};

export const updatePayment = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);

    const old = await SalePayment.findOne({ _id: req.params.id, business }).lean();
    if (!old) return next(createError(404, "Payment not found"));
    if (old.status === "cancelled") return next(createError(400, "Cannot edit a voided payment"));

    const {
      business: _b, paymentNumber: _n, createdBy: _c,
      deal: _d, listing: _l, buyer: _by, status: _s,
      ...rawUpdates
    } = req.body;
    const updates = sanitizePaymentBody(rawUpdates);

    // Resolve new cashbook if changed
    const newCashbookId = updates.cashbook !== undefined ? updates.cashbook : String(old.cashbook || "");
    const cashbookAcc   = await resolveCashbook(business, newCashbookId);
    if (newCashbookId && !cashbookAcc) return next(createError(400, "Selected cashbook account not found"));
    updates.cashbook = cashbookAcc?._id || null;

    const amountChanged = updates.amount    !== undefined && Number(updates.amount)   !== Number(old.amount);
    const dateChanged   = updates.paymentDate !== undefined && new Date(updates.paymentDate).toDateString() !== new Date(old.paymentDate).toDateString();
    const cashbookChanged = String(updates.cashbook || "") !== String(old.cashbook || "");
    const glCorrectionNeeded = amountChanged || dateChanged || cashbookChanged;

    if (glCorrectionNeeded) {
      // Reverse old GL entries first
      try {
        await reversePropertySalePaymentLedger({ businessId: business, payment: old, userId });
      } catch (glErr) {
        return next(createError(422, `GL reversal failed: ${glErr.message}. Payment not updated.`));
      }
    }

    const payment = await populatePayment(
      SalePayment.findOneAndUpdate(
        { _id: req.params.id, business },
        { ...updates, updatedBy: userId },
        { new: true, runValidators: true }
      )
    ).lean();
    if (!payment) return next(createError(404, "Payment not found"));

    if (glCorrectionNeeded) {
      try {
        await postPropertySalePaymentLedger({
          businessId: business,
          payment,
          userId,
          cashbookAccountId: cashbookAcc?._id || null,
        });
      } catch (glErr) {
        // Re-post of new GL failed — restore old GL so ledger isn't left empty
        await postPropertySalePaymentLedger({
          businessId: business,
          payment: old,
          userId,
          cashbookAccountId: old.cashbook || null,
        }).catch(() => {});
        return next(createError(422, `GL re-posting failed: ${glErr.message}. Old GL has been restored.`));
      }
    }

    res.status(200).json(payment);
  } catch (err) {
    next(err);
  }
};

export const voidPayment = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);

    const payment = await SalePayment.findOne({ _id: req.params.id, business });
    if (!payment) return next(createError(404, "Payment not found"));
    if (payment.status === "cancelled") return next(createError(400, "Payment is already cancelled/voided"));

    payment.status    = "cancelled";
    payment.updatedBy = userId;
    await payment.save();

    try {
      await reversePropertySalePaymentLedger({ businessId: business, payment, userId });
    } catch (glErr) {
      // GL reversal failed — restore payment status so records are consistent
      payment.status = "paid";
      await payment.save();
      return next(createError(422, `GL reversal failed: ${glErr.message}. Payment void has been rolled back.`));
    }

    const populated = await populatePayment(SalePayment.findById(payment._id)).lean();
    res.status(200).json(populated);
  } catch (err) {
    next(err);
  }
};

export const deletePayment = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const payment  = await SalePayment.findOne({ _id: req.params.id, business });
    if (!payment) return next(createError(404, "Payment not found"));
    if (payment.status === "paid") return next(createError(400, "Cannot delete a confirmed payment — void it first to reverse it"));
    await payment.deleteOne();
    res.status(200).json({ message: "Payment deleted" });
  } catch (err) {
    next(err);
  }
};
