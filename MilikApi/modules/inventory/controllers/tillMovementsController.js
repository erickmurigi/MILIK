import mongoose from "mongoose";
import POSTillMovement from "../models/POSTillMovement.js";
import POSSession from "../models/POSSession.js";
import { createError } from "../../../utils/error.js";
import { resolveActiveBusinessId, currentUserId } from "../services/inventoryScope.js";

export const listMovements = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter   = { business };

    if (req.query.session && mongoose.Types.ObjectId.isValid(String(req.query.session))) {
      filter.session = String(req.query.session);
    }
    if (req.query.till && mongoose.Types.ObjectId.isValid(String(req.query.till))) {
      filter.till = String(req.query.till);
    }
    if (req.query.type) filter.type = String(req.query.type);

    const movements = await POSTillMovement.find(filter)
      .populate("till", "name")
      .populate("createdBy", "name username")
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, data: movements, total: movements.length });
  } catch (err) { next(err); }
};

const _postMovement = async (req, res, next, type) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const session  = await POSSession.findOne({ _id: req.params.id, business });
    if (!session)             throw createError(404, "Session not found");
    if (session.status !== "open") throw createError(400, "Session is already closed");
    if (!session.till)        throw createError(400, "Session has no associated till");

    const amount = Number(req.body.amount);
    if (!amount || amount <= 0) throw createError(400, "Amount must be greater than zero");

    const movement = await POSTillMovement.create({
      business,
      session:  session._id,
      till:     session.till,
      location: session.location,
      type,
      amount,
      reason:    req.body.reason ? String(req.body.reason).trim() : "",
      reference: req.body.reference ? String(req.body.reference).trim() : "",
      createdBy: userId,
    });

    const field = type === "cash_in" ? "totalCashIn" : "totalCashOut";
    await POSSession.updateOne({ _id: session._id }, { $inc: { [field]: amount } });

    res.status(201).json({ success: true, data: movement });
  } catch (err) { next(err); }
};

export const cashIn  = (req, res, next) => _postMovement(req, res, next, "cash_in");
export const cashOut = (req, res, next) => _postMovement(req, res, next, "cash_out");

export const getXRead = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const session  = await POSSession.findOne({ _id: req.params.id, business })
      .populate("till", "name")
      .populate("location", "name")
      .populate("openedBy", "name username")
      .lean();
    if (!session) throw createError(404, "Session not found");

    const movements = await POSTillMovement.find({ business, session: session._id })
      .populate("createdBy", "name username")
      .sort({ createdAt: 1 })
      .lean();

    const cashIn  = movements.filter(m => m.type === "cash_in").reduce((s, m) => s + m.amount, 0);
    const cashOut = movements.filter(m => m.type === "cash_out").reduce((s, m) => s + m.amount, 0);
    const expectedCash = session.openingFloat + session.totalCash + cashIn - cashOut;

    res.json({
      success: true,
      data: {
        session,
        movements,
        summary: {
          openingFloat:  session.openingFloat,
          cashSales:     session.totalCash,
          totalCashIn:   cashIn,
          totalCashOut:  cashOut,
          expectedCash,
          mpesaSales:    session.totalMpesa,
          cardSales:     session.totalCard,
          totalSales:    session.totalSales,
          salesCount:    session.salesCount,
          voidCount:     session.totalVoids,
        },
      },
    });
  } catch (err) { next(err); }
};
