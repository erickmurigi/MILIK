import { createError } from "../../../utils/error.js";
import CarWashJob from "../models/CarWashJob.js";
import CarWashService from "../models/CarWashService.js";
import { currentUserId, escapeRegex, parseBoolean, resolveActiveBusinessId } from "../services/businessScope.js";

const sanitizeServicePayload = (body = {}) => ({
  name:         String(body.name || "").trim(),
  category:     String(body.category || "").trim(),
  pricingType:  body.pricingType === "per_sqft" ? "per_sqft" : "flat",
  defaultPrice: Number(body.defaultPrice || 0),
  active:       parseBoolean(body.active, true),
});

const sanitizePricingTiers = (tiers) => {
  if (!Array.isArray(tiers)) return [];
  return tiers
    .filter((t) => t?.vehicleType && String(t.vehicleType).trim() && Number.isFinite(Number(t.price)) && Number(t.price) >= 0)
    .map((t) => ({ vehicleType: String(t.vehicleType).trim(), price: Number(t.price) }));
};

export const listServices = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { business };
    const active = parseBoolean(req.query.active);
    if (typeof active === "boolean") filter.active = active;
    if (req.query.search) {
      const search = escapeRegex(String(req.query.search).trim());
      filter.$or = [
        { name: new RegExp(search, "i") },
        { category: new RegExp(search, "i") },
        { vehicleType: new RegExp(search, "i") },
      ];
    }

    const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 100);
    const page = Math.max(Number(req.query.page || 1), 1);
    const skip = (page - 1) * limit;
    const [services, total] = await Promise.all([
      CarWashService.find(filter).sort({ active: -1, name: 1 }).skip(skip).limit(limit).lean(),
      CarWashService.countDocuments(filter),
    ]);
    const pagination = { page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) };
    res.status(200).json({ success: true, data: { services, pagination }, services, pagination });
  } catch (error) {
    next(error);
  }
};

export const getService = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const service = await CarWashService.findOne({ _id: req.params.id, business }).lean();
    if (!service) return next(createError(404, "Car Wash service not found"));
    res.status(200).json({ success: true, data: service, service });
  } catch (error) {
    next(error);
  }
};

export const createService = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const payload = sanitizeServicePayload(req.body);
    if (!payload.name) return next(createError(400, "Service name is required"));
    if (!Number.isFinite(payload.defaultPrice) || payload.defaultPrice < 0) {
      return next(createError(400, "Default price must be a valid amount"));
    }

    const pricingTiers = payload.pricingType === "per_sqft" ? [] : sanitizePricingTiers(req.body.pricingTiers);
    const service = await CarWashService.create({ ...payload, pricingTiers, business, createdBy: userId, updatedBy: userId });
    res.status(201).json({ success: true, data: service, service, message: "Car Wash service created" });
  } catch (error) {
    next(error);
  }
};

export const updateService = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const payload = sanitizeServicePayload(req.body);
    if (!payload.name) return next(createError(400, "Service name is required"));
    if (!Number.isFinite(payload.defaultPrice) || payload.defaultPrice < 0) {
      return next(createError(400, "Default price must be a valid amount"));
    }

    const pricingTiers = payload.pricingType === "per_sqft" ? [] : sanitizePricingTiers(req.body.pricingTiers);
    const service = await CarWashService.findOneAndUpdate(
      { _id: req.params.id, business },
      { ...payload, pricingTiers, updatedBy: currentUserId(req) },
      { new: true, runValidators: true }
    );
    if (!service) return next(createError(404, "Car Wash service not found"));
    res.status(200).json({ success: true, data: service, service, message: "Car Wash service updated" });
  } catch (error) {
    next(error);
  }
};

export const listCategories = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const categories = await CarWashService.distinct("category", { business, category: { $nin: ["", null] } });
    const sorted = categories.filter(Boolean).sort((a, b) => a.localeCompare(b));
    res.status(200).json({ success: true, data: sorted, categories: sorted });
  } catch (error) {
    next(error);
  }
};

export const deleteService = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const service = await CarWashService.findOne({ _id: req.params.id, business });
    if (!service) return next(createError(404, "Car Wash service not found"));
    const jobsUsingService = await CarWashJob.countDocuments({ business, service: service._id });
    if (jobsUsingService > 0) {
      return next(createError(400, "Cannot delete a Car Wash service that has jobs. Deactivate it instead."));
    }
    await CarWashService.deleteOne({ _id: service._id, business });
    res.status(200).json({ success: true, message: "Car Wash service deleted" });
  } catch (error) {
    next(error);
  }
};
