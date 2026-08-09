// controllers/maintenanceController.js
import mongoose from "mongoose";
import Maintenance from "../../models/Maintenance.js";
import Unit from "../../models/Unit.js";
import { emitToCompany } from "../../utils/socketManager.js";
import { getFieldOfficerPropertyIds } from "../../utils/fieldOfficerScope.js";

const resolveBusinessId = (req) => {
  const requested = req.query?.business || req.body?.business || null;
  const authenticated = req.user?.company?._id || req.user?.company || null;

  if (req.user?.isSystemAdmin || req.user?.superAdminAccess) {
    return requested || authenticated || null;
  }

  return authenticated || requested || null;
};

const scopedMaintenanceQuery = (req, id) => {
  const business = resolveBusinessId(req);
  if (!business) return null;
  return { _id: id, business };
};

// Create maintenance request
export const createMaintenance = async (req, res, next) => {
  const business = resolveBusinessId(req);
  const safeCreate = {};
  for (const key of ["property", "unit", "tenant", ...MAINTENANCE_SAFE_FIELDS]) {
    if (key in req.body) safeCreate[key] = req.body[key];
  }
  const newMaintenance = new Maintenance({ ...safeCreate, business });

  try {
    const savedMaintenance = await newMaintenance.save();
    emitToCompany(business, "maintenance:new", savedMaintenance);
    res.status(200).json(savedMaintenance);
  } catch (err) {
    next(err);
  }
};

// Get all maintenance requests
export const getMaintenances = async (req, res, next) => {
  const { status, priority, unit, tenant, search, page = 1, limit = 50 } = req.query;
  try {
    const business = resolveBusinessId(req);
    const filter = { business };
    if (status && status !== "all") filter.status = status;
    if (priority && priority !== "all") filter.priority = priority;
    if (tenant) filter.tenant = tenant;
    if (search && search.trim()) {
      const term = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { title: { $regex: term, $options: "i" } },
        { description: { $regex: term, $options: "i" } },
        { assignedTo: { $regex: term, $options: "i" } },
      ];
    }

    const foPropertyIds = await getFieldOfficerPropertyIds(req);
    if (foPropertyIds !== null) {
      const foUnits = foPropertyIds.length > 0
        ? await Unit.find({ property: { $in: foPropertyIds }, business }, { _id: 1 }).lean()
        : [];
      const foUnitSet = new Set(foUnits.map((u) => String(u._id)));
      if (unit) {
        if (!foUnitSet.has(String(unit))) {
          return res.status(200).json({ success: true, data: [], total: 0, page: 1, pages: 1 });
        }
        filter.unit = unit;
      } else {
        filter.unit = { $in: [...foUnitSet] };
      }
    } else if (unit) {
      filter.unit = unit;
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

    const [maintenances, total] = await Promise.all([
      Maintenance.find(filter)
        .populate({ path: "unit", select: "unitNumber property", populate: { path: "property", select: "propertyName name address" } })
        .populate("tenant", "name phone")
        .sort({ priority: -1, createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      Maintenance.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: maintenances,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    next(err);
  }
};

// Get single maintenance
export const getMaintenance = async (req, res, next) => {
  try {
    const query = scopedMaintenanceQuery(req, req.params.id);
    const maintenance = await Maintenance.findOne(query)
      .populate({ path: "unit", select: "unitNumber property", populate: { path: "property", select: "propertyName name address" } })
      .populate("tenant", "name phone email");
    if (!maintenance) return res.status(404).json({ message: "Maintenance request not found" });

    const foPropertyIds = await getFieldOfficerPropertyIds(req);
    if (foPropertyIds !== null) {
      const foSet = new Set(foPropertyIds.map(String));
      const propId = maintenance.unit?.property?._id || maintenance.unit?.property;
      if (!propId || !foSet.has(String(propId))) {
        return res.status(403).json({ success: false, message: "Not authorized to access this maintenance request" });
      }
    }

    res.status(200).json(maintenance);
  } catch (err) {
    next(err);
  }
};

const MAINTENANCE_SAFE_FIELDS = [
  "title", "description", "priority", "status", "assignedTo",
  "estimatedCost", "actualCost", "scheduledDate", "completedDate", "images",
];

// Update maintenance
export const updateMaintenance = async (req, res, next) => {
  try {
    const safeUpdate = {};
    for (const key of MAINTENANCE_SAFE_FIELDS) {
      if (key in req.body) safeUpdate[key] = req.body[key];
    }
    const query = scopedMaintenanceQuery(req, req.params.id);
    const updatedMaintenance = await Maintenance.findOneAndUpdate(query, { $set: safeUpdate }, { new: true });
    if (!updatedMaintenance) return res.status(404).json({ message: "Maintenance request not found" });
    res.status(200).json(updatedMaintenance);
  } catch (err) {
    next(err);
  }
};

const VALID_STATUSES = ["pending", "in_progress", "completed", "cancelled"];

// Update maintenance status
export const updateMaintenanceStatus = async (req, res, next) => {
  try {
    const { status, completedDate, actualCost } = req.body;
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` });
    }
    const updateData = { status };

    if (status === "completed") {
      updateData.completedDate = completedDate || new Date();
      if (actualCost !== undefined) updateData.actualCost = actualCost;
    }

    const query = scopedMaintenanceQuery(req, req.params.id);
    const updatedMaintenance = await Maintenance.findOneAndUpdate(query, { $set: updateData }, { new: true });
    if (!updatedMaintenance) return res.status(404).json({ message: "Maintenance request not found" });
    res.status(200).json(updatedMaintenance);
  } catch (err) {
    next(err);
  }
};

// Delete maintenance
export const deleteMaintenance = async (req, res, next) => {
  try {
    const query = scopedMaintenanceQuery(req, req.params.id);
    const deleted = await Maintenance.findOneAndDelete(query);
    if (!deleted) return res.status(404).json({ message: "Maintenance request not found" });
    res.status(200).json({ message: "Maintenance request deleted successfully" });
  } catch (err) {
    next(err);
  }
};

// Get maintenance stats
export const getMaintenanceStats = async (req, res, next) => {
  try {
    const business = resolveBusinessId(req);
    if (!business || !mongoose.Types.ObjectId.isValid(String(business))) {
      return res.status(400).json({ success: false, message: "Missing business" });
    }

    const [result] = await Maintenance.aggregate([
      { $match: { business: new mongoose.Types.ObjectId(String(business)) } },
      {
        $group: {
          _id: null,
          total:       { $sum: 1 },
          pending:     { $sum: { $cond: [{ $eq: ["$status", "pending"] },      1, 0] } },
          inProgress:  { $sum: { $cond: [{ $eq: ["$status", "in_progress"] },  1, 0] } },
          completed:   { $sum: { $cond: [{ $eq: ["$status", "completed"] },    1, 0] } },
          highPriority:{ $sum: { $cond: [{ $eq: ["$priority", "high"] },       1, 0] } },
          totalCost:   { $sum: { $cond: [{ $eq: ["$status", "completed"] }, "$actualCost", 0] } },
        },
      },
    ]);

    res.status(200).json({
      total:        result?.total        ?? 0,
      pending:      result?.pending      ?? 0,
      inProgress:   result?.inProgress   ?? 0,
      completed:    result?.completed    ?? 0,
      highPriority: result?.highPriority ?? 0,
      totalCost:    result?.totalCost    ?? 0,
    });
  } catch (err) {
    next(err);
  }
};
