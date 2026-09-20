import mongoose from "mongoose";
import SaleAgent from "../models/SaleAgent.js";
import SaleSettings from "../models/SaleSettings.js";
import SaleDeal from "../models/SaleDeal.js";
import SaleLead from "../models/SaleLead.js";
import { currentUserId, resolveBusinessId } from "../../../utils/requestContext.js";

// Company-wide switch (Sale Settings -> agentVisibility): "own" (default) keeps agent-linked users to their own
// records, "all" lets them see the whole business. Cached briefly per business; the settings endpoint clears it.
const VISIBILITY_TTL_MS = 30_000;
const visibilityCache = new Map();
export const invalidateAgentVisibilityCache = (business) => visibilityCache.delete(String(business));

const getAgentVisibility = async (business) => {
  const key = String(business);
  const hit = visibilityCache.get(key);
  if (hit && Date.now() - hit.at < VISIBILITY_TTL_MS) return hit.mode;
  const settings = await SaleSettings.findOne({ business }).select("agentVisibility").lean();
  const mode = settings?.agentVisibility === "all" ? "all" : "own";
  visibilityCache.set(key, { mode, at: Date.now() });
  return mode;
};

/**
 * Sets, for a logged-in user who is linked to a SaleAgent (SaleAgent.userId):
 *   req.saleAgentSelf - that agent's id, always (used for rules that hold in every mode, e.g. no self-approval)
 *   req.saleAgentId   - that agent's id ONLY when the company keeps agents to their own records; null otherwise.
 *                       Downstream controllers scope queries on this.
 *
 * - Business id is resolved exactly like the controllers do (headers, body, query, own company - with
 *   entitlement checks), so header-only requests are scoped too.
 * - Users with no SaleAgent link (admins/managers), system-admin sessions with a non-ObjectId id, or requests
 *   with no resolvable business stay unscoped (both null).
 * - FAIL CLOSED: if a lookup errors, the error is propagated (never silently granting full visibility).
 */
export const attachAgentScope = async (req, _res, next) => {
  try {
    req.saleAgentSelf = null;
    req.saleAgentId   = null;
    const userId     = currentUserId(req);
    const businessId = resolveBusinessId(req);
    if (!userId || !businessId || !mongoose.Types.ObjectId.isValid(businessId)) return next();

    const agent = await SaleAgent.findOne({ business: businessId, userId }).select("_id").lean();
    if (!agent) return next();

    req.saleAgentSelf = String(agent._id);
    if ((await getAgentVisibility(businessId)) === "own") req.saleAgentId = req.saleAgentSelf;
    return next();
  } catch (err) {
    return next(err);
  }
};

/**
 * Query fragment restricting a lookup to the caller's own records when they are an agent-scoped user;
 * empty for admins/managers (and for agents when the company shows agents everything). Spread into a filter:
 *   Model.findOne({ _id, business, ...agentFilter(req, 'assignedAgent') })
 */
export const agentFilter = (req, field = "agent") => (req.saleAgentId ? { [field]: req.saleAgentId } : {});

// Ids of the scoped agent's own deals / leads, or null when the caller is unscoped. Used to scope records that
// belong to a deal or lead (payments, schedule items, activities, report figures).
export const ownDealIds = async (req, business) =>
  req.saleAgentId ? SaleDeal.distinct("_id", { business, agent: req.saleAgentId }) : null;
export const ownLeadIds = async (req, business) =>
  req.saleAgentId ? SaleLead.distinct("_id", { business, assignedAgent: req.saleAgentId }) : null;
