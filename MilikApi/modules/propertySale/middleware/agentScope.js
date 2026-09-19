import mongoose from "mongoose";
import SaleAgent from "../models/SaleAgent.js";
import { currentUserId, resolveBusinessId } from "../../../utils/requestContext.js";

/**
 * Attaches req.saleAgentId if the logged-in user is linked to a SaleAgent
 * via SaleAgent.userId. Downstream controllers check this to scope queries.
 *
 * - Business id is resolved exactly like the controllers do (headers, body,
 *   query, own company — with entitlement checks), so header-only requests
 *   are scoped too.
 * - Users with no SaleAgent link (admins/managers), system-admin sessions with
 *   a non-ObjectId id, or requests with no resolvable business stay unscoped.
 * - FAIL CLOSED: if the SaleAgent lookup itself errors, the error is
 *   propagated (never silently granting an agent full visibility).
 */
export const attachAgentScope = async (req, _res, next) => {
  try {
    const userId     = currentUserId(req);
    const businessId = resolveBusinessId(req);
    if (!userId || !businessId || !mongoose.Types.ObjectId.isValid(businessId)) return next();

    const agent = await SaleAgent.findOne({ business: businessId, userId }).select("_id").lean();
    if (agent) req.saleAgentId = String(agent._id);
    return next();
  } catch (err) {
    return next(err);
  }
};
