import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import SaleOwnerCommission from "../models/SaleOwnerCommission.js";
import SaleAgencyCommissionPayout from "../models/SaleAgencyCommissionPayout.js";
import SaleDeal from "../models/SaleDeal.js";
import SaleSettings from "../models/SaleSettings.js";
import { round2 } from "../../../utils/math.js";
import { currentUserId, resolveActiveBusinessId } from "../services/businessScope.js";
import { recalculateOwnerCommission, RECALC_ELIGIBLE_STATUSES } from "../services/commissionRecalculateService.js";
import { advocateDealScopeFilter } from "../middleware/advocateScope.js";
import { andInto } from "../services/saleSearch.js";
import { tiersProblem } from "./settingsController.js";

// Deferred-amount / outstanding readout attached to each commission row — same math as
// agencyCommissionOutstanding.js but joined onto the full list here (including non-deferred and
// fully-paid commissions) so the page can show a "Pay" action without a second round trip. Also resolves
// which advocate the payout should be attributed to, using the EXACT SAME deal->advocate rule
// ownAdvocateDealIds (middleware/advocateScope.js) uses in reverse (advocate->deals) — a deal's own
// explicit SaleDeal.advocate, else its listing's assignedAdvocate, else that listing's project's — so a
// payout created from this id always lands inside that advocate's own dealIdsForAdvocate() scope and the
// controller's own ownership check never rejects it.
const attachAgencyPayoutStatus = async (business, commissions) => {
  const deferredCommissions = commissions.filter((c) => (c.tierReleases || []).some((t) => t.deferred));
  const deferredIds = deferredCommissions.map((c) => c._id);
  let paidByCommission = new Map();
  let advocateByDeal = new Map();
  if (deferredIds.length) {
    const dealIds = [...new Set(deferredCommissions.map((c) => String(c.deal?._id || c.deal)))].map(toObjectId);
    const [paidRows, deals] = await Promise.all([
      SaleAgencyCommissionPayout.aggregate([
        { $match: { business: toObjectId(business), status: { $ne: "cancelled" } } },
        { $unwind: "$allocations" },
        { $match: { "allocations.ownerCommission": { $in: deferredIds } } },
        { $group: { _id: "$allocations.ownerCommission", total: { $sum: "$allocations.amount" } } },
      ]),
      SaleDeal.find({ business, _id: { $in: dealIds } })
        .select("advocate listing")
        .populate({ path: "listing", select: "assignedAdvocate project", populate: { path: "project", select: "assignedAdvocate" } })
        .lean(),
    ]);
    paidByCommission = new Map(paidRows.map((r) => [String(r._id), round2(r.total || 0)]));
    advocateByDeal = new Map(deals.map((d) => [
      String(d._id),
      d.advocate || d.listing?.assignedAdvocate || d.listing?.project?.assignedAdvocate || null,
    ]));
  }
  return commissions.map((c) => {
    const deferredAmount = round2((c.tierReleases || []).filter((t) => t.deferred).reduce((s, t) => s + Number(t.amount || 0), 0));
    const agencyPaidAmount = paidByCommission.get(String(c._id)) || 0;
    const dealId = String(c.deal?._id || c.deal);
    return {
      ...c,
      deferredAmount,
      agencyPaidAmount,
      agencyOutstanding: round2(Math.max(0, deferredAmount - agencyPaidAmount)),
      trustAdvocate: deferredAmount > 0 ? advocateByDeal.get(dealId) || null : null,
    };
  });
};

const toObjectId = (v) => new mongoose.Types.ObjectId(String(v));

const populateOwnerCommission = (query) =>
  query
    .populate("deal", "dealNumber agreedPrice status")
    .populate("owner", "fullName ownerNumber phone")
    .populate("listing", "title listingNumber")
    .populate("buyer", "fullName buyerNumber");

// Read-only: the company's own agency commission has no manual approve/pay/reverse action anywhere —
// it's either auto-recognized in full at deal creation (no release tiers configured) or accrues
// tier-by-tier automatically as the buyer pays (commissionReleaseService.applyTierCrossings), and is
// only ever reversed/cancelled as a side effect of cancelling the deal itself (dealsController.cancelDeal).
export const listOwnerCommissions = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { ownerId = "", status = "", dealId = "", search = "", dateFrom = "", dateTo = "" } = req.query;
    const page  = Math.max(Number(req.query.page  || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const filter = { business };
    if (ownerId) filter.owner = ownerId;
    if (status) {
      filter.status = status.includes(",") ? { $in: status.split(",").map((s) => s.trim()).filter(Boolean) } : status;
    } else if (req.query?.includeCancelled !== "true") {
      filter.status = { $ne: "cancelled" };
    }
    if (dealId) filter.deal = dealId;
    if (search.trim()) filter.commissionNumber = { $regex: search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo)   filter.createdAt.$lte = new Date(dateTo + "T23:59:59.999Z");
    }
    // advocate-scoped user (mandatory, ungated) can only see agency commissions on their own deals
    const advocateFilter = req.saleAdvocateId ? await advocateDealScopeFilter(req, business) : null;
    if (advocateFilter) andInto(filter, advocateFilter);

    const statsMatch = { business: toObjectId(business), ...(filter.owner && { owner: toObjectId(filter.owner) }), ...(filter.deal && { deal: toObjectId(filter.deal) }) };
    if (advocateFilter) andInto(statsMatch, advocateFilter);

    const [commissions, total, statsRaw] = await Promise.all([
      populateOwnerCommission(SaleOwnerCommission.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)).lean(),
      SaleOwnerCommission.countDocuments(filter),
      SaleOwnerCommission.aggregate([
        { $match: statsMatch },
        { $group: { _id: "$status", count: { $sum: 1 }, totalAmount: { $sum: "$commissionAmount" } } },
      ]),
    ]);

    const statsMap = Object.fromEntries(statsRaw.map((s) => [s._id, { count: s.count, amount: s.totalAmount }]));
    const stats = {
      pending:   statsMap.pending   || { count: 0, amount: 0 },
      approved:  statsMap.approved  || { count: 0, amount: 0 },
      cancelled: statsMap.cancelled || { count: 0, amount: 0 },
    };

    const enriched = await attachAgencyPayoutStatus(business, commissions);
    res.status(200).json({ data: enriched, total, page, pages: Math.ceil(total / limit), stats });
  } catch (err) {
    next(err);
  }
};

export const getOwnerCommission = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const advocateFilter = req.saleAdvocateId ? await advocateDealScopeFilter(req, business) : {};
    const commission = await populateOwnerCommission(SaleOwnerCommission.findOne({ _id: req.params.id, business, ...advocateFilter })).lean();
    if (!commission) return next(createError(404, "Agency commission not found"));
    const [enriched] = await attachAgencyPayoutStatus(business, [commission]);
    res.status(200).json(enriched);
  } catch (err) {
    next(err);
  }
};

// Manual, single-commission escape hatch on top of the automatic bulk resync that already fires on every
// updateOwnerCommissionDefaults save (settingsController.js) — kept for retrying one specific commission
// if a GL error excluded it from that bulk pass. Simpler than the broker version: an owner commission
// never has a separate "legacy accrual" posting — even the immediate, non-staged case is stored as a
// single synthetic 100% tier in tierReleases, so every case reverses/reposts the same way. Never
// "cancelled" (terminal) or "paid" (this model has no paid status at all).
export const recalculateOwnerCommissionRate = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);

    const advocateFilter = req.saleAdvocateId ? await advocateDealScopeFilter(req, business) : {};
    const commission = await SaleOwnerCommission.findOne({ _id: req.params.id, business, ...advocateFilter });
    if (!commission) return next(createError(404, "Agency commission not found"));
    if (!RECALC_ELIGIBLE_STATUSES.has(commission.status)) {
      return next(createError(400, `Only a pending or approved agency commission can be recalculated (this one is "${commission.status}")`));
    }

    const settings = await SaleSettings.findOne({ business }).select("ownerCommissionDefaults").lean();
    const rate = Number(settings?.ownerCommissionDefaults?.rate ?? 3);
    const commissionType = settings?.ownerCommissionDefaults?.commissionType || "percentage";

    try {
      await recalculateOwnerCommission({ businessId: business, commission, rate, commissionType, userId });
    } catch (glErr) {
      return next(createError(422, `GL reversal/re-posting failed while recalculating: ${glErr.message}. Check this commission's ledger entries before retrying.`));
    }

    const populated = await populateOwnerCommission(SaleOwnerCommission.findById(commission._id)).lean();
    res.status(200).json(populated);
  } catch (err) {
    next(err);
  }
};

// Deal-level release-schedule override for the owner (agency) commission — mirrors
// commissionsController.updateCommissionReleaseScheduleOverride; see its comment for the gating rationale.
export const updateOwnerCommissionReleaseScheduleOverride = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);

    const advocateFilter = req.saleAdvocateId ? await advocateDealScopeFilter(req, business) : {};
    const commission = await SaleOwnerCommission.findOne({ _id: req.params.id, business, ...advocateFilter });
    if (!commission) return next(createError(404, "Agency commission not found"));
    if (!["pending", "approved"].includes(commission.status)) {
      return next(createError(400, `Only a pending or approved agency commission can have its release schedule changed (this one is "${commission.status}")`));
    }
    if (commission.tierReleases.length > 0) {
      return next(createError(400, "This commission has already released at least one tier — its schedule can no longer be changed"));
    }

    if (req.body.clear) {
      const settings = await SaleSettings.findOne({ business }).select("commissionReleaseSchedule").lean();
      const schedule = settings?.commissionReleaseSchedule;
      commission.releaseSchedule = Boolean(schedule?.enabled) ? (schedule?.ownerCommissionTiers ?? []) : [];
      commission.releaseScheduleOverridden = false;
    } else {
      const tiers = Array.isArray(req.body.tiers) ? req.body.tiers : [];
      const problem = tiersProblem(tiers, "Release schedule tiers");
      if (problem) return next(createError(400, problem));
      commission.releaseSchedule = tiers.map((t) => ({ thresholdPct: Number(t.thresholdPct), releasePct: Number(t.releasePct) }));
      commission.releaseScheduleOverridden = true;
    }
    commission.updatedBy = userId;
    await commission.save();

    const populated = await populateOwnerCommission(SaleOwnerCommission.findById(commission._id)).lean();
    res.status(200).json(populated);
  } catch (err) {
    next(err);
  }
};
