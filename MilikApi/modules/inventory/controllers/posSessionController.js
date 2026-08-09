import mongoose from "mongoose";
import POSSession from "../models/POSSession.js";
import POSSale from "../models/POSSale.js";
import POSTillMovement from "../models/POSTillMovement.js";
import InvTill from "../models/InvTill.js";
import { createError } from "../../../utils/error.js";
import {
  resolveActiveBusinessId,
  currentUserId,
} from "../services/inventoryScope.js";
import { nextSequenceNumber } from "../services/sequenceService.js";

export const listSessions = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };

    if (req.query.status) filter.status = String(req.query.status).trim();
    if (req.query.location && mongoose.Types.ObjectId.isValid(String(req.query.location))) {
      filter.location = String(req.query.location);
    }
    if (req.query.till && mongoose.Types.ObjectId.isValid(String(req.query.till))) {
      filter.till = String(req.query.till);
    }
    if (req.query.openedBy && mongoose.Types.ObjectId.isValid(String(req.query.openedBy))) {
      filter.openedBy = String(req.query.openedBy);
    }
    if (req.query.from || req.query.to) {
      filter.openedAt = {};
      if (req.query.from) filter.openedAt.$gte = new Date(req.query.from);
      if (req.query.to)   filter.openedAt.$lte = new Date(req.query.to);
    }

    const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 100);
    const page  = Math.max(Number(req.query.page || 1), 1);
    const skip  = (page - 1) * limit;

    const [sessions, total] = await Promise.all([
      POSSession.find(filter)
        .populate("till",      "name")
        .populate("location",  "name type")
        .populate("openedBy",  "name username")
        .populate("closedBy",  "name username")
        .sort({ openedAt: -1 })
        .skip(skip).limit(limit).lean(),
      POSSession.countDocuments(filter),
    ]);

    res.json({ success: true, data: sessions, total, page, pages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
};

export const getSession = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const session  = await POSSession.findOne({ _id: req.params.id, business })
      .populate("till",     "name")
      .populate("location", "name type")
      .populate("openedBy", "name username")
      .populate("closedBy", "name username")
      .lean();
    if (!session) throw createError(404, "Session not found");
    res.json({ success: true, data: session });
  } catch (err) { next(err); }
};

export const getActiveSession = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { location, till } = req.query;

    const filter = { business, status: "open" };

    if (till && mongoose.Types.ObjectId.isValid(String(till))) {
      filter.till = String(till);
    } else if (location && mongoose.Types.ObjectId.isValid(String(location))) {
      filter.location = String(location);
    } else {
      throw createError(400, "Valid till or location is required");
    }

    const session = await POSSession.findOne(filter)
      .populate("till",     "name")
      .populate("location", "name type")
      .populate("openedBy", "name username")
      .lean();

    res.json({ success: true, data: session || null });
  } catch (err) { next(err); }
};

export const openSession = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const { till: tillId, openingFloat, notes } = req.body;

    if (!userId && !req.user?.isSystemAdmin) {
      throw createError(401, "User identity could not be determined. Please log in again.");
    }

    if (!tillId || !mongoose.Types.ObjectId.isValid(String(tillId))) {
      throw createError(400, "Valid till is required");
    }

    const float = Number(openingFloat || 0);
    if (float < 0) throw createError(400, "Opening float cannot be negative");

    const till = await InvTill.findOne({ _id: String(tillId), business, isActive: true }).lean();
    if (!till) throw createError(404, "Till not found or inactive");

    const existing = await POSSession.findOne({ business, till: till._id, status: "open" }).lean();
    if (existing) throw createError(409, "There is already an open session for this till");

    const sessionNumber = await nextSequenceNumber(business, "pos_session", "SES");

    const session = await POSSession.create({
      business,
      till:          till._id,
      location:      till.location,
      sessionNumber,
      openingFloat:  float,
      openedBy:      userId,
      openedAt:      new Date(),
      notes:         notes ? String(notes).trim() : "",
    });

    await POSTillMovement.create({
      business,
      session:   session._id,
      till:      till._id,
      location:  till.location,
      type:      "opening_float",
      amount:    float,
      reason:    "Session opened",
      createdBy: userId,
    });

    const populated = await POSSession.findById(session._id)
      .populate("till", "name")
      .populate("location", "name type")
      .populate("openedBy", "name username")
      .lean();

    res.status(201).json({ success: true, data: populated });
  } catch (err) { next(err); }
};

export const closeSession = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);

    const session = await POSSession.findOne({ _id: req.params.id, business });
    if (!session)              throw createError(404, "Session not found");
    if (session.status !== "open") throw createError(400, "Session is already closed");

    // Single aggregation pass + movements fetch in parallel
    const [[facet], movements] = await Promise.all([
      POSSale.aggregate([
        { $match: { business: session.business, session: session._id } },
        {
          $facet: {
            payments: [
              { $match: { status: "completed" } },
              { $unwind: "$payments" },
              { $group: { _id: "$payments.method", total: { $sum: "$payments.amount" } } },
            ],
            sales: [
              { $match: { status: "completed" } },
              { $group: { _id: null, totalSales: { $sum: "$grandTotal" }, salesCount: { $sum: 1 } } },
            ],
            voids: [
              { $match: { status: "voided" } },
              { $count: "count" },
            ],
          },
        },
      ]),
      POSTillMovement.find({ business, session: session._id }).lean(),
    ]);

    const paymentMap = Object.fromEntries((facet.payments ?? []).map((r) => [r._id, r.total]));
    const salesAgg   = facet.sales?.[0];
    const voidAgg    = facet.voids?.[0];

    const totalCash   = paymentMap["cash"]   ?? 0;
    const totalMpesa  = paymentMap["mpesa"]  ?? 0;
    const totalCard   = paymentMap["card"]   ?? 0;
    const totalCredit = paymentMap["credit"] ?? 0;

    const totalCashIn  = movements.filter((m) => m.type === "cash_in").reduce((s, m) => s + m.amount, 0);
    const totalCashOut = movements.filter((m) => m.type === "cash_out").reduce((s, m) => s + m.amount, 0);

    const closingFloat = Number(req.body.closingFloat ?? 0);
    const expectedCash = session.openingFloat + totalCash + totalCashIn - totalCashOut;
    const cashVariance = closingFloat - expectedCash;

    session.totalSales  = salesAgg?.totalSales  ?? 0;
    session.salesCount  = salesAgg?.salesCount  ?? 0;
    session.totalVoids  = voidAgg?.count        ?? 0;
    session.totalCash   = totalCash;
    session.totalMpesa  = totalMpesa;
    session.totalCard   = totalCard;
    session.totalCredit = totalCredit;
    session.totalCashIn = totalCashIn;
    session.totalCashOut= totalCashOut;
    session.closingFloat= closingFloat;
    session.expectedCash= expectedCash;
    session.cashVariance= cashVariance;
    session.status      = "closed";
    session.closedBy    = userId;
    session.closedAt    = new Date();
    if (req.body.notes) session.notes = String(req.body.notes).trim();

    await session.save();

    if (session.till) {
      await POSTillMovement.create({
        business,
        session:   session._id,
        till:      session.till,
        location:  session.location,
        type:      "closing_float",
        amount:    closingFloat,
        reason:    cashVariance === 0 ? "Session closed — balanced" :
                   cashVariance < 0  ? `Session closed — shortage of ${Math.abs(cashVariance).toFixed(2)}` :
                                       `Session closed — overage of ${cashVariance.toFixed(2)}`,
        createdBy: userId,
      });
    }

    const populated = await POSSession.findById(session._id)
      .populate("till",     "name")
      .populate("location", "name type")
      .populate("openedBy", "name username")
      .populate("closedBy", "name username")
      .lean();

    res.json({ success: true, data: populated });
  } catch (err) { next(err); }
};
