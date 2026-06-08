import { createError } from "../../../utils/error.js";
import SaleAgent from "../models/SaleAgent.js";
import { currentUserId, generateSequentialNumber, resolveActiveBusinessId } from "../services/businessScope.js";

export const listAgents = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { search = "", status = "", page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
    const filter = { business };
    if (status) filter.status = status;
    if (search.trim()) {
      filter.$text = { $search: search.trim() };
    }
    const [agents, total] = await Promise.all([
      SaleAgent.find(filter).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
      SaleAgent.countDocuments(filter),
    ]);
    res.status(200).json({ data: agents, total, page: pageNum, pages: Math.ceil(total / limitNum) || 1 });
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
    await agent.deleteOne();
    res.status(200).json({ message: "Agent deleted" });
  } catch (err) {
    next(err);
  }
};
