import InvSupplier from "../models/InvSupplier.js";
import InvPurchaseOrder from "../models/InvPurchaseOrder.js";
import { createError } from "../../../utils/error.js";
import { resolveActiveBusinessId, escapeRegex, parseBoolean } from "../services/inventoryScope.js";
import { resolveSupplierApAccount } from "../services/inventoryAccountingService.js";

export const listSuppliers = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };

    const active = parseBoolean(req.query.active);
    if (active !== undefined) filter.active = active;
    if (req.query.search) {
      const rx = new RegExp(escapeRegex(String(req.query.search).trim()), "i");
      filter.$or = [{ name: rx }, { contactName: rx }, { phone: rx }, { email: rx }];
    }

    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const page = Math.max(Number(req.query.page || 1), 1);
    const skip = (page - 1) * limit;

    const [suppliers, total] = await Promise.all([
      InvSupplier.find(filter).sort({ name: 1 }).skip(skip).limit(limit).lean(),
      InvSupplier.countDocuments(filter),
    ]);

    res.json({ success: true, data: suppliers, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
};

export const getSupplier = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const supplier = await InvSupplier.findOne({ _id: req.params.id, business }).lean();
    if (!supplier) throw createError(404, "Supplier not found");
    res.json({ success: true, data: supplier });
  } catch (err) {
    next(err);
  }
};

export const createSupplier = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { name, contactName, phone, email, kraPin, address, notes } = req.body;
    if (!name?.trim()) throw createError(400, "Supplier name is required");

    const supplier = await InvSupplier.create({
      business,
      name: String(name).trim(),
      contactName: contactName ? String(contactName).trim() : "",
      phone: phone ? String(phone).trim() : "",
      email: email ? String(email).trim().toLowerCase() : "",
      kraPin: kraPin ? String(kraPin).trim().toUpperCase() : "",
      address: address ? String(address).trim() : "",
      notes: notes ? String(notes).trim() : "",
    });

    // Auto-create AP sub-ledger account under 2000 — await so the response includes apAccountId
    try {
      const apAccount = await resolveSupplierApAccount(String(business), String(supplier._id));
      supplier.apAccountId = apAccount._id;
    } catch (err) {
      console.error("[INV GL] resolveSupplierApAccount failed on create:", err.message);
    }

    res.status(201).json({ success: true, data: supplier });
  } catch (err) {
    next(err);
  }
};

export const updateSupplier = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const supplier = await InvSupplier.findOne({ _id: req.params.id, business });
    if (!supplier) throw createError(404, "Supplier not found");

    const allowed = ["name", "contactName", "phone", "email", "kraPin", "address", "notes", "active"];
    for (const key of allowed) {
      if (req.body[key] !== undefined) supplier[key] = req.body[key];
    }
    if (req.body.email) supplier.email = String(req.body.email).trim().toLowerCase();
    if (req.body.kraPin) supplier.kraPin = String(req.body.kraPin).trim().toUpperCase();

    await supplier.save();
    res.json({ success: true, data: supplier });
  } catch (err) {
    next(err);
  }
};

export const deleteSupplier = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const supplier = await InvSupplier.findOne({ _id: req.params.id, business }).lean();
    if (!supplier) throw createError(404, "Supplier not found");

    const inUse = await InvPurchaseOrder.exists({ business, supplier: supplier._id });
    if (inUse) throw createError(400, "Cannot delete a supplier that has purchase orders. Deactivate it instead.");

    await InvSupplier.deleteOne({ _id: supplier._id });
    res.json({ success: true, message: "Supplier deleted" });
  } catch (err) {
    next(err);
  }
};
