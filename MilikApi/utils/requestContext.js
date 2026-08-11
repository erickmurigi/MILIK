import mongoose from "mongoose";
import { createError } from "./error.js";

/**
 * Canonical business ID resolver — covers all header/body/query/user shapes
 * used across every module. Returns a plain string or null (never throws).
 */
export const resolveBusinessId = (req) => {
  const raw =
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
    req.user?.company?._id ||
    req.user?.company ||
    req.user?.business ||
    null;

  return raw ? String(raw) : null;
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
