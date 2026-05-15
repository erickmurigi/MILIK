import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";

export const resolveActiveBusinessId = (req) => {
  const id =
    req.query.business ||
    req.query.company ||
    req.body?.business ||
    req.body?.company ||
    req.user?.company?._id ||
    req.user?.company;
  if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
    throw createError(400, "A valid business ID is required");
  }
  return new mongoose.Types.ObjectId(String(id));
};

export const currentUserId = (req) => {
  const id = req.user?._id || req.user?.id;
  return id && mongoose.Types.ObjectId.isValid(String(id))
    ? new mongoose.Types.ObjectId(String(id))
    : null;
};

export const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const parseDateRange = (date = new Date()) => {
  const d = new Date(date);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  return { start, end };
};

export const parseMonthRange = (month = "") => {
  const [year, mon] = String(month || "").split("-").map(Number);
  const now = new Date();
  const y = year || now.getFullYear();
  const m = (mon || now.getMonth() + 1) - 1;
  const start = new Date(y, m, 1, 0, 0, 0, 0);
  const end = new Date(y, m + 1, 0, 23, 59, 59, 999);
  return { start, end };
};

export const generateSequentialNumber = async (Model, business, prefix, field = "createdAt") => {
  const count = await Model.countDocuments({ business });
  return `${prefix}-${String(count + 1).padStart(4, "0")}`;
};
