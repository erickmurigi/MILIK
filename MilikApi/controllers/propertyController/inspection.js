import mongoose from "mongoose";
import Inspection from "../../models/Inspection.js";
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

    const safeCreate = {};
    for (const key of INSPECTION_SAFE_FIELDS) {
      if (key in req.body) safeCreate[key] = req.body[key];
    }
    const payload = {
      ...safeCreate,
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

    const { status, type, property, unit, tenant, search, page = 1, limit = 50 } = req.query;
    const filter = { business };
    if (status && status !== "all") filter.status = status;
    if (type && type !== "all") filter.type = type;
    if (property && property !== "all") filter.property = property;
    if (unit) filter.unit = unit;
    if (tenant) filter.tenant = tenant;
    if (search && search.trim()) {
      const term = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { title: { $regex: term, $options: "i" } },
        { notes: { $regex: term, $options: "i" } },
        { inspectionNumber: { $regex: term, $options: "i" } },
      ];
    }

    const foPropertyIds = await getFieldOfficerPropertyIds(req);
    if (foPropertyIds !== null) {
      if (filter.property) {
        const foSet = new Set(foPropertyIds.map(String));
        if (!foSet.has(String(filter.property))) {
          return res.status(200).json({ success: true, data: [], total: 0, page: 1, pages: 1 });
        }
      } else {
        filter.property = { $in: foPropertyIds };
      }
    }

    const pageNum  = Math.max(parseInt(page,  10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

    const [inspections, total] = await Promise.all([
      Inspection.find(filter)
        .populate("property", "propertyName propertyCode")
        .populate("unit", "unitNumber property")
        .populate("tenant", "name phone")
        .sort({ scheduledDate: -1, createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      Inspection.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: inspections,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
    });
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

    const foPropertyIds = await getFieldOfficerPropertyIds(req);
    if (foPropertyIds !== null) {
      const foSet = new Set(foPropertyIds.map(String));
      const propId = inspection.property?._id || inspection.property;
      if (!propId || !foSet.has(String(propId))) {
        return res.status(403).json({ success: false, message: "Not authorized to access this inspection" });
      }
    }

    res.status(200).json(inspection);
  } catch (error) {
    next(error);
  }
};

const INSPECTION_SAFE_FIELDS = [
  "property", "unit", "tenant", "inspectionNumber", "type", "status",
  "inspectorName", "scheduledDate", "completedDate", "score", "issuesFound",
  "recommendations", "nextInspectionDate", "tenantPresent", "notes", "photosCount",
];

export const updateInspection = async (req, res, next) => {
  try {
    const safeUpdate = {};
    for (const key of INSPECTION_SAFE_FIELDS) {
      if (key in req.body) safeUpdate[key] = req.body[key];
    }
    const query = scopedInspectionQuery(req, req.params.id);
    const updated = await Inspection.findOneAndUpdate(query, { $set: safeUpdate }, { new: true })
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

    if (!mongoose.Types.ObjectId.isValid(String(business))) {
      return res.status(400).json({ message: "Invalid business ID" });
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
