import mongoose from "mongoose";
import InvLocation from "../models/InvLocation.js";
import InvStockEntry from "../models/InvStockEntry.js";
import { createError } from "../../../utils/error.js";
import { resolveActiveBusinessId, currentUserId, escapeRegex, parseBoolean } from "../services/inventoryScope.js";

export const listLocations = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };

    if (req.query.type) filter.type = String(req.query.type).trim();
    const active = parseBoolean(req.query.active);
    if (active !== undefined) filter.active = active;
    if (req.query.search) {
      const rx = new RegExp(escapeRegex(String(req.query.search).trim()), "i");
      filter.$or = [{ name: rx }, { code: rx }];
    }

    const locations = await InvLocation.find(filter)
      .sort({ isDefault: -1, name: 1 })
      .lean();

    res.json({ success: true, data: locations });
  } catch (err) {
    next(err);
  }
};

export const getLocation = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const location = await InvLocation.findOne({ _id: req.params.id, business }).lean();
    if (!location) throw createError(404, "Location not found");
    res.json({ success: true, data: location });
  } catch (err) {
    next(err);
  }
};

export const createLocation = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { name, code, type, address, phone, isDefault } = req.body;

    const LOCATION_TYPES = ["warehouse", "retail", "counter"];
    if (!name?.trim()) throw createError(400, "Location name is required");
    if (!type || !LOCATION_TYPES.includes(String(type))) {
      throw createError(400, `Location type must be one of: ${LOCATION_TYPES.join(", ")}`);
    }

    // Only one default per business
    if (isDefault) {
      await InvLocation.updateMany({ business, isDefault: true }, { $set: { isDefault: false } });
    }

    const location = await InvLocation.create({
      business,
      name: String(name).trim(),
      code: code ? String(code).trim().toUpperCase() : undefined,
      type,
      address: address ? String(address).trim() : "",
      phone: phone ? String(phone).trim() : "",
      isDefault: Boolean(isDefault),
    });

    res.status(201).json({ success: true, data: location });
  } catch (err) {
    next(err);
  }
};

export const updateLocation = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const location = await InvLocation.findOne({ _id: req.params.id, business });
    if (!location) throw createError(404, "Location not found");

    const LOCATION_TYPES = ["warehouse", "retail", "counter"];
    if (req.body.name !== undefined) {
      if (!String(req.body.name).trim()) throw createError(400, "Location name cannot be empty");
      location.name = String(req.body.name).trim();
    }
    if (req.body.type !== undefined) {
      if (!LOCATION_TYPES.includes(String(req.body.type))) {
        throw createError(400, `Location type must be one of: ${LOCATION_TYPES.join(", ")}`);
      }
      location.type = String(req.body.type);
    }
    if (req.body.code !== undefined) location.code = req.body.code ? String(req.body.code).trim().toUpperCase() : "";
    if (req.body.address !== undefined) location.address = String(req.body.address).trim();
    if (req.body.phone !== undefined) location.phone = String(req.body.phone).trim();
    if (req.body.active !== undefined) location.active = Boolean(req.body.active);

    if (req.body.isDefault === true || req.body.isDefault === "true") {
      await InvLocation.updateMany(
        { business, isDefault: true, _id: { $ne: location._id } },
        { $set: { isDefault: false } }
      );
      location.isDefault = true;
    }

    await location.save();
    res.json({ success: true, data: location });
  } catch (err) {
    next(err);
  }
};

export const deleteLocation = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const location = await InvLocation.findOne({ _id: req.params.id, business }).lean();
    if (!location) throw createError(404, "Location not found");

    const hasEntries = await InvStockEntry.exists({ business, location: location._id });
    if (hasEntries) {
      throw createError(400, "Cannot delete a location that has stock movements. Deactivate it instead.");
    }

    await InvLocation.deleteOne({ _id: location._id });
    res.json({ success: true, message: "Location deleted" });
  } catch (err) {
    next(err);
  }
};
