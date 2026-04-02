// controllers/maintenanceController.js
import mongoose from "mongoose";
import Maintenance from "../../models/Maintenance.js";
import { emitToCompany } from "../../utils/socketManager.js";

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
  const newMaintenance = new Maintenance({ ...req.body, business });

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
  const { status, priority, unit, tenant } = req.query;
  try {
    const business = resolveBusinessId(req);
    const filter = { business };
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (unit) filter.unit = unit;
    if (tenant) filter.tenant = tenant;

    const maintenances = await Maintenance.find(filter)
      .populate("unit", "unitNumber property")
      .populate("unit.property", "name address")
      .populate("tenant", "name phone")
      .sort({ priority: -1, createdAt: -1 });
    res.status(200).json(maintenances);
  } catch (err) {
    next(err);
  }
};

// Get single maintenance
export const getMaintenance = async (req, res, next) => {
  try {
    const query = scopedMaintenanceQuery(req, req.params.id);
    const maintenance = await Maintenance.findOne(query)
      .populate("unit", "unitNumber property")
      .populate("unit.property", "name address landlord")
      .populate("tenant", "name phone email");
    if (!maintenance) return res.status(404).json({ message: "Maintenance request not found" });
    res.status(200).json(maintenance);
  } catch (err) {
    next(err);
  }
};

// Update maintenance
export const updateMaintenance = async (req, res, next) => {
  try {
    const query = scopedMaintenanceQuery(req, req.params.id);
    const updatedMaintenance = await Maintenance.findOneAndUpdate(query, { $set: req.body }, { new: true });
    if (!updatedMaintenance) return res.status(404).json({ message: "Maintenance request not found" });
    res.status(200).json(updatedMaintenance);
  } catch (err) {
    next(err);
  }
};

// Update maintenance status
export const updateMaintenanceStatus = async (req, res, next) => {
  try {
    const { status, completedDate, actualCost } = req.body;
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
    const total = await Maintenance.countDocuments({ business });
    const pending = await Maintenance.countDocuments({ business, status: "pending" });
    const inProgress = await Maintenance.countDocuments({ business, status: "in_progress" });
    const completed = await Maintenance.countDocuments({ business, status: "completed" });
    const highPriority = await Maintenance.countDocuments({ business, priority: "high" });

    const maintenanceCosts = await Maintenance.aggregate([
      { $match: { business: new mongoose.Types.ObjectId(String(business)), status: "completed" } },
      { $group: { _id: null, totalCost: { $sum: "$actualCost" } } },
    ]);

    res.status(200).json({
      total,
      pending,
      inProgress,
      completed,
      highPriority,
      totalCost: maintenanceCosts[0]?.totalCost || 0,
    });
  } catch (err) {
    next(err);
  }
};
