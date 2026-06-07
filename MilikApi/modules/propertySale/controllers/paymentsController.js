import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import SalePayment from "../models/SalePayment.js";
import SaleDeal from "../models/SaleDeal.js";
import { currentUserId, generateSequentialNumber, resolveActiveBusinessId } from "../services/businessScope.js";
import { postPropertySalePaymentLedger, reversePropertySalePaymentLedger } from "../services/propertySaleAccountingService.js";

// Deep-populate: deal includes nested listing + buyer so receipt/table fields work
const populatePayment = (query) =>
  query.populate({
    path: "deal",
    select: "dealNumber agreedPrice status",
    populate: [
      { path: "listing", select: "title listingNumber propertyType" },
      { path: "buyer", select: "fullName buyerNumber phone email" },
    ],
  });

export const listPayments = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const bId = new mongoose.Types.ObjectId(String(business));
    const { deal = "", paymentType = "", paymentMethod = "", status = "", search = "" } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const skip = (page - 1) * limit;

    const filter = { business };
    if (deal) filter.deal = new mongoose.Types.ObjectId(String(deal));
    if (paymentType) filter.paymentType = paymentType;
    if (paymentMethod) filter.paymentMethod = paymentMethod;
    if (status) filter.status = status;
    if (search) filter.paymentNumber = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };

    // totalCollected is the business-wide (or deal-scoped) sum of paid payments
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

    res.status(200).json({ payments, total, totalCollected: agg?.totalCollected || 0, page, limit });
  } catch (err) {
    next(err);
  }
};

export const createPayment = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);

    const deal = await SaleDeal.findOne({ _id: req.body.deal, business }).lean();
    if (!deal) return next(createError(400, "Deal not found"));
    if (deal.status !== "active") return next(createError(400, "Payments can only be recorded for active deals"));

    const totalPaidResult = await SalePayment.aggregate([
      { $match: { business: new mongoose.Types.ObjectId(String(business)), deal: deal._id, status: "paid" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const totalPaid = totalPaidResult[0]?.total || 0;
    const remaining = deal.agreedPrice - totalPaid;
    if (Number(req.body.amount) > remaining + 0.01) {
      return next(createError(400, `Payment of ${Number(req.body.amount).toLocaleString()} exceeds remaining balance of ${remaining.toLocaleString("en-KE", { minimumFractionDigits: 2 })}`));
    }

    const paymentNumber = await generateSequentialNumber(SalePayment, business, "PMT");
    const payment = await SalePayment.create({
      ...req.body,
      business,
      paymentNumber,
      listing: deal.listing,
      buyer: deal.buyer,
      status: "paid",
      createdBy: userId,
      updatedBy: userId,
    });
    postPropertySalePaymentLedger({ businessId: business, payment, userId }).catch((err) =>
      console.error("[PS GL] postPropertySalePaymentLedger failed:", err.message)
    );

    const populated = await populatePayment(SalePayment.findById(payment._id));
    res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
};

export const updatePayment = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const { business: _b, paymentNumber: _n, createdBy: _c, deal: _d, listing: _l, buyer: _by, ...updates } = req.body;
    const payment = await populatePayment(
      SalePayment.findOneAndUpdate(
        { _id: req.params.id, business },
        { ...updates, updatedBy: userId },
        { new: true, runValidators: true }
      )
    );
    if (!payment) return next(createError(404, "Payment not found"));
    res.status(200).json(payment);
  } catch (err) {
    next(err);
  }
};

export const voidPayment = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const payment = await SalePayment.findOne({ _id: req.params.id, business });
    if (!payment) return next(createError(404, "Payment not found"));
    if (payment.status === "cancelled") return next(createError(400, "Payment is already cancelled/voided"));
    payment.status = "cancelled";
    payment.updatedBy = currentUserId(req);
    await payment.save();

    reversePropertySalePaymentLedger({ businessId: business, payment, userId: currentUserId(req) }).catch((err) =>
      console.error("[PS GL] reversePropertySalePaymentLedger failed:", err.message)
    );

    const populated = await populatePayment(SalePayment.findById(payment._id));
    res.status(200).json(populated);
  } catch (err) {
    next(err);
  }
};

export const deletePayment = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const payment = await SalePayment.findOne({ _id: req.params.id, business });
    if (!payment) return next(createError(404, "Payment not found"));
    if (payment.status === "paid") return next(createError(400, "Cannot delete a confirmed payment — void it first to reverse it"));
    await payment.deleteOne();
    res.status(200).json({ message: "Payment deleted" });
  } catch (err) {
    next(err);
  }
};
