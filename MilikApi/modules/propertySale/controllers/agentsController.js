import { createError } from "../../../utils/error.js";
import SaleAgent from "../models/SaleAgent.js";
import { currentUserId, escapeRegex, generateSequentialNumber, resolveActiveBusinessId } from "../services/businessScope.js";

export const listAgents = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { search = "", status = "" } = req.query;
    const filter = { business };
    if (status) filter.status = status;
    if (search.trim()) {
      const rx = new RegExp(escapeRegex(search.trim()), "i");
      filter.$or = [{ fullName: rx }, { agentNumber: rx }, { phone: rx }, { email: rx }];
    }
    const agents = await SaleAgent.find(filter).sort({ createdAt: -1 }).lean();
    res.status(200).json(agents);
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
