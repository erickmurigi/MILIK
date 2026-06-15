import { createError } from "../../../utils/error.js";
import CarWashJob from "../models/CarWashJob.js";
import CarWashStaff from "../models/CarWashStaff.js";
import { currentUserId, escapeRegex, parseBoolean, resolveActiveBusinessId, resolveActiveBranchId } from "../services/businessScope.js";

const sanitizeStaffPayload = (body = {}) => ({
  name: String(body.name || "").trim().toUpperCase(),
  phone: String(body.phone || "").trim(),
  role: String(body.role || "").trim().toUpperCase(),
  active: parseBoolean(body.active, true),
});

export const listStaff = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const branchId = resolveActiveBranchId(req);
    const filter = { business };
    if (branchId) filter.branch = branchId;
    const active = parseBoolean(req.query.active);
    if (typeof active === "boolean") filter.active = active;
    if (req.query.search) {
      const search = escapeRegex(String(req.query.search).trim());
      filter.$or = [
        { name: new RegExp(search, "i") },
        { phone: new RegExp(search, "i") },
        { role: new RegExp(search, "i") },
      ];
    }
    const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 100);
    const page = Math.max(Number(req.query.page || 1), 1);
    const skip = (page - 1) * limit;
    const [staff, total] = await Promise.all([
      CarWashStaff.find(filter).sort({ active: -1, name: 1 }).skip(skip).limit(limit).lean(),
      CarWashStaff.countDocuments(filter),
    ]);
    const pagination = { page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) };
    res.status(200).json({ success: true, data: { staff, pagination }, staff, pagination });
  } catch (error) {
    next(error);
  }
};

export const createStaff = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const payload = sanitizeStaffPayload(req.body);
    if (!payload.name) return next(createError(400, "Staff name is required"));
    const userId = currentUserId(req);
    const branchId = resolveActiveBranchId(req);
    const staff = await CarWashStaff.create({ ...payload, business, branch: branchId || null, createdBy: userId, updatedBy: userId });
    res.status(201).json({ success: true, data: staff, staff, message: "Car Wash staff member created" });
  } catch (error) {
    next(error);
  }
};

export const updateStaff = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const payload = sanitizeStaffPayload(req.body);
    if (!payload.name) return next(createError(400, "Staff name is required"));
    const staff = await CarWashStaff.findOneAndUpdate(
      { _id: req.params.id, business },
      { ...payload, updatedBy: currentUserId(req) },
      { new: true, runValidators: true }
    );
    if (!staff) return next(createError(404, "Car Wash staff member not found"));
    res.status(200).json({ success: true, data: staff, staff, message: "Car Wash staff member updated" });
  } catch (error) {
    next(error);
  }
};

export const deleteStaff = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const staff = await CarWashStaff.findOne({ _id: req.params.id, business });
    if (!staff) return next(createError(404, "Car Wash staff member not found"));
    const assignedJobs = await CarWashJob.countDocuments({ business, assignedStaff: staff._id });
    if (assignedJobs > 0) {
      return next(createError(400, "Cannot delete Car Wash staff assigned to jobs. Deactivate the staff member instead."));
    }
    await CarWashStaff.deleteOne({ _id: staff._id, business });
    res.status(200).json({ success: true, message: "Car Wash staff member deleted" });
  } catch (error) {
    next(error);
  }
};
