import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import SaleCommission from "../models/SaleCommission.js";
import SaleAgent from "../models/SaleAgent.js";
import SaleAdvocate from "../models/SaleAdvocate.js";
import SaleDeal from "../models/SaleDeal.js";
import { currentUserId, resolveActiveBusinessId } from "../services/businessScope.js";
import { dealAdvocateTrustBalance } from "../services/dealProgress.js";
import { recalculateBrokerCommission, RECALC_ELIGIBLE_STATUSES } from "../services/commissionRecalculateService.js";
import {
  postPropertySaleCommissionAccrual,
  postPropertySaleCommissionPayout,
  postPropertySaleCommissionTierRelease,
  reversePropertySaleCommissionAccrual,
  reversePropertySaleCommissionTierRelease,
  reversePropertySaleCommissionPayout,
  postPropertySaleCommissionClawbackOnCancellation,
  resolveWhtHandler,
} from "../services/propertySaleAccountingService.js";
import { round2 } from "../../../utils/math.js";
import { defaultWhtRate } from "./dealsController.js";
import { tiersProblem } from "./settingsController.js";
import SaleSettings from "../models/SaleSettings.js";
import { claimPaymentReference, releasePaymentReference } from "../../../services/paymentReferenceGuard.js";
import { advocateDealScopeFilter } from "../middleware/advocateScope.js";
import { andInto } from "../services/saleSearch.js";

// The advocate this deal belongs to — explicit SaleDeal.advocate override, else (for a listing that
// belongs to a project) the project's assignedAdvocate, else the listing's own assignedAdvocate (for a
// standalone listing with no project). Same precedence middleware/advocateScope.js uses for visibility
// scoping — a listing's own assignedAdvocate is ignored once it belongs to a project (SaleListing.js).
// Used by resolveWhtHandler: a deal that resolves to an advocate this way means the project (or
// deal/listing) is advocate-managed, which defaults WHT responsibility to that advocate.
const resolveDealAdvocate = async (business, dealId) => {
  const deal = await SaleDeal.findOne({ _id: dealId, business })
    .select("advocate listing")
    .populate({ path: "listing", select: "assignedAdvocate project", populate: { path: "project", select: "assignedAdvocate" } })
    .lean();
  const advocateId =
    deal?.advocate ||
    (deal?.listing?.project ? deal.listing.project.assignedAdvocate : deal?.listing?.assignedAdvocate) ||
    null;
  if (!advocateId) return null;
  return SaleAdvocate.findOne({ _id: advocateId, business }).select("whtHandledBy").lean();
};

const resolveCashbook = async (businessId, cashbookId) => {
  if (!cashbookId || !mongoose.isValidObjectId(String(cashbookId))) return null;
  return ChartOfAccount.findOne({
    _id: cashbookId,
    business: businessId,
    isPosting: { $ne: false },
    isHeader:  { $ne: true },
  }).lean();
};

// Exported for saleReportPdfData.js (Reports Center PDF generator) — reuses the exact same populate
// shape rather than re-deriving it.
export const populateCommission = (query) =>
  query
    .populate("deal", "dealNumber agreedPrice status")
    .populate("agent", "fullName agentNumber phone")
    .populate("listing", "title listingNumber")
    .populate("buyer", "fullName buyerNumber");

// State machine: which transitions are permitted
const ALLOWED_TRANSITIONS = {
  pending:   ["approved", "cancelled"],
  approved:  ["paid", "cancelled"],
  paid:      ["reversed"],
  cancelled: [],
  reversed:  ["cancelled"],
};

// Agent scope for the caller (set router-wide by attachAgentScope, and only when the company keeps agents to
// their own records): the agent id as a string, or null for admins/managers and when visibility is "all".
const resolveAgentScope = async (req) => (req.saleAgentId ? String(req.saleAgentId) : null);

const toObjectId = (v) => new mongoose.Types.ObjectId(String(v));

export const listCommissions = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { agentId = "", status = "", dealId = "", search = "", dateFrom = "", dateTo = "" } = req.query;
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const filter = { business };
    const scopedAgentId = await resolveAgentScope(req, business);
    if (scopedAgentId) filter.agent = scopedAgentId;
    else if (agentId)  filter.agent = agentId;
    if (status) {
      // Mobile's "Commissions due" view needs pending+approved together (matches the dashboard
      // tile's definition of "due"); comma-separated values become an $in instead of one status.
      filter.status = status.includes(",") ? { $in: status.split(",").map((s) => s.trim()).filter(Boolean) } : status;
    } else if (req.query?.includeCancelled !== "true") {
      // cancelled/reversed commissions are kept for the audit trail but stay out of the working list unless asked for
      filter.status = { $nin: ["cancelled", "reversed"] };
    }
    if (dealId)  filter.deal = dealId;
    if (search.trim()) filter.commissionNumber = { $regex: search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo)   filter.createdAt.$lte = new Date(dateTo + "T23:59:59.999Z");
    }
    // advocate-scoped user (mandatory, ungated) can only see commissions on their own deals
    const advocateFilter = req.saleAdvocateId ? await advocateDealScopeFilter(req, business) : null;
    if (advocateFilter) andInto(filter, advocateFilter);

    const [commissions, total, statsRaw] = await Promise.all([
      populateCommission(SaleCommission.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)).lean(),
      SaleCommission.countDocuments(filter),
      SaleCommission.aggregate([
        // aggregate() does not cast — ids must be real ObjectIds. Gate on the EFFECTIVE filter.agent
        // (set for agent-scoped users even with no agentId query param), not the raw query string — same
        // for the advocate's own deal ids, so the summary tiles stay scoped exactly like the list itself.
        // Built as an $and of separate clauses (not one merged object) so a dealId query param and the
        // advocate's own-deal $in don't collide on the same "deal" key.
        { $match: { $and: [
          { business: toObjectId(business) },
          ...(filter.agent ? [{ agent: toObjectId(filter.agent) }] : []),
          ...(filter.deal ? [{ deal: toObjectId(filter.deal) }] : []),
          ...(advocateFilter?.deal ? [{ deal: { $in: advocateFilter.deal.$in.map(toObjectId) } }] : []),
        ] } },
        { $group: { _id: "$status", count: { $sum: 1 }, totalAmount: { $sum: "$commissionAmount" } } },
      ]),
    ]);

    const statsMap = Object.fromEntries(statsRaw.map((s) => [s._id, { count: s.count, amount: s.totalAmount }]));
    const stats = {
      pending:  statsMap.pending  || { count: 0, amount: 0 },
      approved: statsMap.approved || { count: 0, amount: 0 },
      paid:     statsMap.paid     || { count: 0, amount: 0 },
      cancelled: statsMap.cancelled || { count: 0, amount: 0 },
    };

    res.status(200).json({ data: commissions, total, page, pages: Math.ceil(total / limit), stats });
  } catch (err) {
    next(err);
  }
};

// One row per actual disbursement, not per commission — a commission paid off across several partial
// payouts must show every tranche here, even while it's still "approved" (not yet fully settled).
// Fetches candidate commissions (with at least one payout) then flattens/paginates in JS rather than an
// aggregation $unwind pipeline — simpler to read and plenty fast at this domain's realistic volumes.
export const listCommissionPayoutEvents = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { agentId = "", dealId = "", search = "", dateFrom = "", dateTo = "" } = req.query;
    const page  = Math.max(Number(req.query.page  || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);

    const filter = { business, "payouts.0": { $exists: true } };
    const scopedAgentId = await resolveAgentScope(req, business);
    if (scopedAgentId) filter.agent = scopedAgentId;
    else if (agentId)  filter.agent = agentId;
    if (dealId) filter.deal = dealId;
    if (search.trim()) filter.commissionNumber = { $regex: search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    // advocate-scoped user (mandatory, ungated) can only see payout events on their own deals
    if (req.saleAdvocateId) andInto(filter, await advocateDealScopeFilter(req, business));

    const commissions = await populateCommission(SaleCommission.find(filter)).lean();

    let events = commissions.flatMap((c) => {
      const lastId = c.payouts[c.payouts.length - 1]?._id;
      return c.payouts.map((p) => ({
        _id: p._id,
        commissionId: c._id,
        commissionNumber: c.commissionNumber,
        commissionStatus: c.status,
        agent: c.agent,
        deal: c.deal,
        listing: c.listing,
        amount: p.amount,
        whtAmount: p.whtAmount,
        netAmount: p.netAmount,
        method: p.method,
        date: p.date,
        reference: p.reference,
        source: p.source,
        whtHandledBy: p.whtHandledBy,
        // Reversal is all-or-nothing on the parent commission — only surface the action once, on its
        // most recent tranche, and only once the commission is actually fully settled.
        isReversible: c.status === "paid" && String(p._id) === String(lastId),
      }));
    });

    if (dateFrom) { const from = new Date(dateFrom); events = events.filter((e) => new Date(e.date) >= from); }
    if (dateTo)   { const to = new Date(dateTo + "T23:59:59.999Z"); events = events.filter((e) => new Date(e.date) <= to); }

    events.sort((a, b) => new Date(b.date) - new Date(a.date));

    const total = events.length;
    const paged = events.slice((page - 1) * limit, (page - 1) * limit + limit);

    res.status(200).json({ data: paged, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) {
    next(err);
  }
};

export const getCommission = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const scopedAgentId = await resolveAgentScope(req, business);
    const filter = { _id: req.params.id, business, ...(scopedAgentId && { agent: scopedAgentId }) };
    if (req.saleAdvocateId) andInto(filter, await advocateDealScopeFilter(req, business));
    const commission = await populateCommission(SaleCommission.findOne(filter)).lean();
    if (!commission) return next(createError(404, "Commission not found"));
    res.status(200).json(commission);
  } catch (err) {
    next(err);
  }
};

export const updateCommissionStatus = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const { status, payoutDate, payoutMethod, payoutReference, cashbook, notes } = req.body;

    // In "own" visibility mode an agent-scoped user can't even see other agents' commissions (404, not 403,
    // to avoid leaking existence)
    const scopedAgentId = await resolveAgentScope(req, business);
    const oldCommission = await SaleCommission.findOne({ _id: req.params.id, business, ...(scopedAgentId && { agent: scopedAgentId }) }).lean();
    if (!oldCommission) return next(createError(404, "Commission not found"));
    // In every visibility mode an agent can never approve, pay or reverse their OWN commission (finance/management only)
    if (req.saleAgentSelf && String(oldCommission.agent) === req.saleAgentSelf) {
      return next(createError(403, "Agents cannot change the status of their own commissions"));
    }

    const allowed = ALLOWED_TRANSITIONS[oldCommission.status] ?? [];
    if (!allowed.includes(status)) {
      return next(createError(400, `Cannot transition commission from "${oldCommission.status}" to "${status}"`));
    }

    // "source" (default "company_cashbook" — zero behavior change for every existing caller that
    // doesn't send it): who physically pays the broker. "advocate_trust" means the advocate settles
    // the broker directly out of trust funds they hold for THIS deal — guarded against that deal's own
    // trust balance (dealAdvocateTrustBalance), never the advocate's whole-book balance, so one deal's
    // payout can never draw against money actually collected for a different deal.
    const source = req.body.source === "advocate_trust" ? "advocate_trust" : "company_cashbook";
    let whtHandledBy = "agent";

    let payoutEntry = null;
    let willBeFullyPaid = false;
    const mongoUpdate = { $set: { updatedBy: userId } };
    if (status === "paid") {
      if (!payoutDate)   return next(createError(400, "Payout date is required when marking a commission as paid"));
      if (!payoutMethod) return next(createError(400, "Payout method is required when marking a commission as paid"));

      const totalAmount  = round2(Number(oldCommission.commissionAmount || 0));
      const alreadyPaid  = round2(Number(oldCommission.paidOutAmount || 0));
      // A staged commission can only ever be paid out up to what's actually RELEASED so far — tier by
      // tier, exactly as each one accrues, never the full commissionAmount ahead of schedule. A
      // non-staged commission (empty releaseSchedule) has its full amount recognized the instant it's
      // approved, so there's no tier ceiling to apply — the old "payable cap = commissionAmount" behavior
      // is unchanged for that case.
      const isStaged = Boolean(oldCommission.releaseSchedule?.length);
      const payableCap = isStaged ? round2(Number(oldCommission.releasedAmount || 0)) : totalAmount;
      const remaining  = round2(payableCap - alreadyPaid);
      if (remaining <= 0) {
        return next(createError(400, isStaged
          ? `Nothing available to pay out yet — only ${payableCap.toLocaleString()} of ${totalAmount.toLocaleString()} has released so far`
          : `This commission has already been fully paid out`));
      }
      // Omitting amount pays off whatever's currently available (not necessarily the whole commission,
      // for a staged one) — today's exact one-shot behavior for any caller that doesn't yet know about
      // partial payouts, now correctly bounded by what's released rather than the eventual total.
      const requestedAmount = req.body.amount != null && req.body.amount !== "" ? round2(Number(req.body.amount)) : remaining;
      if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
        return next(createError(400, "Payout amount must be greater than 0"));
      }
      if (requestedAmount > remaining + 0.01) {
        return next(createError(400, isStaged
          ? `Payout amount (${requestedAmount.toLocaleString()}) exceeds what's released and unpaid so far (${remaining.toLocaleString()})`
          : `Payout amount (${requestedAmount.toLocaleString()}) exceeds the remaining balance of ${remaining.toLocaleString()}`));
      }

      if (source === "advocate_trust") {
        const trust = await dealAdvocateTrustBalance(business, oldCommission.deal);
        if (requestedAmount > trust.available + 0.01) {
          return next(createError(400, `This deal's advocate trust balance is only KES ${trust.available.toLocaleString()} — cannot pay out KES ${requestedAmount.toLocaleString()} from trust funds.`));
        }
        const advocateDoc = await resolveDealAdvocate(business, oldCommission.deal);
        whtHandledBy = await resolveWhtHandler(business, advocateDoc);
      }

      // This slice's proportional share of the commission's total WHT — same "target minus
      // already-withheld" math as newlyCrossedTiers, so every partial payout's WHT sums to exactly
      // whtAmount once the commission is fully paid off, with no stray cent left over.
      const totalWht = round2(Number(oldCommission.whtAmount || 0));
      const alreadyWithheld = round2((oldCommission.payouts || []).reduce((s, p) => s + Number(p.whtAmount || 0), 0));
      const newCumulativePaid = round2(alreadyPaid + requestedAmount);
      const targetWhtAtThisPoint = totalAmount > 0 ? round2(totalWht * (newCumulativePaid / totalAmount)) : 0;
      const thisWht = round2(Math.max(0, targetWhtAtThisPoint - alreadyWithheld));

      payoutEntry = {
        _id: new mongoose.Types.ObjectId(),
        amount: requestedAmount,
        whtAmount: thisWht,
        netAmount: round2(requestedAmount - thisWht),
        method: payoutMethod,
        date: payoutDate,
        reference: payoutReference || "",
        source,
        whtHandledBy,
        createdBy: userId,
        createdAt: new Date(),
      };
      willBeFullyPaid = newCumulativePaid >= totalAmount - 0.01;

      mongoUpdate.$set.status = willBeFullyPaid ? "paid" : "approved";
      mongoUpdate.$set.payoutDate = payoutDate;
      mongoUpdate.$set.payoutMethod = payoutMethod;
      if (payoutReference) mongoUpdate.$set.payoutReference = payoutReference;
      mongoUpdate.$set.payoutSource = source;
      mongoUpdate.$push = { payouts: payoutEntry };
      mongoUpdate.$inc = { paidOutAmount: requestedAmount };
    } else {
      mongoUpdate.$set.status = status;
      // Reversal undoes every payout's GL effect (below) — paidOutAmount must go back to 0 to match,
      // so a re-approved commission starts its payout history clean rather than looking already settled.
      // The `payouts` array itself is left alone as an audit trail of what was disbursed and reversed.
      if (status === "reversed") mongoUpdate.$set.paidOutAmount = 0;
    }
    if (notes) mongoUpdate.$set.notes = notes;

    // Resolve cashbook if provided (used for payout GL credit leg) — never required for an
    // advocate_trust payout, since the credit leg goes to 1314, not a company cashbook.
    let cashbookAcc = null;
    if (status === "paid" && cashbook) {
      cashbookAcc = await resolveCashbook(business, cashbook);
      if (!cashbookAcc) return next(createError(400, "Selected cashbook account not found"));
      payoutEntry.cashbook = cashbookAcc._id;
    }

    // Each partial payout is its own real-world disbursement, so each one's reference (if given) is
    // claimed independently, keyed to this specific payout — not the whole commission.
    if (status === "paid" && payoutReference) {
      try {
        await claimPaymentReference({ business, reference: payoutReference, sourceModel: "SaleCommission", sourceId: payoutEntry._id });
      } catch (refErr) {
        return next(refErr);
      }
    }

    const commission = await populateCommission(
      SaleCommission.findOneAndUpdate({ _id: req.params.id, business }, mongoUpdate, { new: true })
    ).lean();
    if (!commission) return next(createError(404, "Commission not found"));

    // GL hooks — all paths await and roll back on failure
    if (status === "approved" && oldCommission.status === "pending") {
      // A staged commission (non-empty releaseSchedule) accrues tier-by-tier as the buyer pays
      // (commissionReleaseService.applyTierCrossings -> postPropertySaleCommissionTierRelease), entirely
      // independent of this manual approve step — tier accrual never advances commission.status past
      // "pending" by design, so a staged commission can sit here already partially (or fully) accrued
      // long before anyone clicks Approve. postPropertySaleCommissionAccrual posts the FULL gross amount
      // under a different sourceTransactionType ("property_sale_commission" vs the tiers' "..._tier"),
      // so its idempotency guard can't see the tier postings and would double-count the commission on
      // top of them. Approve stays a pure status checkpoint for a staged commission — no GL effect here;
      // "paid" already separately requires every tier to have released first.
      if (!oldCommission.releaseSchedule?.length) {
        // Finding 5: post accrual immediately on manual approval (not just at deal close)
        try {
          await postPropertySaleCommissionAccrual({ businessId: business, commission: oldCommission, userId });
        } catch (glErr) {
          await SaleCommission.findByIdAndUpdate(req.params.id, { status: oldCommission.status, updatedBy: userId });
          return next(createError(422, `GL accrual failed: ${glErr.message}. Commission status not changed.`));
        }
      }
    } else if (status === "paid") {
      try {
        await postPropertySaleCommissionPayout({ businessId: business, commission: oldCommission, userId, payout: payoutEntry, whtHandledBy });
      } catch (glErr) {
        // Undo exactly what mongoUpdate applied — this specific payout entry, its share of
        // paidOutAmount, and the status flip — not the whole commission's prior payout history.
        await SaleCommission.findByIdAndUpdate(req.params.id, {
          $set: { status: oldCommission.status, updatedBy: userId },
          $pull: { payouts: { _id: payoutEntry._id } },
          $inc: { paidOutAmount: -payoutEntry.amount },
        });
        // The reference was claimed against this now-reverted payout entry — release it too, or it's
        // permanently stuck "already used" with no payout anywhere for the user to find and delete.
        if (payoutReference) {
          await releasePaymentReference({ business, reference: payoutReference, sourceModel: "SaleCommission", sourceId: payoutEntry._id });
        }
        return next(createError(422, `GL posting failed: ${glErr.message}. Commission status not changed.`));
      }
    } else if (status === "reversed" && oldCommission.status === "paid") {
      // Reverse payout entries only; accrual stays — commission returns to approved-but-unpaid state
      try {
        await reversePropertySaleCommissionPayout({
          businessId: business,
          commission: oldCommission,
          userId,
          reason: `Commission ${oldCommission.commissionNumber} payout reversed`,
        });
      } catch (glErr) {
        await SaleCommission.findByIdAndUpdate(req.params.id, { status: oldCommission.status, updatedBy: userId });
        return next(createError(422, `GL reversal failed: ${glErr.message}. Commission status not changed.`));
      }
    } else if (status === "cancelled") {
      // Finding 4 & 7: await the reversal and roll back on failure.
      // pending→cancelled is reachable too (ALLOWED_TRANSITIONS.pending includes "cancelled") — a staged
      // commission can sit at "pending" with tiers already (fully) accrued long before anyone approves
      // it (tier accrual is payment-driven, independent of status), so this must not skip "pending".
      // Mirrors dealsController.js's cancelDeal: a staged commission's accrual lives ONLY in tierReleases
      // (reversePropertySaleCommissionAccrual's lump-type guard can never see those and silently no-ops),
      // and a commission that's had cash partially disbursed (paidOutAmount > 0 while status is still
      // "approved" — commissionsController only advances to "paid" once FULLY disbursed) needs the
      // clawback-receivable correction, not a plain reversal, for the already-paid portion.
      const cancelReason = `Commission ${oldCommission.commissionNumber} cancelled`;
      const paidOut = round2(Number(oldCommission.paidOutAmount || 0));
      try {
        if (oldCommission.releaseSchedule?.length) {
          await Promise.all((oldCommission.tierReleases || []).map((tierRelease) =>
            reversePropertySaleCommissionTierRelease({ businessId: business, commission: oldCommission, tierRelease, userId, reason: cancelReason })
          ));
        } else if (oldCommission.status === "approved" || oldCommission.status === "reversed") {
          // legacy lump accrual — a "pending" non-staged commission's accrual hasn't posted yet (it
          // posts lazily on manual approval, see the "approved" branch above), so there's nothing to
          // reverse for that case.
          await reversePropertySaleCommissionAccrual({ businessId: business, commission: oldCommission, userId, reason: cancelReason });
        }
        if (paidOut > 0) {
          await postPropertySaleCommissionClawbackOnCancellation({ businessId: business, commission: oldCommission, amount: paidOut, userId, reason: cancelReason });
        }
      } catch (glErr) {
        await SaleCommission.findByIdAndUpdate(req.params.id, { status: oldCommission.status, updatedBy: userId });
        return next(createError(422, `GL reversal failed: ${glErr.message}. Commission status not changed.`));
      }
      if (paidOut > 0) {
        await SaleCommission.updateOne(
          { _id: oldCommission._id, business },
          { clawbackReceivable: { amount: paidOut, createdAt: new Date(), settledAmount: 0, status: "outstanding" } }
        );
      }
    }

    res.status(200).json(commission);
  } catch (err) {
    next(err);
  }
};

// Manual, single-commission escape hatch on top of the automatic bulk resync that already fires on every
// agent commissionRate/commissionType save (agentsController.js's updateAgent) — kept for retrying one
// specific commission if a GL error excluded it from that bulk pass, without needing to re-save the whole
// agent record again.
//
// Works for "pending" AND "approved" (a staged commission can be "approved" with tiers already
// accrued — approval itself posts no GL for a staged one, see updateCommissionStatus). Never "paid" —
// money has already physically moved by then, and correcting a disbursed amount isn't a rate fix, it's a
// reversal + a fresh payout, a deliberately separate, more consequential action (the existing "reversed"
// transition) that this does not attempt.
export const recalculateCommissionRate = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);

    const scopedAgentId = await resolveAgentScope(req, business);
    const commission = await SaleCommission.findOne({ _id: req.params.id, business, ...(scopedAgentId && { agent: scopedAgentId }) });
    if (!commission) return next(createError(404, "Commission not found"));
    if (req.saleAgentSelf && String(commission.agent) === req.saleAgentSelf) {
      return next(createError(403, "Agents cannot change the status of their own commissions"));
    }
    if (!RECALC_ELIGIBLE_STATUSES.has(commission.status)) {
      return next(createError(400, `Only a pending or approved commission can be recalculated (this one is "${commission.status}")`));
    }

    const agent = await SaleAgent.findOne({ _id: commission.agent, business }).select("commissionRate commissionType").lean();
    if (!agent) return next(createError(404, "Agent not found"));

    try {
      const whtRate = await defaultWhtRate(business);
      await recalculateBrokerCommission({
        businessId: business, commission, userId,
        commissionRate: Number(agent.commissionRate || 0),
        commissionType: agent.commissionType || "percentage",
        whtRate,
      });
    } catch (glErr) {
      return next(createError(422, `GL reversal/re-posting failed while recalculating: ${glErr.message}. Check this commission's ledger entries before retrying.`));
    }

    const populated = await populateCommission(SaleCommission.findById(commission._id)).lean();
    res.status(200).json(populated);
  } catch (err) {
    next(err);
  }
};

// Deal-level release-schedule override — lets a buyer/broker-negotiated deal follow its own tier
// schedule instead of the company default. Only ever touches releaseSchedule itself (no GL effect),
// so it's gated purely on nothing having released yet: once a tier fires, that revenue recognition is
// final and the schedule that produced it can no longer be rewritten out from under it.
export const updateCommissionReleaseScheduleOverride = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);

    const scopedAgentId = await resolveAgentScope(req, business);
    const commission = await SaleCommission.findOne({ _id: req.params.id, business, ...(scopedAgentId && { agent: scopedAgentId }) });
    if (!commission) return next(createError(404, "Commission not found"));
    if (req.saleAgentSelf && String(commission.agent) === req.saleAgentSelf) {
      return next(createError(403, "Agents cannot change the status of their own commissions"));
    }
    if (!["pending", "approved"].includes(commission.status)) {
      return next(createError(400, `Only a pending or approved commission can have its release schedule changed (this one is "${commission.status}")`));
    }
    if (commission.tierReleases.length > 0) {
      return next(createError(400, "This commission has already released at least one tier — its schedule can no longer be changed"));
    }

    if (req.body.clear) {
      const settings = await SaleSettings.findOne({ business }).select("commissionReleaseSchedule").lean();
      const schedule = settings?.commissionReleaseSchedule;
      commission.releaseSchedule = Boolean(schedule?.enabled) ? (schedule?.brokerCommissionTiers ?? []) : [];
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

    const populated = await populateCommission(SaleCommission.findById(commission._id)).lean();
    res.status(200).json(populated);
  } catch (err) {
    next(err);
  }
};
