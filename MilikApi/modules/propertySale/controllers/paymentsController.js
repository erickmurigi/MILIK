import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import SalePayment from "../models/SalePayment.js";
import SaleDeal from "../models/SaleDeal.js";
import { round2 } from "../../../utils/math.js";
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

const OVERPAY_TOLERANCE = 0.01;
const LOCKED_DEAL_STATUSES = ["closed", "cancelled"];

// Sum of a deal's confirmed ("paid") payments, optionally excluding one payment
const sumPaidForDeal = async (business, dealId, excludePaymentId = null) => {
  const match = { business: new mongoose.Types.ObjectId(String(business)), deal: dealId, status: "paid" };
  if (excludePaymentId) match._id = { $ne: excludePaymentId };
  const [agg] = await SalePayment.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  return agg?.total || 0;
};

const overpaymentError = (amount, remaining) =>
  createError(400, `Payment of ${Number(amount).toLocaleString()} exceeds remaining balance of ${remaining.toLocaleString("en-KE", { minimumFractionDigits: 2 })}`);

// Payments on a closed/cancelled deal cannot be voided or edited: closing/cancelling posts separate
// deposit-transfer / forfeit GL entries that payment-level reversal does not touch.
const lockedDealError = (dealStatus, action) =>
  LOCKED_DEAL_STATUSES.includes(dealStatus)
    ? createError(409, `Cannot ${action} a payment on a ${dealStatus} deal. Reverse or reopen the deal through the deal workflow first.`)
    : null;

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
    const [totalPaid, cashbookAcc] = await Promise.all([
      sumPaidForDeal(business, deal._id),
      resolveCashbook(business, req.body.cashbook),
    ]);
    const remaining  = round2(deal.agreedPrice - totalPaid);
    if (Number(req.body.amount) > remaining + OVERPAY_TOLERANCE) {
      return next(overpaymentError(req.body.amount, remaining));
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

    // The check above is read-then-write, so two concurrent submits can both pass it. Re-check after the
    // insert (before any GL posting): if the deal is now overpaid, remove this payment and reject.
    // Worst case under a true race is that both requests are rejected; never that both are kept.
    const totalAfter = await sumPaidForDeal(business, deal._id);
    if (round2(totalAfter) > round2(deal.agreedPrice) + OVERPAY_TOLERANCE) {
      await SalePayment.deleteOne({ _id: payment._id });
      return next(overpaymentError(payment.amount, round2(deal.agreedPrice - (totalAfter - payment.amount))));
    }

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

    const dealForUpdate = await SaleDeal.findOne({ _id: old.deal, business }).select("status agreedPrice").lean();

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

    // Only edits that rewrite GL (amount/date/cashbook) are unsafe on a closed/cancelled deal;
    // descriptive fields (reference, notes) stay editable.
    const updateLockErr = glCorrectionNeeded && dealForUpdate && lockedDealError(dealForUpdate.status, "edit");
    if (updateLockErr) return next(updateLockErr);

    // Amount edits must keep the deal's total paid within the agreed price (same rule as createPayment)
    if (amountChanged && dealForUpdate && old.status === "paid") {
      const otherPaid = await sumPaidForDeal(business, old.deal, old._id);
      const remaining = round2(dealForUpdate.agreedPrice - otherPaid);
      if (Number(updates.amount) > remaining + OVERPAY_TOLERANCE) {
        return next(overpaymentError(updates.amount, remaining));
      }
    }

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

    // Closing/cancelling a deal posts separate deposit-transfer/forfeit entries that this void would not reverse
    const voidDeal = await SaleDeal.findOne({ _id: payment.deal, business }).select("status").lean();
    const voidLockErr = voidDeal && lockedDealError(voidDeal.status, "void");
    if (voidLockErr) return next(voidLockErr);

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
