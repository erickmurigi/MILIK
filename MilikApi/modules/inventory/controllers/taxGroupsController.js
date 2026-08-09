import InvTaxGroup from "../models/InvTaxGroup.js";
import { createError } from "../../../utils/error.js";
import { resolveActiveBusinessId, escapeRegex, parseBoolean } from "../services/inventoryScope.js";

export const listTaxGroups = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };
    const active = parseBoolean(req.query.active);
    if (active !== undefined) filter.active = active;
    if (req.query.search) filter.name = new RegExp(escapeRegex(String(req.query.search).trim()), "i");
    const data = await InvTaxGroup.find(filter).sort({ name: 1 }).lean();
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

export const createTaxGroup = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { name, rate, type, description } = req.body;
    if (!name?.trim()) throw createError(400, "Tax group name is required");
    if (rate === undefined || rate === null || isNaN(Number(rate))) throw createError(400, "Rate is required");
    const doc = await InvTaxGroup.create({
      business,
      name: String(name).trim(),
      rate: Number(rate),
      type: type || "standard",
      description: description ? String(description).trim() : "",
      createdBy: req.user?._id || null,
    });
    res.status(201).json({ success: true, data: doc });
  } catch (err) { next(err); }
};

export const updateTaxGroup = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const doc = await InvTaxGroup.findOne({ _id: req.params.id, business });
    if (!doc) throw createError(404, "Tax group not found");
    if (req.body.name !== undefined) {
      if (!String(req.body.name).trim()) throw createError(400, "Name cannot be empty");
      doc.name = String(req.body.name).trim();
    }
    if (req.body.rate !== undefined) doc.rate = Number(req.body.rate);
    if (req.body.type !== undefined) doc.type = req.body.type;
    if (req.body.description !== undefined) doc.description = String(req.body.description).trim();
    if (req.body.active !== undefined) doc.active = Boolean(req.body.active);
    await doc.save();
    res.json({ success: true, data: doc });
  } catch (err) { next(err); }
};

export const deleteTaxGroup = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const doc = await InvTaxGroup.findOne({ _id: req.params.id, business }).lean();
    if (!doc) throw createError(404, "Tax group not found");
    await InvTaxGroup.deleteOne({ _id: doc._id });
    res.json({ success: true, message: "Tax group deleted" });
  } catch (err) { next(err); }
};
