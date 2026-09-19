import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import SaleActivity from "../models/SaleActivity.js";
import SaleLead     from "../models/SaleLead.js";
import SaleBuyer    from "../models/SaleBuyer.js";
import SaleDeal     from "../models/SaleDeal.js";
import SaleListing  from "../models/SaleListing.js";
import { currentUserId, generateSequentialNumber, resolveActiveBusinessId } from "../services/businessScope.js";

export const listActivities = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const {
      relatedLead = "", relatedBuyer = "", relatedDeal = "",
      type = "", outcome = "", from = "", to = "", search = "",
      page = 1, limit = 50,
    } = req.query;

    const pageNum  = Math.max(parseInt(page,  10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

    const filter = { business };
    if (relatedLead)  filter.relatedLead  = relatedLead;
    if (relatedBuyer) filter.relatedBuyer = relatedBuyer;
    if (relatedDeal)  filter.relatedDeal  = relatedDeal;
    if (type)    filter.type    = type;
    if (outcome) filter.outcome = outcome;
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = new Date(from);
      if (to)   filter.date.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    }
    if (search.trim()) {
      const re = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ subject: re }, { notes: re }];
    }

    const [activities, total] = await Promise.all([
      SaleActivity.find(filter)
        .populate("relatedLead",    "leadNumber fullName")
        .populate("relatedBuyer",   "buyerNumber fullName")
        .populate("relatedDeal",    "dealNumber")
        .populate("relatedListing", "listingNumber title")
        .populate("createdBy",      "name fullName")
        .sort({ date: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      SaleActivity.countDocuments(filter),
    ]);

    res.status(200).json({ data: activities, total, page: pageNum, pages: Math.ceil(total / limitNum) || 1 });
  } catch (err) { next(err); }
};

const nullifyEmptyRefs = (body) => {
  const out = { ...body };
  for (const key of ["relatedLead", "relatedBuyer", "relatedDeal", "relatedListing", "date", "nextActionDate"]) {
    if (out[key] === "" || out[key] === null) out[key] = null;
  }
  if ("durationMinutes" in out) {
    out.durationMinutes = out.durationMinutes !== "" && out.durationMinutes != null ? Number(out.durationMinutes) || null : null;
  }
  return out;
};

const RELATED_MODELS = {
  relatedLead:    { Model: SaleLead,    label: "lead" },
  relatedBuyer:   { Model: SaleBuyer,   label: "buyer" },
  relatedDeal:    { Model: SaleDeal,    label: "deal" },
  relatedListing: { Model: SaleListing, label: "listing" },
};

// Verifies every non-empty related* id is a valid ObjectId AND belongs to the
// active business, so an activity can never link to (or later populate data
// from) another tenant's records. Returns an error or null.
const validateRelatedRefs = async (body, business) => {
  const checks = [];
  for (const [key, { Model, label }] of Object.entries(RELATED_MODELS)) {
    const value = body[key];
    if (value === undefined || value === null || value === "") continue;
    const id = typeof value === "string" ? value : null;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return createError(400, `Invalid ${label} id`);
    }
    checks.push(Model.exists({ _id: id, business }).then((found) => (found ? null : label)));
  }
  const missing = (await Promise.all(checks)).find(Boolean);
  return missing ? createError(404, `Related ${missing} not found`) : null;
};

// Non-ObjectId (system-admin) sessions can't populate createdBy/updatedBy, so
// keep a human-readable actor label instead. Empty when an ObjectId is stored.
const actorLabel = (req, userId) =>
  userId ? "" : String(req.user?.email || req.user?.id || "").trim();

export const createActivity = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const body     = nullifyEmptyRefs(req.body);

    const refError = await validateRelatedRefs(body, business);
    if (refError) return next(refError);

    const label = actorLabel(req, userId);
    const activityNumber = await generateSequentialNumber(SaleActivity, business, "ACT");

    const activity = await SaleActivity.create({
      ...body,
      business,
      activityNumber,
      createdBy: userId,
      updatedBy: userId,
      createdByLabel: label,
      updatedByLabel: label,
    });

    // Sync lastContactDate + nextFollowUpDate to lead
    if (activity.relatedLead) {
      const leadUpdate = { lastContactDate: activity.date, updatedBy: userId };
      if (activity.nextActionDate) leadUpdate.nextFollowUpDate = activity.nextActionDate;
      await SaleLead.findOneAndUpdate({ _id: activity.relatedLead, business }, leadUpdate);
    }

    const populated = await SaleActivity.findById(activity._id)
      .populate("relatedLead",    "leadNumber fullName")
      .populate("relatedBuyer",   "buyerNumber fullName")
      .populate("relatedDeal",    "dealNumber")
      .lean();

    res.status(201).json(populated);
  } catch (err) { next(err); }
};

export const updateActivity = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const {
      business: _b, activityNumber: _n, createdBy: _c,
      createdByLabel: _cl, updatedByLabel: _ul, updatedBy: _u,
      ...updates
    } = nullifyEmptyRefs(req.body);

    const refError = await validateRelatedRefs(updates, business);
    if (refError) return next(refError);

    const activity = await SaleActivity.findOneAndUpdate(
      { _id: req.params.id, business },
      { ...updates, updatedBy: userId, updatedByLabel: actorLabel(req, userId) },
      { new: true, runValidators: true }
    )
      .populate("relatedLead",  "leadNumber fullName")
      .populate("relatedBuyer", "buyerNumber fullName")
      .populate("relatedDeal",  "dealNumber")
      .lean();

    if (!activity) return next(createError(404, "Activity not found"));

    // Sync lastContactDate + nextFollowUpDate to lead
    if (activity.relatedLead) {
      const leadId = activity.relatedLead._id || activity.relatedLead;
      const leadUpdate = { lastContactDate: activity.date, updatedBy: userId };
      if (activity.nextActionDate) leadUpdate.nextFollowUpDate = activity.nextActionDate;
      await SaleLead.findOneAndUpdate({ _id: leadId, business }, leadUpdate);
    }

    res.status(200).json(activity);
  } catch (err) { next(err); }
};

export const getActivity = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const activity = await SaleActivity.findOne({ _id: req.params.id, business })
      .populate("relatedLead",    "leadNumber fullName")
      .populate("relatedBuyer",   "buyerNumber fullName")
      .populate("relatedDeal",    "dealNumber")
      .populate("relatedListing", "listingNumber title")
      .populate("createdBy",      "name fullName")
      .lean();
    if (!activity) return next(createError(404, "Activity not found"));
    res.status(200).json(activity);
  } catch (err) { next(err); }
};

export const deleteActivity = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const activity = await SaleActivity.findOne({ _id: req.params.id, business });
    if (!activity) return next(createError(404, "Activity not found"));
    await activity.deleteOne();
    res.status(200).json({ message: "Activity deleted" });
  } catch (err) { next(err); }
};
