import InvPaymentMethod from "../models/InvPaymentMethod.js";
import { createError } from "../../../utils/error.js";
import { resolveActiveBusinessId, parseBoolean } from "../services/inventoryScope.js";

const BUILT_IN_METHODS = [
  { code: "cash",   name: "Cash",   icon: "💵", requireRef: false, refLabel: "",            sortOrder: 0 },
  { code: "mpesa",  name: "M-Pesa", icon: "📱", requireRef: true,  refLabel: "M-Pesa Code", sortOrder: 1 },
  { code: "card",   name: "Card",   icon: "💳", requireRef: false,  refLabel: "Card Auth",  sortOrder: 2 },
  { code: "credit", name: "Credit", icon: "📋", requireRef: false, refLabel: "",            sortOrder: 3 },
];

export const listPaymentMethods = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    await seedBuiltIns(business, req.user?._id);
    const filter = { business };
    const active = parseBoolean(req.query.active);
    if (active !== undefined) filter.active = active;
    const data = await InvPaymentMethod.find(filter).sort({ sortOrder: 1, name: 1 }).lean();
    res.json({ success: true, data });
  } catch (err) { next(err); }
};

export const createPaymentMethod = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { name, code, icon, requireRef, refLabel, sortOrder } = req.body;
    if (!name?.trim()) throw createError(400, "Name is required");
    if (!code?.trim()) throw createError(400, "Code is required");
    const doc = await InvPaymentMethod.create({
      business,
      name: String(name).trim(),
      code: String(code).trim().toLowerCase(),
      icon: icon || "",
      requireRef: Boolean(requireRef),
      refLabel: refLabel ? String(refLabel).trim() : "",
      sortOrder: sortOrder !== undefined ? Number(sortOrder) : 10,
      builtIn: false,
      createdBy: req.user?._id || null,
    });
    res.status(201).json({ success: true, data: doc });
  } catch (err) { next(err); }
};

export const updatePaymentMethod = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const doc = await InvPaymentMethod.findOne({ _id: req.params.id, business });
    if (!doc) throw createError(404, "Payment method not found");
    if (req.body.name !== undefined) doc.name = String(req.body.name).trim();
    if (req.body.icon !== undefined) doc.icon = String(req.body.icon).trim();
    if (req.body.requireRef !== undefined) doc.requireRef = Boolean(req.body.requireRef);
    if (req.body.refLabel !== undefined) doc.refLabel = String(req.body.refLabel).trim();
    if (req.body.sortOrder !== undefined) doc.sortOrder = Number(req.body.sortOrder);
    if (req.body.active !== undefined) doc.active = Boolean(req.body.active);
    await doc.save();
    res.json({ success: true, data: doc });
  } catch (err) { next(err); }
};

export const deletePaymentMethod = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const doc = await InvPaymentMethod.findOne({ _id: req.params.id, business }).lean();
    if (!doc) throw createError(404, "Payment method not found");
    if (doc.builtIn) throw createError(400, "Built-in payment methods cannot be deleted");
    await InvPaymentMethod.deleteOne({ _id: doc._id });
    res.json({ success: true, message: "Payment method deleted" });
  } catch (err) { next(err); }
};

async function seedBuiltIns(businessId, userId) {
  for (const m of BUILT_IN_METHODS) {
    const exists = await InvPaymentMethod.exists({ business: businessId, code: m.code });
    if (!exists) {
      await InvPaymentMethod.create({ business: businessId, ...m, builtIn: true, createdBy: userId || null });
    }
  }
}
