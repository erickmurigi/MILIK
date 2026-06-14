import InvCategory from "../models/InvCategory.js";
import InvProduct from "../models/InvProduct.js";
import { createError } from "../../../utils/error.js";
import { resolveActiveBusinessId, escapeRegex, parseBoolean } from "../services/inventoryScope.js";

export const listCategories = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };

    const active = parseBoolean(req.query.active);
    if (active !== undefined) filter.active = active;
    if (req.query.search) {
      filter.name = new RegExp(escapeRegex(String(req.query.search).trim()), "i");
    }

    const categories = await InvCategory.find(filter).sort({ name: 1 }).lean();
    res.json({ success: true, data: categories });
  } catch (err) {
    next(err);
  }
};

export const createCategory = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { name, description } = req.body;
    if (!name?.trim()) throw createError(400, "Category name is required");

    const category = await InvCategory.create({
      business,
      name: String(name).trim(),
      description: description ? String(description).trim() : "",
    });
    res.status(201).json({ success: true, data: category });
  } catch (err) {
    next(err);
  }
};

export const updateCategory = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const category = await InvCategory.findOne({ _id: req.params.id, business });
    if (!category) throw createError(404, "Category not found");

    if (req.body.name !== undefined) {
      if (!String(req.body.name).trim()) throw createError(400, "Category name cannot be empty");
      category.name = String(req.body.name).trim();
    }
    if (req.body.description !== undefined) category.description = String(req.body.description).trim();
    if (req.body.active !== undefined) category.active = Boolean(req.body.active);

    await category.save();
    res.json({ success: true, data: category });
  } catch (err) {
    next(err);
  }
};

export const deleteCategory = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const category = await InvCategory.findOne({ _id: req.params.id, business }).lean();
    if (!category) throw createError(404, "Category not found");

    const inUse = await InvProduct.exists({ business, category: category._id });
    if (inUse) throw createError(400, "Cannot delete a category that has products");

    await InvCategory.deleteOne({ _id: category._id });
    res.json({ success: true, message: "Category deleted" });
  } catch (err) {
    next(err);
  }
};
