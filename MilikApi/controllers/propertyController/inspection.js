import mongoose from "mongoose";
import Inspection from "../../models/Inspection.js";
import { emitToCompany } from "../../utils/socketManager.js";

const resolveBusinessId = (req) => {
  const requested = req.query?.business || req.body?.business || null;
  const authenticated = req.user?.company?._id || req.user?.company || null;

  if (req.user?.isSystemAdmin || req.user?.superAdminAccess) {
    return requested || authenticated || null;
  }

  return authenticated || requested || null;
};

const scopedInspectionQuery = (req, id) => {
  const business = resolveBusinessId(req);
  if (!business) return null;
  return { _id: id, business };
};

const buildInspectionNumber = () => `INSP-${Date.now().toString().slice(-8)}`;

export const createInspection = async (req, res, next) => {
  try {
    const business = resolveBusinessId(req);
    if (!business) {
      return res.status(400).json({ message: "Business context is required" });
    }

    const payload = {
      ...req.body,
      business,
      inspectionNumber: String(req.body?.inspectionNumber || "").trim() || buildInspectionNumber(),
    };

    const created = await Inspection.create(payload);
    const inspection = await Inspection.findById(created._id)
      .populate("property", "propertyName propertyCode")
      .populate("unit", "unitNumber property")
      .populate("tenant", "name phone");

    emitToCompany(business, "inspection:new", inspection);
    res.status(201).json(inspection);
  } catch (error) {
    next(error);
  }
};

export const getInspections = async (req, res, next) => {
  try {
    const business = resolveBusinessId(req);
    if (!business) {
      return res.status(400).json({ message: "Business context is required" });
    }

    const { status, type, property, unit, tenant } = req.query;
    const filter = { business };
    if (status) filter.status = status;
    if (type) filter.type = type;
    if (property) filter.property = property;
    if (unit) filter.unit = unit;
    if (tenant) filter.tenant = tenant;

    const inspections = await Inspection.find(filter)
      .populate("property", "propertyName propertyCode")
      .populate("unit", "unitNumber property")
      .populate("tenant", "name phone")
      .sort({ scheduledDate: -1, createdAt: -1 });

    res.status(200).json(inspections);
  } catch (error) {
    next(error);
  }
};

export const getInspection = async (req, res, next) => {
  try {
    const query = scopedInspectionQuery(req, req.params.id);
    const inspection = await Inspection.findOne(query)
      .populate("property", "propertyName propertyCode address")
      .populate("unit", "unitNumber property")
      .populate("tenant", "name phone email");

    if (!inspection) {
      return res.status(404).json({ message: "Inspection not found" });
    }

    res.status(200).json(inspection);
  } catch (error) {
    next(error);
  }
};

export const updateInspection = async (req, res, next) => {
  try {
    const query = scopedInspectionQuery(req, req.params.id);
    const updated = await Inspection.findOneAndUpdate(query, { $set: req.body }, { new: true })
      .populate("property", "propertyName propertyCode")
      .populate("unit", "unitNumber property")
      .populate("tenant", "name phone");

    if (!updated) {
      return res.status(404).json({ message: "Inspection not found" });
    }

    emitToCompany(String(updated.business), "inspection:updated", updated);
    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
};

export const deleteInspection = async (req, res, next) => {
  try {
    const query = scopedInspectionQuery(req, req.params.id);
    const deleted = await Inspection.findOneAndDelete(query);

    if (!deleted) {
      return res.status(404).json({ message: "Inspection not found" });
    }

    emitToCompany(String(deleted.business), "inspection:deleted", { _id: deleted._id });
    res.status(200).json({ message: "Inspection deleted successfully" });
  } catch (error) {
    next(error);
  }
};

export const getInspectionStats = async (req, res, next) => {
  try {
    const business = resolveBusinessId(req);
    if (!business) {
      return res.status(400).json({ message: "Business context is required" });
    }

    const businessObjectId = new mongoose.Types.ObjectId(String(business));
    const [summary] = await Inspection.aggregate([
      { $match: { business: businessObjectId } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          scheduled: {
            $sum: {
              $cond: [{ $eq: ["$status", "scheduled"] }, 1, 0],
            },
          },
          inProgress: {
            $sum: {
              $cond: [{ $eq: ["$status", "in_progress"] }, 1, 0],
            },
          },
          completed: {
            $sum: {
              $cond: [{ $eq: ["$status", "completed"] }, 1, 0],
            },
          },
          averageScore: {
            $avg: {
              $cond: [{ $ifNull: ["$score", false] }, "$score", null],
            },
          },
        },
      },
    ]);

    res.status(200).json({
      total: Number(summary?.total || 0),
      scheduled: Number(summary?.scheduled || 0),
      inProgress: Number(summary?.inProgress || 0),
      completed: Number(summary?.completed || 0),
      averageScore: Number(summary?.averageScore || 0),
    });
  } catch (error) {
    next(error);
  }
};
