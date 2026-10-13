import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import SaleAdvocate from "../models/SaleAdvocate.js";
import SaleProject from "../models/SaleProject.js";
import { currentUserId, generateSequentialNumber, resolveActiveBusinessId } from "../services/businessScope.js";

const sanitizeAdvocateBody = (body) => {
  const out = { ...body };
  if ("userId" in out) out.userId = out.userId || null;
  return out;
};

export const listAdvocates = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const bId = new mongoose.Types.ObjectId(String(business));
    const { search = "", status = "", page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
    const filter = { business };
    // An advocate-linked caller gets only their own record — they have no business browsing
    // the full directory of every other advocate/firm the company works with.
    if (req.saleAdvocateId) filter._id = req.saleAdvocateId;
    if (status) filter.status = status;
    if (search.trim()) {
      filter.$text = { $search: search.trim() };
    }
    const [advocates, total, statsRaw] = await Promise.all([
      SaleAdvocate.find(filter).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
      SaleAdvocate.countDocuments(filter),
      SaleAdvocate.aggregate([
        { $match: { business: bId } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);
    const projectCountsRaw = advocates.length
      ? await SaleProject.aggregate([
          { $match: { business: bId, assignedAdvocate: { $in: advocates.map((a) => a._id) } } },
          { $group: { _id: "$assignedAdvocate", projectCount: { $sum: 1 } } },
        ])
      : [];
    const statsMap       = Object.fromEntries(statsRaw.map((s) => [s._id, s.count]));
    const projectCountMap = Object.fromEntries(projectCountsRaw.map((p) => [String(p._id), p.projectCount]));
    const stats = { active: statsMap.active || 0, inactive: statsMap.inactive || 0 };
    const data = advocates.map((a) => ({ ...a, projectCount: projectCountMap[String(a._id)] || 0 }));
    res.status(200).json({ data, total, page: pageNum, pages: Math.ceil(total / limitNum) || 1, stats });
  } catch (err) {
    next(err);
  }
};

export const getAdvocate = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    // 404 rather than 403 for a mismatched scoped id — don't confirm other advocates exist either.
    if (req.saleAdvocateId && req.saleAdvocateId !== String(req.params.id)) {
      return next(createError(404, "Advocate not found"));
    }
    const advocate = await SaleAdvocate.findOne({ _id: req.params.id, business }).lean();
    if (!advocate) return next(createError(404, "Advocate not found"));
    res.status(200).json(advocate);
  } catch (err) {
    next(err);
  }
};

export const createAdvocate = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const advocateNumber = await generateSequentialNumber(SaleAdvocate, business, "ADV");
    const advocate = await SaleAdvocate.create({
      ...sanitizeAdvocateBody(req.body),
      business,
      advocateNumber,
      createdBy: userId,
      updatedBy: userId,
    });
    res.status(201).json(advocate);
  } catch (err) {
    next(err);
  }
};

export const updateAdvocate = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const { business: _b, advocateNumber: _n, createdBy: _c, ...rawUpdates } = req.body;
    const updates = sanitizeAdvocateBody(rawUpdates);
    const advocate = await SaleAdvocate.findOneAndUpdate(
      { _id: req.params.id, business },
      { ...updates, updatedBy: userId },
      { new: true, runValidators: true }
    ).lean();
    if (!advocate) return next(createError(404, "Advocate not found"));
    res.status(200).json(advocate);
  } catch (err) {
    next(err);
  }
};

export const deleteAdvocate = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const advocate = await SaleAdvocate.findOne({ _id: req.params.id, business });
    if (!advocate) return next(createError(404, "Advocate not found"));

    const projects = await SaleProject.countDocuments({ business, assignedAdvocate: advocate._id });
    if (projects > 0) {
      return next(createError(400, `Cannot delete advocate assigned to ${projects} project(s) — unassign first`));
    }

    await advocate.deleteOne();
    res.status(200).json({ message: "Advocate deleted" });
  } catch (err) {
    next(err);
  }
};
