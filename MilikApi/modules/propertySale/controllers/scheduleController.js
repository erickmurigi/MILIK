import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import SalePaymentSchedule from "../models/SalePaymentSchedule.js";
import SaleDeal from "../models/SaleDeal.js";
import SalePayment from "../models/SalePayment.js";
import { currentUserId, resolveActiveBusinessId } from "../services/businessScope.js";
import { sendAdHocSms, sendAdHocEmail } from "../../../services/communicationService.js";

const recomputeStatuses = async (business, dealId) => {
  const now   = new Date();
  const items = await SalePaymentSchedule.find({ business, deal: dealId }).select("_id status dueDate").lean();
  const ops   = items.map((item) => {
    if (item.status === "paid" || item.status === "waived") return null;
    const newStatus = item.dueDate < now ? "overdue" : "upcoming";
    if (newStatus === item.status) return null;
    return { updateOne: { filter: { _id: item._id }, update: { $set: { status: newStatus } } } };
  }).filter(Boolean);
  if (ops.length) await SalePaymentSchedule.bulkWrite(ops);
};

export const listSchedule = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { dealId } = req.query;
    if (!dealId) return next(createError(400, "dealId is required"));

    await recomputeStatuses(business, dealId);

    const items = await SalePaymentSchedule.find({ business, deal: dealId })
      .populate("linkedPayment", "paymentNumber amount paymentDate status")
      .sort({ installmentNumber: 1 })
      .lean();

    res.status(200).json({ data: items, total: items.length });
  } catch (err) { next(err); }
};

export const setSchedule = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const { dealId, items } = req.body;

    if (!dealId) return next(createError(400, "dealId is required"));
    if (!Array.isArray(items) || items.length === 0) return next(createError(400, "items must be a non-empty array"));

    const deal = await SaleDeal.findOne({ _id: dealId, business }).lean();
    if (!deal) return next(createError(404, "Deal not found"));
    if (deal.status !== "active") return next(createError(400, "Can only set schedule on an active deal"));

    const totalScheduled = items.reduce((s, i) => s + Number(i.expectedAmount || 0), 0);
    if (Math.abs(totalScheduled - deal.agreedPrice) > 1) {
      return next(createError(400, `Schedule total (${totalScheduled.toLocaleString()}) must equal agreed price (${deal.agreedPrice.toLocaleString()})`));
    }

    const now = new Date();
    const docs = items.map((item, idx) => ({
      business,
      deal:              dealId,
      installmentNumber: idx + 1,
      dueDate:           new Date(item.dueDate),
      expectedAmount:    Number(item.expectedAmount),
      description:       item.description || `Installment ${idx + 1}`,
      status:            new Date(item.dueDate) < now ? "overdue" : "upcoming",
      linkedPayment:     null,
      createdBy:         userId,
      updatedBy:         userId,
    }));

    // Replace all existing schedule items for this deal
    await SalePaymentSchedule.deleteMany({ business, deal: dealId, status: { $nin: ["paid", "waived"] } });
    const created = await SalePaymentSchedule.insertMany(docs);

    res.status(200).json({ data: created, total: created.length });
  } catch (err) { next(err); }
};

export const updateScheduleItem = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const { dueDate, expectedAmount, description, status } = req.body;

    const item = await SalePaymentSchedule.findOne({ _id: req.params.id, business });
    if (!item) return next(createError(404, "Schedule item not found"));
    if (item.status === "paid") return next(createError(400, "Cannot edit a paid installment"));

    if (dueDate)          item.dueDate         = new Date(dueDate);
    if (expectedAmount != null) item.expectedAmount = Number(expectedAmount);
    if (description != null)    item.description    = description;
    if (status && ["upcoming", "overdue", "waived"].includes(status)) item.status = status;
    item.updatedBy = userId;

    await item.save();
    res.status(200).json(item);
  } catch (err) { next(err); }
};

export const linkPaymentToSchedule = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const { paymentId } = req.body;

    const item    = await SalePaymentSchedule.findOne({ _id: req.params.id, business });
    if (!item)    return next(createError(404, "Schedule item not found"));
    if (item.status === "paid") return next(createError(400, "Already marked as paid"));

    const payment = await SalePayment.findOne({ _id: paymentId, business, deal: item.deal, status: "paid" }).lean();
    if (!payment) return next(createError(404, "Payment not found or not confirmed"));

    item.linkedPayment = payment._id;
    item.status        = "paid";
    item.updatedBy     = userId;
    await item.save();

    const populated = await SalePaymentSchedule.findById(item._id).populate("linkedPayment", "paymentNumber amount paymentDate status").lean();
    res.status(200).json(populated);
  } catch (err) { next(err); }
};

export const deleteScheduleItem = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const item     = await SalePaymentSchedule.findOne({ _id: req.params.id, business });
    if (!item)     return next(createError(404, "Schedule item not found"));
    if (item.status === "paid") return next(createError(400, "Cannot delete a paid installment — waive it instead"));
    await item.deleteOne();
    res.status(200).json({ message: "Deleted" });
  } catch (err) { next(err); }
};

export const listAllSchedule = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { status, dealId, dateFrom, dateTo, page = 1, limit = 100 } = req.query;

    const filter = { business };
    if (status)  filter.status = status;
    if (dealId)  filter.deal   = dealId;
    if (dateFrom || dateTo) {
      filter.dueDate = {};
      if (dateFrom) filter.dueDate.$gte = new Date(dateFrom);
      if (dateTo)   filter.dueDate.$lte = new Date(dateTo);
    }

    const skip  = (Number(page) - 1) * Number(limit);
    const total = await SalePaymentSchedule.countDocuments(filter);
    const items = await SalePaymentSchedule.find(filter)
      .populate({
        path: "deal",
        select: "dealNumber agreedPrice status",
        populate: [
          { path: "listing", select: "title listingNumber" },
          { path: "buyer",   select: "fullName phone" },
        ],
      })
      .populate("linkedPayment", "paymentNumber amount paymentDate")
      .sort({ dueDate: 1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();

    res.status(200).json({ data: items, total, page: Number(page), limit: Number(limit) });
  } catch (err) { next(err); }
};

export const getOverdueSchedule = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const items = await SalePaymentSchedule.find({ business, status: "overdue" })
      .populate("deal", "dealNumber agreedPrice status")
      .sort({ dueDate: 1 })
      .limit(200)
      .lean();
    res.status(200).json({ data: items, total: items.length });
  } catch (err) { next(err); }
};

export const sendReminders = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { itemIds = [], channel = "sms", customMessage = "" } = req.body;
    if (!itemIds.length) return next(createError(400, "No schedule item IDs provided"));
    if (!["sms", "email", "both"].includes(channel)) return next(createError(400, "channel must be sms, email, or both"));

    const items = await SalePaymentSchedule.find({
      business, _id: { $in: itemIds },
      status: { $in: ["overdue", "upcoming"] },
    })
      .populate({
        path: "deal",
        select: "dealNumber agreedPrice",
        populate: [
          { path: "listing", select: "title" },
          { path: "buyer",   select: "fullName phone email" },
        ],
      })
      .lean();

    let sent = 0, failed = 0;
    const errors = [];

    const fmtKES = (n) => `KES ${Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const fmtDate = (d) => new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });

    await Promise.all(items.map(async (item) => {
      const buyer    = item.deal?.buyer;
      const dealNo   = item.deal?.dealNumber || "—";
      const property = item.deal?.listing?.title || "property";
      const amount   = fmtKES(item.expectedAmount);
      const due      = fmtDate(item.dueDate);
      const label    = item.description || `Installment ${item.installmentNumber}`;

      const message = customMessage ||
        `Dear ${buyer?.fullName || "Client"}, your payment of ${amount} for ${property} (Deal ${dealNo} — ${label}) was due on ${due}. Please contact us to arrange payment. Thank you.`;

      try {
        if ((channel === "sms" || channel === "both") && buyer?.phone) {
          await sendAdHocSms({ businessId: business, phone: buyer.phone, body: message, templateKey: "sale_reminder" });
        }
        if ((channel === "email" || channel === "both") && buyer?.email) {
          await sendAdHocEmail({
            businessId: business, to: buyer.email,
            subject: `Payment Reminder — ${dealNo}`,
            bodyText: message,
          });
        }
        sent++;
      } catch (e) {
        failed++;
        errors.push({ itemId: item._id, error: e?.message });
      }
    }));

    res.status(200).json({ sent, failed, total: items.length, errors });
  } catch (err) {
    next(err);
  }
};
