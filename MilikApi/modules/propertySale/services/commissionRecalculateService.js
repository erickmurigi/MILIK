// Core "recalculate one commission against its current rate inputs" logic, shared by:
//   - the manual per-commission recalculate actions (commissionsController.js / ownerCommissionsController.js)
//   - the automatic bulk resync fired when the rate input itself changes (an agent's commissionRate/Type,
//     or SaleSettings.ownerCommissionDefaults) — so editing the rate takes effect on every still-open
//     commission immediately, the same way a later edit to the release-schedule tiers already does
//     (see commissionReleaseService.js's resyncOpenCommissionReleaseSchedules).
//
// Whatever's already posted for a commission (tier releases, or a legacy one-shot accrual) is reversed
// first, then re-derived from scratch against the deal's CURRENT payment progress and the NEW rate — the
// same tier-crossing math a live payment would have used, so a staged commission ends up exactly where
// it would be if the correct rate had been in place from the start.
//
// Never touches a commission whose status isn't "pending"/"approved" — money already paid out is a
// disbursed fact, not a rate to correct; fixing that is the separate, more consequential "reversed"
// transition, not something a rate change should ever silently do.
import mongoose from "mongoose";
import SaleDeal from "../models/SaleDeal.js";
import SaleCommission from "../models/SaleCommission.js";
import SaleOwnerCommission from "../models/SaleOwnerCommission.js";
import SalePayment from "../models/SalePayment.js";
import { sumPaidForDeal, percentPaid } from "./dealProgress.js";
import { newlyCrossedTiers, maybeAutoApproveOwnerCommission } from "./commissionReleaseService.js";
import {
  postPropertySaleCommissionAccrual,
  postPropertySaleCommissionTierRelease,
  reversePropertySaleCommissionAccrual,
  reversePropertySaleCommissionTierRelease,
  postPropertySaleOwnerCommissionTierRelease,
  reversePropertySaleOwnerCommissionTierRelease,
} from "./propertySaleAccountingService.js";
import { calcWithholding } from "../../../utils/withholdingTax.js";
import { round2 } from "../../../utils/math.js";

export const RECALC_ELIGIBLE_STATUSES = new Set(["pending", "approved"]);

// One batched deal-fetch + one batched payment-sum aggregate for a whole set of staged commissions,
// instead of recalculateBrokerCommission/recalculateOwnerCommission each re-fetching their own deal
// and running their own SalePayment.aggregate — for a bulk resync (an agent's rate edit, or the
// company-wide owner-commission default edit) touching hundreds of open staged commissions, that was
// N deal fetches + N aggregates run strictly sequentially. Returns a Map keyed by String(dealId) ->
// { deal: {agreedPrice}|null, totalPaid }, covering every deal referenced by the given commissions
// (staged and non-staged alike — the lookup is cheap and keeps this one simple reusable helper).
const buildDealDataCache = async (businessId, commissions) => {
  const dealIds = [...new Set(commissions.map((c) => String(c.deal)).filter(Boolean))].map((id) => new mongoose.Types.ObjectId(id));
  if (!dealIds.length) return new Map();

  const [deals, paidTotals] = await Promise.all([
    SaleDeal.find({ _id: { $in: dealIds }, business: businessId }).select("agreedPrice").lean(),
    SalePayment.aggregate([
      { $match: { business: new mongoose.Types.ObjectId(String(businessId)), deal: { $in: dealIds }, status: "paid" } },
      { $group: { _id: "$deal", total: { $sum: "$amount" } } },
    ]),
  ]);

  const dealsById = new Map(deals.map((d) => [String(d._id), d]));
  const paidByDeal = new Map(paidTotals.map((p) => [String(p._id), p.total || 0]));

  const cache = new Map();
  for (const dealId of new Set(commissions.map((c) => String(c.deal)).filter(Boolean))) {
    cache.set(dealId, { deal: dealsById.get(dealId) || null, totalPaid: paidByDeal.get(dealId) || 0 });
  }
  return cache;
};

// `commission` must be a mongoose document (not .lean()) — this mutates and saves it in place, and
// returns it. Throws on GL failure; the caller decides whether that aborts a single request (the manual
// action) or is caught and logged per-record while the rest of a bulk pass continues.
export const recalculateBrokerCommission = async ({ businessId, commission, commissionRate, commissionType, whtRate, userId, dealDataCache }) => {
  // The module header comment above promises this function "never touches a commission whose status
  // isn't pending/approved — money already paid out is a disbursed fact, not a rate to correct", but
  // RECALC_ELIGIBLE_STATUSES only checks `status`, and a commission can be "approved" with paidOutAmount
  // > 0 (commissionsController.js only advances to "paid" once FULLY disbursed — a partial payout leaves
  // it "approved"). Without this guard, reversing+rebuilding tiers at a new rate loses track of what was
  // already paid out: the new commissionAmount can end up smaller than paidOutAmount, silently leaving
  // the agent overpaid with no warning, and the reversal itself over-corrects 2180 by exactly
  // paidOutAmount for the same reason cancelDeal's full reversal did (the payout's own clearing debit is
  // never accounted for). Enforce the comment's actual intent here rather than relying on every caller
  // (manual recalc, the automatic bulk resync) to remember to check this themselves.
  if (round2(Number(commission.paidOutAmount || 0)) > 0) {
    throw new Error(`Commission ${commission.commissionNumber} has already been paid out (partially or fully) — reverse the payout before recalculating its rate`);
  }

  const isStaged = Boolean(commission.releaseSchedule?.length);
  const hadLegacyAccrual = !isStaged && commission.status === "approved";
  const reason = `Rate recalculated — ${commission.commissionNumber}`;

  if (isStaged && commission.tierReleases?.length) {
    for (const tierRelease of commission.tierReleases) {
      await reversePropertySaleCommissionTierRelease({ businessId, commission, tierRelease, userId, reason });
    }
  } else if (hadLegacyAccrual) {
    await reversePropertySaleCommissionAccrual({ businessId, commission, userId, reason });
  }

  const commissionAmount = round2(
    commissionType === "percentage" ? (Number(commission.saleAmount || 0) * commissionRate) / 100 : commissionRate
  );
  const { whtAmount, netAmount } = calcWithholding(commissionAmount, whtRate);

  commission.commissionRate = commissionRate;
  commission.commissionType = commissionType;
  commission.commissionAmount = commissionAmount;
  commission.whtRate = whtRate;
  commission.whtAmount = whtAmount;
  commission.netAmount = netAmount;

  if (isStaged) {
    // The bulk resync (recalculateCommissionsForAgent) passes a pre-fetched dealDataCache so this
    // doesn't re-run a deal lookup + payment-sum aggregate for every commission in the batch — with a
    // large open-commission set, that was N deal fetches + N aggregates run strictly sequentially,
    // serializing what's otherwise an independent, batchable lookup. Falls back to fetching directly
    // (today's exact behavior) when called standalone (the manual single-commission recalc endpoint).
    const cached = dealDataCache?.get(String(commission.deal));
    const deal = cached !== undefined ? cached.deal : await SaleDeal.findOne({ _id: commission.deal, business: businessId }).select("agreedPrice").lean();
    const totalPaid = cached !== undefined ? cached.totalPaid : (deal ? await sumPaidForDeal(businessId, commission.deal) : 0);
    const currentPct = deal ? percentPaid(totalPaid, deal.agreedPrice) : 0;

    commission.tierReleases = [];
    commission.releasedAmount = 0;
    const crossed = newlyCrossedTiers(commission, 0, currentPct);
    const posted = [];
    for (const tier of crossed) {
      commission.tierReleases.push({ ...tier, status: "accrued", accruedAt: new Date(), paidAt: null });
      const pushed = commission.tierReleases[commission.tierReleases.length - 1];
      commission.releasedAmount = round2(Number(commission.releasedAmount || 0) + tier.amount);
      await postPropertySaleCommissionTierRelease({ businessId, commission, tierRelease: pushed, userId });
      posted.push(pushed);
    }
    commission.updatedBy = userId;
    try {
      await commission.save();
    } catch (saveErr) {
      // Same orphan risk as commissionReleaseService.applyTierCrossings — these tierRelease ids were
      // generated client-side at push() time, before this save ever reached the DB.
      await Promise.all(posted.map((tierRelease) =>
        reversePropertySaleCommissionTierRelease({ businessId, commission, tierRelease, userId, reason: "Tier release save failed — compensating reversal" })
      ));
      throw saveErr;
    }
    return commission;
  } else if (hadLegacyAccrual) {
    await postPropertySaleCommissionAccrual({ businessId, commission, userId });
  }

  commission.updatedBy = userId;
  await commission.save();
  return commission;
};

export const recalculateOwnerCommission = async ({ businessId, commission, rate, commissionType, userId, dealDataCache }) => {
  const isStaged = Boolean(commission.releaseSchedule?.length);
  const reason = `Rate recalculated — ${commission.commissionNumber}`;

  for (const tierRelease of commission.tierReleases || []) {
    await reversePropertySaleOwnerCommissionTierRelease({ businessId, ownerCommission: commission, tierRelease, userId, reason });
  }

  commission.commissionRate = rate;
  commission.commissionType = commissionType;
  commission.commissionAmount = round2(
    commissionType === "percentage" ? (Number(commission.saleAmount || 0) * rate) / 100 : rate
  );
  commission.tierReleases = [];
  commission.releasedAmount = 0;

  if (isStaged) {
    // Rebuilt from scratch, same as tierReleases/releasedAmount above — a rate change can make a
    // previously fully-released commission no longer fully released under the new (larger) amount, so
    // "approved" must not just survive unconditionally; maybeAutoApproveOwnerCommission below re-derives
    // it honestly against the freshly recomputed numbers.
    commission.status = "pending";
    const cached = dealDataCache?.get(String(commission.deal));
    const deal = cached !== undefined ? cached.deal : await SaleDeal.findOne({ _id: commission.deal, business: businessId }).select("agreedPrice").lean();
    const totalPaid = cached !== undefined ? cached.totalPaid : (deal ? await sumPaidForDeal(businessId, commission.deal) : 0);
    const currentPct = deal ? percentPaid(totalPaid, deal.agreedPrice) : 0;

    const crossed = newlyCrossedTiers(commission, 0, currentPct);
    const posted = [];
    for (const tier of crossed) {
      commission.tierReleases.push({ ...tier, accruedAt: new Date() });
      const pushed = commission.tierReleases[commission.tierReleases.length - 1];
      commission.releasedAmount = round2(Number(commission.releasedAmount || 0) + tier.amount);
      await postPropertySaleOwnerCommissionTierRelease({ businessId, ownerCommission: commission, tierRelease: pushed, userId });
      posted.push(pushed);
    }
    maybeAutoApproveOwnerCommission(commission);
    commission.updatedBy = userId;
    try {
      await commission.save();
    } catch (saveErr) {
      await Promise.all(posted.map((tierRelease) =>
        reversePropertySaleOwnerCommissionTierRelease({ businessId, ownerCommission: commission, tierRelease, userId, reason: "Tier release save failed — compensating reversal" })
      ));
      throw saveErr;
    }
    return commission;
  } else {
    const tierRelease = { thresholdPct: 0, releasePct: 100, amount: commission.commissionAmount, accruedAt: new Date() };
    commission.tierReleases.push(tierRelease);
    const pushed = commission.tierReleases[commission.tierReleases.length - 1];
    commission.releasedAmount = commission.commissionAmount;
    commission.status = "approved";
    await postPropertySaleOwnerCommissionTierRelease({ businessId, ownerCommission: commission, tierRelease: pushed, userId });
  }

  commission.updatedBy = userId;
  await commission.save();
  return commission;
};

// Bulk entry point — called right after an agent's commissionRate/commissionType is saved
// (agentsController.js's updateAgent), so every one of THAT agent's still-open commissions picks up the
// new rate immediately instead of staying stuck at whatever rate existed when each was created. Scoped to
// one agent (not the whole business) since the rate that changed is per-agent. A single commission's GL
// failure is caught and reported, not left to abort the agent save itself or block every other commission
// in the same pass — a rate/profile edit should never become hostage to one unrelated deal's GL quirk.
export const recalculateCommissionsForAgent = async ({ businessId, agentId, commissionRate, commissionType, userId, whtRate }) => {
  const commissions = await SaleCommission.find({ business: businessId, agent: agentId, status: { $in: [...RECALC_ELIGIBLE_STATUSES] } });
  const dealDataCache = await buildDealDataCache(businessId, commissions);
  const recalculated = [];
  const failed = [];
  for (const commission of commissions) {
    try {
      await recalculateBrokerCommission({ businessId, commission, commissionRate, commissionType, whtRate, userId, dealDataCache });
      recalculated.push(commission.commissionNumber);
    } catch (err) {
      failed.push({ commissionNumber: commission.commissionNumber, error: err.message });
    }
  }
  return { recalculated, failed };
};

// Bulk entry point — called right after SaleSettings.ownerCommissionDefaults is saved
// (settingsController.js's updateOwnerCommissionDefaults), company-wide (the rate that changed is a
// single company-wide default, unlike the broker side's per-agent rate).
export const recalculateOwnerCommissionsForBusiness = async ({ businessId, rate, commissionType, userId }) => {
  const commissions = await SaleOwnerCommission.find({ business: businessId, status: { $in: [...RECALC_ELIGIBLE_STATUSES] } });
  const dealDataCache = await buildDealDataCache(businessId, commissions);
  const recalculated = [];
  const failed = [];
  for (const commission of commissions) {
    try {
      await recalculateOwnerCommission({ businessId, commission, rate, commissionType, userId, dealDataCache });
      recalculated.push(commission.commissionNumber);
    } catch (err) {
      failed.push({ commissionNumber: commission.commissionNumber, error: err.message });
    }
  }
  return { recalculated, failed };
};
