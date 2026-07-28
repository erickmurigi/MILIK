import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import SaleAgent from "../models/SaleAgent.js";
import SaleDeal from "../models/SaleDeal.js";
import SaleCommission from "../models/SaleCommission.js";
import SaleOffer from "../models/SaleOffer.js";
import { currentUserId, generateSequentialNumber, resolveActiveBusinessId } from "../services/businessScope.js";

export const listAgents = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const bId = new mongoose.Types.ObjectId(String(business));
    const { search = "", status = "", commissionType = "", page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
    const filter = { business };
    if (status)         filter.status         = status;
    if (commissionType) filter.commissionType = commissionType;
    if (search.trim()) {
      filter.$text = { $search: search.trim() };
    }
    const [agents, total, statsRaw, dealCountsRaw] = await Promise.all([
      SaleAgent.find(filter).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
      SaleAgent.countDocuments(filter),
      SaleAgent.aggregate([
        { $match: { business: bId } },
        { $group: { _id: "$status", count: { $sum: 1 }, avgRate: { $avg: "$commissionRate" } } },
      ]),
      SaleDeal.aggregate([
        { $match: { business: bId, agent: { $exists: true, $ne: null } } },
        { $group: { _id: "$agent", dealCount: { $sum: 1 } } },
      ]),
    ]);
    const statsMap     = Object.fromEntries(statsRaw.map((s) => [s._id, { count: s.count, avgRate: s.avgRate }]));
    const dealCountMap = Object.fromEntries(dealCountsRaw.map((d) => [String(d._id), d.dealCount]));
    const stats = {
      active:   statsMap.active   || { count: 0, avgRate: 0 },
      inactive: statsMap.inactive || { count: 0, avgRate: 0 },
    };
    const data = agents.map((a) => ({ ...a, dealCount: dealCountMap[String(a._id)] || 0 }));
    res.status(200).json({ data, total, page: pageNum, pages: Math.ceil(total / limitNum) || 1, stats });
  } catch (err) {
    next(err);
  }
};

export const getAgent = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const agent = await SaleAgent.findOne({ _id: req.params.id, business }).lean();
    if (!agent) return next(createError(404, "Agent not found"));
    res.status(200).json(agent);
  } catch (err) {
    next(err);
  }
};

export const createAgent = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const agentNumber = await generateSequentialNumber(SaleAgent, business, "AGT");
    const agent = await SaleAgent.create({
      ...req.body,
      business,
      agentNumber,
      createdBy: userId,
      updatedBy: userId,
    });
    res.status(201).json(agent);
  } catch (err) {
    next(err);
  }
};

export const updateAgent = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const { business: _b, agentNumber: _n, createdBy: _c, ...updates } = req.body;
    const agent = await SaleAgent.findOneAndUpdate(
      { _id: req.params.id, business },
      { ...updates, updatedBy: userId },
      { new: true, runValidators: true }
    );
    if (!agent) return next(createError(404, "Agent not found"));
    res.status(200).json(agent);
  } catch (err) {
    next(err);
  }
};

export const deleteAgent = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const agent = await SaleAgent.findOne({ _id: req.params.id, business });
    if (!agent) return next(createError(404, "Agent not found"));

    const [deals, commissions, offers] = await Promise.all([
      SaleDeal.countDocuments({ business, agent: agent._id }),
      SaleCommission.countDocuments({ business, agent: agent._id }),
      SaleOffer.countDocuments({ business, agent: agent._id }),
    ]);
    if (deals > 0 || commissions > 0 || offers > 0) {
      return next(createError(400, `Cannot delete agent with existing records (${deals} deals, ${commissions} commissions, ${offers} offers)`));
    }

    await agent.deleteOne();
    res.status(200).json({ message: "Agent deleted" });
  } catch (err) {
    next(err);
  }
};
