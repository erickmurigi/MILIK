import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import CarWashBranch from "../models/CarWashBranch.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import { currentUserId, parseBoolean, resolveActiveBusinessId, resolveActiveBranchId } from "../services/businessScope.js";

const METHODS = ["cash", "mpesa", "bank", "card", "other"];
const BRANCH_TYPES = ["vehicle", "carpet", "both"];

const toOidOrNull = (value) => {
  const s = String(value || "").trim();
  return s && mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
};

const sanitizeBranchPayload = (body = {}) => ({
  name: String(body.name || "").trim(),
  location: String(body.location || "").trim(),
  address: String(body.address || "").trim(),
  phone: String(body.phone || "").trim(),
  mpesaShortCode: String(body.mpesaShortCode || "").trim(),
  branchType: BRANCH_TYPES.includes(body.branchType) ? body.branchType : "both",
  active: parseBoolean(body.active, true),
  isDefault: parseBoolean(body.isDefault, false),
});

const resolveBranchCashbooks = async (business, raw = {}, next) => {
  const result = {};
  for (const method of METHODS) {
    const val = toOidOrNull(raw[method]);
    if (val) {
      const account = await ChartOfAccount.findOne({
        _id: val,
        business,
        type: "asset",
        isPosting: true,
        subGroup: { $regex: "cashbook", $options: "i" },
      }).lean();
      if (!account) {
        next({ status: 400, message: `Invalid cashbook for method "${method}" — must be a posting Cashbooks account` });
        return null;
      }
    }
    result[method] = val;
  }
  return result;
};

// Returns the calling user's active branch — no branch permission needed, any carwash user can call this
export const getActiveBranch = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const branchId = resolveActiveBranchId(req);
    if (!branchId) return res.status(200).json({ success: true, data: null, branch: null });
    const branch = await CarWashBranch.findOne({ _id: branchId, business, active: true })
      .populate("defaultCashbooks.cash defaultCashbooks.mpesa defaultCashbooks.bank defaultCashbooks.card defaultCashbooks.other", "code name")
      .lean();
    res.status(200).json({ success: true, data: branch, branch });
  } catch (error) {
    next(error);
  }
};

export const listBranches = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };
    const active = parseBoolean(req.query.active);
    if (typeof active === "boolean") filter.active = active;
    const branches = await CarWashBranch.find(filter)
      .populate("defaultCashbooks.cash defaultCashbooks.mpesa defaultCashbooks.bank defaultCashbooks.card defaultCashbooks.other", "code name")
      .sort({ isDefault: -1, name: 1 })
      .lean();
    res.status(200).json({ success: true, data: branches, branches });
  } catch (error) {
    next(error);
  }
};

export const getBranch = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const branch = await CarWashBranch.findOne({ _id: req.params.id, business })
      .populate("defaultCashbooks.cash defaultCashbooks.mpesa defaultCashbooks.bank defaultCashbooks.card defaultCashbooks.other", "code name")
      .lean();
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

    const defaultCashbooks = req.body.defaultCashbooks
      ? await resolveBranchCashbooks(business, req.body.defaultCashbooks, next)
      : {};
    if (defaultCashbooks === null) return;

    if (payload.isDefault) {
      await CarWashBranch.updateMany({ business, isDefault: true }, { isDefault: false });
    }

    const branch = await CarWashBranch.create({
      ...payload,
      defaultCashbooks,
      business,
      createdBy: userId,
      updatedBy: userId,
    });
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

    const defaultCashbooks = req.body.defaultCashbooks
      ? await resolveBranchCashbooks(business, req.body.defaultCashbooks, next)
      : {};
    if (defaultCashbooks === null) return;

    if (payload.isDefault) {
      await CarWashBranch.updateMany({ business, isDefault: true, _id: { $ne: req.params.id } }, { isDefault: false });
    }

    const branch = await CarWashBranch.findOneAndUpdate(
      { _id: req.params.id, business },
      { ...payload, defaultCashbooks, updatedBy: currentUserId(req) },
      { new: true, runValidators: true }
    ).populate("defaultCashbooks.cash defaultCashbooks.mpesa defaultCashbooks.bank defaultCashbooks.card defaultCashbooks.other", "code name");

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
