import mongoose from "mongoose";
import { createError } from "./error.js";
import { canAccessCompanyId, normalizeCompanyId } from "../controllers/verifyToken.js";

/**
 * Canonical business ID resolver — covers all header/body/query/user shapes
 * used across every module. Returns a plain string or null (never throws).
 *
 * SECURITY: an explicit business/company id from the client (header, body, or
 * query) is only honored when canAccessCompanyId confirms the authenticated
 * user is actually entitled to act as that company (system admins, or a
 * genuinely multi-company user) — mirroring getActiveCompanyIdFromRequest in
 * controllers/verifyToken.js, which already gets this right. Previously any
 * client-supplied value was trusted outright, ahead of req.user's own company,
 * letting any authenticated user read/write another company's data by simply
 * passing its id — this was the shared root cause behind cross-tenant access
 * on every module that resolves its business scope through this function
 * (HR, CarWash, Clients, PropertySale, Inventory, and ~25 property
 * controllers). See the security hotfix that added this check for the full
 * writeup.
 */
export const resolveBusinessId = (req) => {
  const ownCompanyId =
    normalizeCompanyId(req.user?.company) || normalizeCompanyId(req.user?.business);

  const explicit =
    req.headers?.["x-active-company-id"] ||
    req.headers?.["x-company-id"] ||
    req.body?.business ||
    req.body?.businessId ||
    req.body?.company ||
    req.body?.companyId ||
    req.query?.business ||
    req.query?.businessId ||
    req.query?.company ||
    req.query?.companyId ||
    null;

  const explicitId = normalizeCompanyId(explicit);
  if (explicitId && canAccessCompanyId(req.user, explicitId)) return explicitId;

  return ownCompanyId;
};

/**
 * Same as resolveBusinessId but throws 403 if missing or invalid ObjectId.
 * Pass `context` for a module-specific error message.
 */
export const resolveBusinessIdOrThrow = (req, context = "this module") => {
  const id = resolveBusinessId(req);
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    throw createError(403, `No active company selected for ${context}`);
  }
  return id;
};

/**
 * Returns the authenticated user's ObjectId as a string, or null for system
 * admin sessions where the token carries a non-ObjectId id value.
 */
export const currentUserId = (req) => {
  const raw = req.user?.id || req.user?._id || null;
  return raw && mongoose.Types.ObjectId.isValid(String(raw)) ? String(raw) : null;
};

/**
 * Coerce a query/body boolean string to a real boolean.
 */
export const parseBoolean = (value, fallback = undefined) => {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null || value === "") return fallback;
  const n = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "active"].includes(n)) return true;
  if (["false", "0", "no", "inactive"].includes(n)) return false;
  return fallback;
};

/**
 * Returns { start, end } for a given date covering the full calendar day.
 */
export const parseDateRange = (dateValue = null) => {
  const date = dateValue ? new Date(dateValue) : new Date();
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  const start = new Date(safe);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

/**
 * Returns { start, end } for a full calendar month given "YYYY-MM" string.
 */
export const parseMonthRange = (month = "") => {
  const [year, mon] = String(month || "").split("-").map(Number);
  const now = new Date();
  const y = year || now.getFullYear();
  const m = (mon || now.getMonth() + 1) - 1;
  const start = new Date(y, m, 1, 0, 0, 0, 0);
  const end = new Date(y, m + 1, 0, 23, 59, 59, 999);
  return { start, end };
};
