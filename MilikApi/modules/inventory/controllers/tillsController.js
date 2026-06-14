import mongoose from "mongoose";
import InvTill from "../models/InvTill.js";
import InvLocation from "../models/InvLocation.js";
import POSSession from "../models/POSSession.js";
import { createError } from "../../../utils/error.js";
import { resolveActiveBusinessId, currentUserId } from "../services/inventoryScope.js";

export const listTills = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };
    if (req.query.location && mongoose.Types.ObjectId.isValid(String(req.query.location))) {
      filter.location = String(req.query.location);
    }
    if (req.query.active !== undefined) filter.isActive = req.query.active !== "false";

    const tills = await InvTill.find(filter)
      .populate("location", "name type")
      .populate("createdBy", "name username")
      .sort({ "location.name": 1, name: 1 })
      .lean();

    res.json({ success: true, data: tills, total: tills.length });
  } catch (err) { next(err); }
};

export const getTill = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const till = await InvTill.findOne({ _id: req.params.id, business })
      .populate("location", "name type")
      .lean();
    if (!till) throw createError(404, "Till not found");
    res.json({ success: true, data: till });
  } catch (err) { next(err); }
};

export const createTill = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const { location, name, description } = req.body;

    if (!location || !mongoose.Types.ObjectId.isValid(String(location))) {
      throw createError(400, "Valid location is required");
    }
    if (!name?.trim()) throw createError(400, "Till name is required");

    const loc = await InvLocation.findOne({ _id: String(location), business }).lean();
    if (!loc) throw createError(404, "Location not found");

    const till = await InvTill.create({
      business,
      location: String(location),
      name:     String(name).trim(),
      description: description ? String(description).trim() : "",
      createdBy: userId,
    });

    const populated = await InvTill.findById(till._id).populate("location", "name type").lean();
    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    if (err.code === 11000) return next(createError(409, "A till with this name already exists at this location"));
    next(err);
  }
};

export const updateTill = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const allowed  = ["name", "description", "isActive"];
    const updates  = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (updates.name !== undefined) {
      updates.name = String(updates.name).trim();
      if (!updates.name) throw createError(400, "Till name cannot be empty");
    }

    const till = await InvTill.findOneAndUpdate(
      { _id: req.params.id, business },
      { $set: updates },
      { new: true, runValidators: true }
    ).populate("location", "name type").lean();

    if (!till) throw createError(404, "Till not found");
    res.json({ success: true, data: till });
  } catch (err) {
    if (err.code === 11000) return next(createError(409, "A till with this name already exists at this location"));
    next(err);
  }
};

export const deleteTill = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const hasOpenSession = await POSSession.exists({ business, till: req.params.id, status: "open" });
    if (hasOpenSession) throw createError(409, "Cannot delete a till with an open session — close the session first");

    const till = await InvTill.findOneAndDelete({ _id: req.params.id, business });
    if (!till) throw createError(404, "Till not found");
    res.json({ success: true, message: "Till deleted" });
  } catch (err) { next(err); }
};
