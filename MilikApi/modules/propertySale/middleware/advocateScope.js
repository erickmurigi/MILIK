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
 * Sets, for a logged-in user who is linked to a SaleAdvocate (listed in SaleAdvocate.userIds — a firm can
 * have several people, all scoped identically to the same firm):
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

    const advocate = await SaleAdvocate.findOne({ business: businessId, userIds: userId }).select("_id").lean();
    if (!advocate) return next();

    req.saleAdvocateId = String(advocate._id);
    return next();
  } catch (err) {
    return next(err);
  }
};

// Ids of the listings behind deals explicitly assigned to this advocate (SaleDeal.advocate) — even when
// neither the listing nor its project defaults to them. An advocate handling a specific deal needs to see
// that unit (and, via ownAdvocateProjectIds, its project/owner) on their own Listings/Units/Owner pages,
// not just the Deals page — the deal-level assignment is the strongest signal of "this is their work."
const ownDealListingIds = async (req, business) =>
  req.saleAdvocateId ? SaleDeal.distinct("listing", { business, advocate: req.saleAdvocateId }) : [];

const dedupeIds = (ids) => {
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    const key = String(id);
    if (!seen.has(key)) { seen.add(key); out.push(id); }
  }
  return out;
};

// Ids of listings this advocate is the DEFAULT for (via their project's assignedAdvocate, or — for a
// standalone listing with no project — the listing's own assignedAdvocate), UNION the listings behind
// their own explicitly-assigned deals (ownDealListingIds). The default layer is still what
// ownAdvocateDealIds/advocateProjectFilter fall back to for a deal with no advocate of its own; this
// union is the other direction — surfacing a listing because a deal on it names this advocate, even
// when the listing/project itself has no default. null when the caller is unscoped.
export const ownListingIds = async (req, business) => {
  if (!req.saleAdvocateId) return null;
  const projectIds = await SaleProject.distinct("_id", { business, assignedAdvocate: req.saleAdvocateId });
  const [defaultListingIds, dealListingIds] = await Promise.all([
    SaleListing.distinct("_id", {
      business,
      $or: [
        { project: { $in: projectIds } },
        { project: null, assignedAdvocate: req.saleAdvocateId },
      ],
    }),
    ownDealListingIds(req, business),
  ]);
  return dedupeIds([...defaultListingIds, ...dealListingIds]);
};

// Ids of the scoped advocate's own deals — a deal explicitly assigned to them (SaleDeal.advocate),
// or (when the deal has no advocate of its own) one sitting under a project/listing they're the
// default for. A deal explicitly assigned to a DIFFERENT advocate is excluded even if it sits in this
// advocate's default project/listing — the deal-level value always wins once set. null when unscoped.
export const ownAdvocateDealIds = async (req, business) => {
  if (!req.saleAdvocateId) return null;
  const listingIds = await ownListingIds(req, business);
  return SaleDeal.distinct("_id", {
    business,
    $or: [
      { advocate: req.saleAdvocateId },
      { advocate: null, listing: { $in: listingIds } },
    ],
  });
};

// Query fragment restricting a deal lookup to the scoped advocate's own deals (see ownAdvocateDealIds
// for the exact override rule); empty for everyone else. `field` names the deal's listing-reference
// path (always "listing" today — every current caller queries SaleDeal directly).
export const advocateProjectFilter = async (req, business, field = "listing") => {
  if (!req.saleAdvocateId) return {};
  const listingIds = await ownListingIds(req, business);
  return {
    $or: [
      { advocate: req.saleAdvocateId },
      { advocate: null, [field]: { $in: listingIds } },
    ],
  };
};

// Buyer ids reachable through the scoped advocate's own deals (see ownAdvocateDealIds). null when unscoped.
export const ownAdvocateBuyerIds = async (req, business) => {
  if (!req.saleAdvocateId) return null;
  const dealIds = await ownAdvocateDealIds(req, business);
  return SaleDeal.distinct("buyer", { _id: { $in: dealIds } });
};

// Generic "restrict this model's `field` to the scoped advocate's own deals" filter fragment, for
// models that reference SaleDeal directly (SaleCommission and its payout events). {} for everyone else.
export const advocateDealScopeFilter = async (req, business, field = "deal") => {
  if (!req.saleAdvocateId) return {};
  const dealIds = await ownAdvocateDealIds(req, business);
  return { [field]: { $in: dealIds } };
};

// Ids of projects this advocate is the assigned default for, UNION the projects behind their own
// explicitly-assigned deals' listings (same "deal assignment surfaces the project/owner too" rule as
// ownListingIds). Used by controllers that key off project rather than listing (owner statements,
// owners' own project counts). null when the caller is unscoped.
export const ownAdvocateProjectIds = async (req, business) => {
  if (!req.saleAdvocateId) return null;
  const [defaultProjectIds, dealListingIds] = await Promise.all([
    SaleProject.distinct("_id", { business, assignedAdvocate: req.saleAdvocateId }),
    ownDealListingIds(req, business),
  ]);
  const dealProjectIds = dealListingIds.length
    ? await SaleListing.distinct("project", { business, _id: { $in: dealListingIds }, project: { $ne: null } })
    : [];
  return dedupeIds([...defaultProjectIds, ...dealProjectIds]);
};
