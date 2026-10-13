import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import SaleOwner from "../models/SaleOwner.js";
import SaleProject from "../models/SaleProject.js";
import { currentUserId, generateSequentialNumber, resolveActiveBusinessId } from "../services/businessScope.js";

const sanitizeOwnerBody = (body) => {
  const out = { ...body };
  if ("userId" in out) out.userId = out.userId || null;
  return out;
};

export const listOwners = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const bId = new mongoose.Types.ObjectId(String(business));
    const { search = "", status = "", page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
    const filter = { business };
    if (status) filter.status = status;
    if (search.trim()) {
      filter.$text = { $search: search.trim() };
    }
    const [owners, total, statsRaw] = await Promise.all([
      SaleOwner.find(filter).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
      SaleOwner.countDocuments(filter),
      SaleOwner.aggregate([
        { $match: { business: bId } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);
    const projectCountsRaw = owners.length
      ? await SaleProject.aggregate([
          { $match: { business: bId, owner: { $in: owners.map((o) => o._id) } } },
          { $group: { _id: "$owner", projectCount: { $sum: 1 } } },
        ])
      : [];
    const statsMap       = Object.fromEntries(statsRaw.map((s) => [s._id, s.count]));
    const projectCountMap = Object.fromEntries(projectCountsRaw.map((p) => [String(p._id), p.projectCount]));
    const stats = { active: statsMap.active || 0, inactive: statsMap.inactive || 0 };
    const data = owners.map((o) => ({ ...o, projectCount: projectCountMap[String(o._id)] || 0 }));
    res.status(200).json({ data, total, page: pageNum, pages: Math.ceil(total / limitNum) || 1, stats });
  } catch (err) {
    next(err);
  }
};

export const getOwner = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const owner = await SaleOwner.findOne({ _id: req.params.id, business }).lean();
    if (!owner) return next(createError(404, "Owner not found"));
    res.status(200).json(owner);
  } catch (err) {
    next(err);
  }
};

export const createOwner = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const ownerNumber = await generateSequentialNumber(SaleOwner, business, "OWN");
    const owner = await SaleOwner.create({
      ...sanitizeOwnerBody(req.body),
      business,
      ownerNumber,
      createdBy: userId,
      updatedBy: userId,
    });
    res.status(201).json(owner);
  } catch (err) {
    next(err);
  }
};

export const updateOwner = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const { business: _b, ownerNumber: _n, createdBy: _c, ...rawUpdates } = req.body;
    const updates = sanitizeOwnerBody(rawUpdates);
    const owner = await SaleOwner.findOneAndUpdate(
      { _id: req.params.id, business },
      { ...updates, updatedBy: userId },
      { new: true, runValidators: true }
    ).lean();
    if (!owner) return next(createError(404, "Owner not found"));
    res.status(200).json(owner);
  } catch (err) {
    next(err);
  }
};

export const deleteOwner = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const owner = await SaleOwner.findOne({ _id: req.params.id, business });
    if (!owner) return next(createError(404, "Owner not found"));

    const projects = await SaleProject.countDocuments({ business, owner: owner._id });
    if (projects > 0) {
      return next(createError(400, `Cannot delete owner assigned to ${projects} project(s) — unassign first`));
    }

    await owner.deleteOne();
    res.status(200).json({ message: "Owner deleted" });
  } catch (err) {
    next(err);
  }
};
