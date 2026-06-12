import mongoose from 'mongoose';
import { createError } from '../../../utils/error.js';

export const resolveCompanyId = (req) => {
  const raw =
    req.body?.company || req.body?.companyId ||
    req.query?.company || req.query?.companyId ||
    req.headers?.['x-active-company-id'] ||
    req.headers?.['x-company-id'] ||
    req.user?.company?._id || req.user?.company ||
    null;

  const companyId = raw ? String(raw) : '';
  if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
    throw createError(403, 'No active company context for HR module');
  }
  return companyId;
};

export const currentUserId = (req) => {
  const raw = req.user?.id || req.user?._id || null;
  return raw && mongoose.Types.ObjectId.isValid(String(raw)) ? String(raw) : null;
};

export const escapeRegex = (v = '') => String(v || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const parsePage = (v, def = 1) => Math.max(parseInt(v) || def, 1);
export const parseLimit = (v, def = 25) => Math.min(Math.max(parseInt(v) || def, 1), 200);

// Throws 400 if `id` is not a valid ObjectId string
export const requireOid = (id, label = 'ID') => {
  if (!mongoose.Types.ObjectId.isValid(String(id || ''))) {
    const err = new Error(`Invalid ${label}`);
    err.status = 400;
    throw err;
  }
};

// Guards an optional ObjectId query param — converts to OID or returns undefined
export const toOid = (v) =>
  v && mongoose.Types.ObjectId.isValid(String(v)) ? new mongoose.Types.ObjectId(String(v)) : undefined;
