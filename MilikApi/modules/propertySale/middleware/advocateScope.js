import mongoose from "mongoose";
import SaleAdvocate from "../models/SaleAdvocate.js";
import SaleProject from "../models/SaleProject.js";
import SaleDeal from "../models/SaleDeal.js";
import SaleListing from "../models/SaleListing.js";
import { currentUserId, resolveBusinessId } from "../../../utils/requestContext.js";

/**
 * Analogous to middleware/agentScope.js, but deliberately MANDATORY and ungated — unlike agent scoping
 * (which only restricts agent-linked users when SaleSettings.agentVisibility === "own"), an advocate-linked
 * user is ALWAYS restricted to their own assigned project(s). There is no setting to turn this off: an
 * advocate must never see another project's deals, buyers, payments or any commission data, full stop.
 *
 * Sets, for a logged-in user who is linked to a SaleAdvocate (SaleAdvocate.userId):
 *   req.saleAdvocateId - that advocate's id, whenever the user is advocate-linked (always scoped, never null
 *                        just because of a company setting). null for everyone else (admins/managers/agents).
 *
 * - Business id is resolved exactly like the controllers do (headers, body, query, own company), so
 *   header-only requests are scoped too.
 * - Users with no SaleAdvocate link, system-admin sessions with a non-ObjectId id, or requests with no
 *   resolvable business stay unscoped (null).
 * - FAIL CLOSED: if a lookup errors, the error is propagated (never silently granting full visibility).
 */
export const attachAdvocateScope = async (req, _res, next) => {
  try {
    req.saleAdvocateId = null;
    const userId     = currentUserId(req);
    const businessId = resolveBusinessId(req);
    if (!userId || !businessId || !mongoose.Types.ObjectId.isValid(businessId)) return next();

    const advocate = await SaleAdvocate.findOne({ business: businessId, userId }).select("_id").lean();
    if (!advocate) return next();

    req.saleAdvocateId = String(advocate._id);
    return next();
  } catch (err) {
    return next(err);
  }
};

// Ids of the projects assigned to the scoped advocate, or null when the caller is unscoped.
const ownProjectIds = (req, business) =>
  req.saleAdvocateId ? SaleProject.distinct("_id", { business, assignedAdvocate: req.saleAdvocateId }) : null;

// Ids of the scoped advocate's own deals (deals whose listing sits under one of their assigned projects),
// or null when the caller is unscoped. Used to scope records that belong to a deal (payments, schedule items).
export const ownAdvocateDealIds = async (req, business) => {
  if (!req.saleAdvocateId) return null;
  const projectIds = await ownProjectIds(req, business);
  if (!projectIds?.length) return [];
  const listingIds = await SaleListing.distinct("_id", { business, project: { $in: projectIds } });
  if (!listingIds.length) return [];
  return SaleDeal.distinct("_id", { business, listing: { $in: listingIds } });
};

// Query fragment restricting a deal lookup to the scoped advocate's own projects; empty for everyone else.
export const advocateProjectFilter = async (req, business, field = "listing") => {
  if (!req.saleAdvocateId) return {};
  const projectIds = await ownProjectIds(req, business);
  if (!projectIds?.length) return { _id: null }; // no assigned projects -> match nothing
  const listingIds = await SaleListing.distinct("_id", { business, project: { $in: projectIds } });
  return { [field]: { $in: listingIds } };
};
