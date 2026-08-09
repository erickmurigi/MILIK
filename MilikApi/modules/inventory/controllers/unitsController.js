import InvUnitOfMeasure from "../models/InvUnitOfMeasure.js";
import InvProduct from "../models/InvProduct.js";
import { createError } from "../../../utils/error.js";
import { resolveActiveBusinessId, escapeRegex, parseBoolean } from "../services/inventoryScope.js";

export const listUnits = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };
    const active = parseBoolean(req.query.active);
    if (active !== undefined) filter.active = active;
    if (req.query.search) filter.$or = [
      { name:         new RegExp(escapeRegex(String(req.query.search).trim()), "i") },
      { abbreviation: new RegExp(escapeRegex(String(req.query.search).trim()), "i") },
    ];
    const data = await InvUnitOfMeasure.find(filter).sort({ name: 1 }).lean();
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

export const createUnit = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { name, abbreviation, description } = req.body;
    if (!name?.trim()) throw createError(400, "Unit name is required");
    if (!abbreviation?.trim()) throw createError(400, "Abbreviation is required");
    const doc = await InvUnitOfMeasure.create({
      business,
      name: String(name).trim(),
      abbreviation: String(abbreviation).trim(),
      description: description ? String(description).trim() : "",
      createdBy: req.user?._id || null,
    });
    res.status(201).json({ success: true, data: doc });
  } catch (err) { next(err); }
};

export const updateUnit = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const doc = await InvUnitOfMeasure.findOne({ _id: req.params.id, business });
    if (!doc) throw createError(404, "Unit not found");
    if (req.body.name !== undefined) {
      if (!String(req.body.name).trim()) throw createError(400, "Name cannot be empty");
      doc.name = String(req.body.name).trim();
    }
    if (req.body.abbreviation !== undefined) {
      if (!String(req.body.abbreviation).trim()) throw createError(400, "Abbreviation cannot be empty");
      doc.abbreviation = String(req.body.abbreviation).trim();
    }
    if (req.body.description !== undefined) doc.description = String(req.body.description).trim();
    if (req.body.active !== undefined) doc.active = Boolean(req.body.active);
    await doc.save();
    res.json({ success: true, data: doc });
  } catch (err) { next(err); }
};

export const deleteUnit = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const doc = await InvUnitOfMeasure.findOne({ _id: req.params.id, business }).lean();
    if (!doc) throw createError(404, "Unit not found");
    const inUse = await InvProduct.exists({ business, unitOfMeasure: doc.abbreviation });
    if (inUse) throw createError(400, "Cannot delete a unit that is in use by products");
    await InvUnitOfMeasure.deleteOne({ _id: doc._id });
    res.json({ success: true, message: "Unit deleted" });
  } catch (err) { next(err); }
};
