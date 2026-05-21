import { createError } from "../../../utils/error.js";
import CarWashBranch from "../models/CarWashBranch.js";
import { currentUserId, parseBoolean, resolveActiveBusinessId } from "../services/businessScope.js";

const sanitizeBranchPayload = (body = {}) => ({
  name: String(body.name || "").trim(),
  location: String(body.location || "").trim(),
  address: String(body.address || "").trim(),
  phone: String(body.phone || "").trim(),
  mpesaShortCode: String(body.mpesaShortCode || "").trim(),
  active: parseBoolean(body.active, true),
  isDefault: parseBoolean(body.isDefault, false),
});

export const listBranches = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };
    const active = parseBoolean(req.query.active);
    if (typeof active === "boolean") filter.active = active;
    const branches = await CarWashBranch.find(filter).sort({ isDefault: -1, name: 1 }).lean();
    res.status(200).json({ success: true, data: branches, branches });
  } catch (error) {
    next(error);
  }
};

export const getBranch = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const branch = await CarWashBranch.findOne({ _id: req.params.id, business }).lean();
    if (!branch) return next(createError(404, "Car Wash branch not found"));
    res.status(200).json({ success: true, data: branch, branch });
  } catch (error) {
    next(error);
  }
};

export const createBranch = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const payload = sanitizeBranchPayload(req.body);
    if (!payload.name) return next(createError(400, "Branch name is required"));
    const userId = currentUserId(req);

    if (payload.isDefault) {
      await CarWashBranch.updateMany({ business, isDefault: true }, { isDefault: false });
    }

    const branch = await CarWashBranch.create({ ...payload, business, createdBy: userId, updatedBy: userId });
    res.status(201).json({ success: true, data: branch, branch, message: "Car Wash branch created" });
  } catch (error) {
    if (error.code === 11000) return next(createError(400, "A branch with this name already exists"));
    next(error);
  }
};

export const updateBranch = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const payload = sanitizeBranchPayload(req.body);
    if (!payload.name) return next(createError(400, "Branch name is required"));

    if (payload.isDefault) {
      await CarWashBranch.updateMany({ business, isDefault: true, _id: { $ne: req.params.id } }, { isDefault: false });
    }

    const branch = await CarWashBranch.findOneAndUpdate(
      { _id: req.params.id, business },
      { ...payload, updatedBy: currentUserId(req) },
      { new: true, runValidators: true }
    );
    if (!branch) return next(createError(404, "Car Wash branch not found"));
    res.status(200).json({ success: true, data: branch, branch, message: "Car Wash branch updated" });
  } catch (error) {
    if (error.code === 11000) return next(createError(400, "A branch with this name already exists"));
    next(error);
  }
};

export const deleteBranch = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const branch = await CarWashBranch.findOne({ _id: req.params.id, business });
    if (!branch) return next(createError(404, "Car Wash branch not found"));
    if (branch.isDefault) return next(createError(400, "Cannot delete the default branch"));
    await CarWashBranch.deleteOne({ _id: branch._id, business });
    res.status(200).json({ success: true, message: "Car Wash branch deleted" });
  } catch (error) {
    next(error);
  }
};
