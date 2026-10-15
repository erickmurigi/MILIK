import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import SaleCommission from "../models/SaleCommission.js";
import SaleAgent from "../models/SaleAgent.js";
import SaleDeal from "../models/SaleDeal.js";
import SalePayment from "../models/SalePayment.js";
import SaleAdvocate from "../models/SaleAdvocate.js";
import { currentUserId, resolveActiveBusinessId } from "../services/businessScope.js";
import { dealAdvocateTrustBalance, sumPaidForDeal, percentPaid } from "../services/dealProgress.js";
import { newlyCrossedTiers } from "../services/commissionReleaseService.js";
import {
  postPropertySaleCommissionAccrual,
  postPropertySaleCommissionPayout,
  postPropertySaleCommissionTierRelease,
  reversePropertySaleCommissionAccrual,
  reversePropertySaleCommissionPayout,
  reversePropertySaleCommissionTierRelease,
  resolveWhtHandler,
} from "../services/propertySaleAccountingService.js";
import { round2 } from "../../../utils/math.js";
import { calcWithholding } from "../../../utils/withholdingTax.js";
import { defaultWhtRate } from "./dealsController.js";

// The advocate who actually collected this deal's trust funds — read off the deal's own advocate_trust
// payments (the advocate who physically holds the money for this specific deal), not necessarily the
// project's "assigned" advocate, which may have been overridden per-payment. Most recent wins when a
// deal somehow has more than one (shouldn't happen in practice, but SalePayment.advocate is per-row).
const resolveDealCollectingAdvocate = async (business, dealId) => {
  const payment = await SalePayment.findOne({
    business, deal: dealId, collectionMethod: "advocate_trust", advocate: { $ne: null },
  }).sort({ paymentDate: -1 }).select("advocate").lean();
  if (!payment?.advocate) return null;
  return SaleAdvocate.findOne({ _id: payment.advocate, business }).select("whtHandledBy").lean();
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

const populateCommission = (query) =>
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
      filter.status = status;
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

    const [commissions, total, statsRaw] = await Promise.all([
      populateCommission(SaleCommission.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)).lean(),
      SaleCommission.countDocuments(filter),
      SaleCommission.aggregate([
        // aggregate() does not cast — ids must be real ObjectIds. Gate on the EFFECTIVE filter.agent
        // (set for agent-scoped users even with no agentId query param), not the raw query string.
        { $match: { business: toObjectId(business), ...(filter.agent && { agent: toObjectId(filter.agent) }), ...(filter.deal && { deal: toObjectId(filter.deal) }) } },
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

export const getCommission = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const scopedAgentId = await resolveAgentScope(req, business);
    const commission = await populateCommission(
      SaleCommission.findOne({ _id: req.params.id, business, ...(scopedAgentId && { agent: scopedAgentId }) })
    ).lean();
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

    // A staged commission may only be marked paid once every tier has released — the existing payout
    // function always disburses the full commissionAmount in one lump sum, and paying out before all
    // tiers have accrued would disburse more than has actually been recognized to the payable account.
    if (status === "paid" && oldCommission.releaseSchedule?.length && oldCommission.releasedAmount < oldCommission.commissionAmount - 0.01) {
      return next(createError(400, `Not all commission tiers have released yet — ${oldCommission.releasedAmount} of ${oldCommission.commissionAmount} recognized so far`));
    }

    // "source" (default "company_cashbook" — zero behavior change for every existing caller that
    // doesn't send it): who physically pays the broker. "advocate_trust" means the advocate settles
    // the broker directly out of trust funds they hold for THIS deal — guarded against that deal's own
    // trust balance (dealAdvocateTrustBalance), never the advocate's whole-book balance, so one deal's
    // payout can never draw against money actually collected for a different deal.
    const source = req.body.source === "advocate_trust" ? "advocate_trust" : "company_cashbook";
    let whtHandledBy = "agent";

    const update = { status, updatedBy: userId };
    if (status === "paid") {
      if (!payoutDate)   return next(createError(400, "Payout date is required when marking a commission as paid"));
      if (!payoutMethod) return next(createError(400, "Payout method is required when marking a commission as paid"));
      update.payoutDate   = payoutDate;
      update.payoutMethod = payoutMethod;
      if (payoutReference) update.payoutReference = payoutReference;
      update.payoutSource = source;

      if (source === "advocate_trust") {
        const trust = await dealAdvocateTrustBalance(business, oldCommission.deal);
        if (Number(oldCommission.commissionAmount) > trust.available + 0.01) {
          return next(createError(400, `This deal's advocate trust balance is only KES ${trust.available.toLocaleString()} — cannot pay out a KES ${Number(oldCommission.commissionAmount).toLocaleString()} commission from trust funds.`));
        }
        const advocateDoc = await resolveDealCollectingAdvocate(business, oldCommission.deal);
        whtHandledBy = await resolveWhtHandler(business, advocateDoc);
      }
    }
    if (notes) update.notes = notes;

    // Resolve cashbook if provided (used for payout GL credit leg) — never required for an
    // advocate_trust payout, since the credit leg goes to 1314, not a company cashbook.
    let cashbookAcc = null;
    if (status === "paid" && cashbook) {
      cashbookAcc = await resolveCashbook(business, cashbook);
      if (!cashbookAcc) return next(createError(400, "Selected cashbook account not found"));
    }

    const commission = await populateCommission(
      SaleCommission.findOneAndUpdate({ _id: req.params.id, business }, update, { new: true })
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
        await postPropertySaleCommissionPayout({ businessId: business, commission: oldCommission, userId, payoutDate, cashbookAccountId: cashbookAcc?._id || null, source, whtHandledBy });
      } catch (glErr) {
        await SaleCommission.findByIdAndUpdate(req.params.id, { status: oldCommission.status, updatedBy: userId });
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
    } else if (status === "cancelled" && (oldCommission.status === "approved" || oldCommission.status === "reversed")) {
      // Finding 4 & 7: await the reversal and roll back on failure
      // reversed→cancelled also reverses the accrual so nothing stays on the books
      try {
        await reversePropertySaleCommissionAccrual({
          businessId: business,
          commission: oldCommission,
          userId,
          reason: `Commission ${oldCommission.commissionNumber} cancelled`,
        });
      } catch (glErr) {
        await SaleCommission.findByIdAndUpdate(req.params.id, { status: oldCommission.status, updatedBy: userId });
        return next(createError(422, `GL reversal failed: ${glErr.message}. Commission status not changed.`));
      }
    }

    res.status(200).json(commission);
  } catch (err) {
    next(err);
  }
};

// A commission's rate/type/WHT are snapshotted at deal creation from the agent's own record and the
// company's WHT default — deliberately, so a later rate change never silently rewrites an already-agreed
// deal's economics. But that means a commission created BEFORE an agent's rate (or the company's WHT
// default) was corrected stays stuck at the old figures forever unless someone explicitly asks for it to
// be refreshed. This does exactly that, for one commission at a time — never bulk, never silent — so a
// deliberately custom rate on one specific deal isn't blindly overwritten along with everything else; the
// frontend shows the caller the old-vs-new numbers before they confirm.
//
// Works for "pending" AND "approved" (a staged commission can be "approved" with tiers already
// accrued — approval itself posts no GL for a staged one, see updateCommissionStatus). Never "paid" —
// money has already physically moved by then, and correcting a disbursed amount isn't a rate fix, it's a
// reversal + a fresh payout, a deliberately separate, more consequential action (the existing "reversed"
// transition) that this does not attempt.
//
// Whatever's already posted for this commission (tier releases, or a legacy one-shot accrual) is reversed
// first, then re-derived from scratch against the deal's CURRENT payment progress and the agent's CURRENT
// rate — using the exact same tier-crossing math (newlyCrossedTiers) a live payment would have used, so a
// staged commission ends up exactly where it would be if the correct rate had been in place from the
// start, not just a renamed number with no ledger to match it.
const eligibleForRecalculate = new Set(["pending", "approved"]);

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
    if (!eligibleForRecalculate.has(commission.status)) {
      return next(createError(400, `Only a pending or approved commission can be recalculated (this one is "${commission.status}")`));
    }

    const agent = await SaleAgent.findOne({ _id: commission.agent, business }).select("commissionRate commissionType").lean();
    if (!agent) return next(createError(404, "Agent not found"));

    const isStaged = Boolean(commission.releaseSchedule?.length);
    const hadLegacyAccrual = !isStaged && commission.status === "approved";
    const reason = `Rate recalculated — ${commission.commissionNumber}`;

    try {
      // Reverse whatever is already posted — every prior tier release for a staged commission (it can
      // accrue tiers while still "pending"), or the single legacy accrual for a non-staged "approved" one.
      if (isStaged && commission.tierReleases?.length) {
        for (const tierRelease of commission.tierReleases) {
          await reversePropertySaleCommissionTierRelease({ businessId: business, commission, tierRelease, userId, reason });
        }
      } else if (hadLegacyAccrual) {
        await reversePropertySaleCommissionAccrual({ businessId: business, commission, userId, reason });
      }

      // Recompute rate/type/amount/WHT from the agent's CURRENT record and the company's CURRENT default.
      const commissionRate = Number(agent.commissionRate || 0);
      const commissionType = agent.commissionType || "percentage";
      const commissionAmount = round2(
        commissionType === "percentage" ? (Number(commission.saleAmount || 0) * commissionRate) / 100 : commissionRate
      );
      const whtRate = await defaultWhtRate(business);
      const { whtAmount, netAmount } = calcWithholding(commissionAmount, whtRate);

      commission.commissionRate = commissionRate;
      commission.commissionType = commissionType;
      commission.commissionAmount = commissionAmount;
      commission.whtRate = whtRate;
      commission.whtAmount = whtAmount;
      commission.netAmount = netAmount;

      if (isStaged) {
        // Re-derive exactly which tiers SHOULD have fired by now, against the NEW commissionAmount and the
        // deal's actual, current payment progress — not just "however much was released before".
        const deal = await SaleDeal.findOne({ _id: commission.deal, business }).select("agreedPrice").lean();
        const totalPaid = deal ? await sumPaidForDeal(business, commission.deal) : 0;
        const currentPct = deal ? percentPaid(totalPaid, deal.agreedPrice) : 0;

        commission.tierReleases = [];
        commission.releasedAmount = 0;
        const crossed = newlyCrossedTiers(commission, 0, currentPct);
        for (const tier of crossed) {
          commission.tierReleases.push({ ...tier, status: "accrued", accruedAt: new Date(), paidAt: null });
          const pushed = commission.tierReleases[commission.tierReleases.length - 1];
          commission.releasedAmount = round2(Number(commission.releasedAmount || 0) + tier.amount);
          await postPropertySaleCommissionTierRelease({ businessId: business, commission, tierRelease: pushed, userId });
        }
      } else if (hadLegacyAccrual) {
        await postPropertySaleCommissionAccrual({ businessId: business, commission, userId });
      }
    } catch (glErr) {
      return next(createError(422, `GL reversal/re-posting failed while recalculating: ${glErr.message}. Check this commission's ledger entries before retrying.`));
    }

    commission.updatedBy = userId;
    await commission.save();

    const populated = await populateCommission(SaleCommission.findById(commission._id)).lean();
    res.status(200).json(populated);
  } catch (err) {
    next(err);
  }
};
