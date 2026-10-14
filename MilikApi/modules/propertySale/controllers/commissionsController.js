import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import SaleCommission from "../models/SaleCommission.js";
import SaleAgent from "../models/SaleAgent.js";
import SalePayment from "../models/SalePayment.js";
import SaleAdvocate from "../models/SaleAdvocate.js";
import { currentUserId, resolveActiveBusinessId } from "../services/businessScope.js";
import { dealAdvocateTrustBalance } from "../services/dealProgress.js";
import {
  postPropertySaleCommissionAccrual,
  postPropertySaleCommissionPayout,
  reversePropertySaleCommissionAccrual,
  reversePropertySaleCommissionPayout,
  resolveWhtHandler,
} from "../services/propertySaleAccountingService.js";

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
