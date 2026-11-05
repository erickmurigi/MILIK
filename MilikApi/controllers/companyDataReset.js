import bcrypt from "bcryptjs";
import { timingSafeEqual } from "crypto";
import mongoose from "mongoose";
import User from "../models/User.js";
import { createError } from "../utils/error.js";
import { isSystemAdminUser } from "../utils/permissionControl.js";
import {
  latestCompanyReset,
  previewCompanyReset,
  retryCompanyReset,
  startCompanyReset,
  streamCompanyExport,
} from "../services/companyDataResetService.js";

const assertAdminAndCompany = (req) => {
  if (!isSystemAdminUser(req.user)) throw createError(403, "Only Milik/System Admin can reset company data");
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw createError(400, "Invalid company id");
  const ownCompany = String(req.user?.company?._id || req.user?.company || "");
  if (ownCompany && ownCompany === String(req.params.id)) throw createError(400, "You cannot reset the company your own account belongs to");
};

const safeEqual = (a, b) => {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
};

// The reset asks for the admin's password again, so an unattended signed-in session can't run it.
const verifyActorPassword = async (user, password) => {
  if (!password) return false;
  if (user?.id === "milik-admin") {
    const hash = process.env.MILIK_ADMIN_PASSWORD_HASH;
    const plain = process.env.MILIK_ADMIN_PASSWORD;
    if (hash) return bcrypt.compare(password, hash);
    return Boolean(plain) && safeEqual(password, plain);
  }
  if (!mongoose.Types.ObjectId.isValid(user?.id || user?._id)) return false;
  const record = await User.findById(user.id || user._id).select("password").lean();
  return Boolean(record?.password) && bcrypt.compare(password, record.password);
};

export const getCompanyResetPreview = async (req, res, next) => {
  try {
    assertAdminAndCompany(req);
    const scope = String(req.query.scope || "transactions");
    const [preview, latest] = await Promise.all([previewCompanyReset({ companyId: req.params.id, scope }), latestCompanyReset(req.params.id)]);
    res.json({ ...preview, latest });
  } catch (err) {
    next(err);
  }
};

export const downloadCompanyBackup = async (req, res, next) => {
  try {
    assertAdminAndCompany(req);
    await streamCompanyExport({ companyId: req.params.id, scope: String(req.query.scope || "transactions"), user: req.user, res });
  } catch (err) {
    // once the file has started there is no JSON error to send; the job is already marked failed
    if (res.headersSent) return res.destroy(err);
    next(err);
  }
};

export const startCompanyDataReset = async (req, res, next) => {
  try {
    assertAdminAndCompany(req);
    const { scope, confirmName, password, overrideFiled } = req.body || {};
    if (!(await verifyActorPassword(req.user, password))) throw createError(401, "Password is incorrect");
    const job = await startCompanyReset({
      companyId: req.params.id, scope, confirmName, overrideFiled: overrideFiled === true, user: req.user, req,
    });
    res.status(202).json(job);
  } catch (err) {
    next(err);
  }
};

export const getLatestCompanyReset = async (req, res, next) => {
  try {
    assertAdminAndCompany(req);
    res.json(await latestCompanyReset(req.params.id));
  } catch (err) {
    next(err);
  }
};

export const retryCompanyDataReset = async (req, res, next) => {
  try {
    assertAdminAndCompany(req);
    if (!(await verifyActorPassword(req.user, req.body?.password))) throw createError(401, "Password is incorrect");
    res.status(202).json(await retryCompanyReset({ companyId: req.params.id, jobId: req.params.jobId, user: req.user }));
  } catch (err) {
    next(err);
  }
};
