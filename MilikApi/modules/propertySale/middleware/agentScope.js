import SaleAgent from "../models/SaleAgent.js";

/**
 * Attaches req.saleAgentId if the logged-in user is linked to a SaleAgent
 * via SaleAgent.userId. Downstream controllers check this to scope queries.
 */
export const attachAgentScope = async (req, _res, next) => {
  try {
    const userId     = req.user?._id;
    const businessId = req.query?.business || req.body?.business;
    if (!userId || !businessId) return next();

    const agent = await SaleAgent.findOne({ business: businessId, userId }).select("_id").lean();
    if (agent) req.saleAgentId = String(agent._id);
  } catch (_) {
    // non-blocking — if lookup fails, agent sees all (fail-open for UX)
  }
  next();
};
