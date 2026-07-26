import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";

export const resolveActiveBusinessId = (req) => {
  const rawCompanyId =
    req.headers?.["x-active-company-id"] ||
    req.headers?.["x-company-id"] ||
    req.user?.company?._id ||
    req.user?.company ||
    null;

  const businessId = rawCompanyId ? String(rawCompanyId) : "";
  if (!businessId || !mongoose.Types.ObjectId.isValid(businessId)) {
    throw createError(403, "No active company selected");
  }

  return businessId;
};

export const currentUserId = (req) => {
  const rawUserId = req.user?.id || req.user?._id || null;
  return rawUserId && mongoose.Types.ObjectId.isValid(String(rawUserId)) ? String(rawUserId) : null;
};

export const parseBoolean = (value, fallback = undefined) => {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "active"].includes(normalized)) return true;
  if (["false", "0", "no", "inactive"].includes(normalized)) return false;
  return fallback;
};

export const escapeRegex = (value = "") => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
