import mongoose from "mongoose";
import SaleCommission from "../models/SaleCommission.js";
import SaleOwnerCommission from "../models/SaleOwnerCommission.js";
import SaleDeal from "../models/SaleDeal.js";
import SalePayment from "../models/SalePayment.js";
import { round2 } from "../../../utils/math.js";
import { percentPaid } from "./dealProgress.js";
import {
  postPropertySaleCommissionTierRelease,
  postPropertySaleOwnerCommissionTierRelease,
  reversePropertySaleCommissionTierRelease,
  reversePropertySaleOwnerCommissionTierRelease,
} from "./propertySaleAccountingService.js";

// Tier release is a one-way ratchet keyed off the buyer's own cumulative payment progress: once a
// threshold is crossed, that tier's amount is posted and stays posted. An edit/void that later drops
// %paid back below an already-crossed threshold does NOT auto-reverse it — only an explicit deal
// cancellation claws anything back (dealsController.cancelDeal). This is deliberate: auto-reversing on
// every downward edit would silently undo revenue recognition and payable amounts a finance user may
// not be watching for.

// For a commission's tiers, find the ones newly crossed between the previous and new cumulative %paid,
// and work out each one's incremental amount (so partial accruals across tiers never leave a stray cent —
// the last tier crossed in this call gets commissionAmount minus everything already released, not its
// raw releasePct share).
// Exported so commissionsController.js's recalculateCommissionRate can re-derive, from scratch, exactly
// which tiers SHOULD have fired by now against a freshly recomputed commissionAmount — the same math,
// reused rather than duplicated.
export const newlyCrossedTiers = (commission, previousPctPaid, newPctPaid) => {
  const tiers = commission.releaseSchedule || [];
  if (!tiers.length || newPctPaid <= previousPctPaid) return [];
  const already = new Set((commission.tierReleases || []).map((t) => t.thresholdPct));
  const crossed = tiers
    .filter((t) => t.thresholdPct > previousPctPaid && t.thresholdPct <= newPctPaid && !already.has(t.thresholdPct))
    .sort((a, b) => a.thresholdPct - b.thresholdPct);
  if (!crossed.length) return [];

  // Each tier's releasePct is a CUMULATIVE share of commissionAmount (not an incremental one), so the
  // amount to post is always "this tier's cumulative target minus whatever's already been released" —
  // this self-corrects for rounding at every step without needing to special-case whichever tier happens
  // to be last. (A schedule that intentionally caps below 100% cumulative — releasePct never reaching
  // 100 — correctly never releases the uncapped remainder; only a tier whose own releasePct is 100 ever
  // claims the exact remainder, which this formula already does with no special-casing required.)
  let runningReleased = Number(commission.releasedAmount || 0);
  return crossed.map((tier) => {
    const targetAmount = round2((Number(commission.commissionAmount) * tier.releasePct) / 100);
    const amount = round2(targetAmount - runningReleased);
    runningReleased = round2(runningReleased + amount);
    return { thresholdPct: tier.thresholdPct, releasePct: tier.releasePct, amount: Math.max(0, amount) };
  });
};

// Folds a fresh settings tier list into a commission's stored releaseSchedule without disturbing
// anything already accrued: a tier whose thresholdPct is already in tierReleases is kept EXACTLY as it
// was recognized (its thresholdPct/releasePct from the schedule at accrual time), never silently
// rewritten by a later settings edit — that would risk newlyCrossedTiers no longer recognizing it as
// "already done" (it matches by thresholdPct) and re-accruing it. Every other tier — not yet fired —
// always reflects the current settings, so a newly-added later tier (or an edit to one not yet reached)
// takes effect immediately instead of being frozen at whatever existed when the commission was created.
export const foldScheduleUpdate = (existingSchedule, tierReleases, newTiers) => {
  const accruedThresholds = new Set((tierReleases || []).map((t) => t.thresholdPct));
  const frozen = (existingSchedule || []).filter((t) => accruedThresholds.has(t.thresholdPct));
  const fresh  = (newTiers || []).filter((t) => !accruedThresholds.has(t.thresholdPct))
    .map((t) => ({ thresholdPct: Number(t.thresholdPct), releasePct: Number(t.releasePct) }));
  return [...frozen, ...fresh].sort((a, b) => a.thresholdPct - b.thresholdPct);
};

// One batched deal-fetch + one batched payment-sum aggregate for a set of commissions' deals — same
// batching rationale as commissionRecalculateService.js's buildDealDataCache (kept separate, not
// imported, to avoid a cycle: that file already imports FROM this one). Returns a Map keyed by
// String(dealId) -> currentPct (cumulative % of agreedPrice paid), used by the catch-up pass below.
const buildCurrentPctCache = async (businessId, commissions) => {
  const dealIds = [...new Set(commissions.map((c) => String(c.deal)).filter(Boolean))].map((id) => new mongoose.Types.ObjectId(id));
  if (!dealIds.length) return new Map();
  const bId = new mongoose.Types.ObjectId(String(businessId));
  const [deals, paidTotals] = await Promise.all([
    SaleDeal.find({ _id: { $in: dealIds }, business: businessId }).select("agreedPrice").lean(),
    SalePayment.aggregate([
      { $match: { business: bId, deal: { $in: dealIds }, status: "paid" } },
      { $group: { _id: "$deal", total: { $sum: "$amount" } } },
    ]),
  ]);
  const dealsById = new Map(deals.map((d) => [String(d._id), d]));
  const paidByDeal = new Map(paidTotals.map((p) => [String(p._id), p.total || 0]));
  const cache = new Map();
  for (const dealId of new Set(commissions.map((c) => String(c.deal)).filter(Boolean))) {
    const deal = dealsById.get(dealId);
    cache.set(dealId, deal ? percentPaid(paidByDeal.get(dealId) || 0, deal.agreedPrice) : 0);
  }
  return cache;
};

// Brings every still-open (pending/approved) STAGED commission's releaseSchedule up to date with the
// company's current settings — called right after Settings > Commission Release is saved, so a tier
// added/edited there takes effect on in-flight commissions immediately instead of only on commissions
// created from now on. Commissions with an EMPTY releaseSchedule (created while staging was off, or
// never staged) are deliberately left untouched — converting an immediate-release commission into a
// staged one retroactively is a different, much bigger change than keeping an already-staged one in
// sync, and isn't what this is for.
//
// Updating the stored schedule alone isn't enough: a tier just added (or edited) can already be
// eligible against a deal's CURRENT payment progress — e.g. a deal sitting at exactly 50% paid, with a
// 50%-threshold tier added just now — and nothing else will ever re-check that, since tier-crossing is
// normally only evaluated reactively, on the NEXT live payment (applyTierCrossings). Without this
// catch-up pass, that tier would silently wait forever for a payment that may never come. So for every
// commission whose schedule actually changed, this also re-derives the deal's current %paid and fires
// any now-eligible tier immediately, the exact same way a live payment would have.
export const resyncOpenCommissionReleaseSchedules = async ({ businessId, ownerCommissionTiers, brokerCommissionTiers, userId = null }) => {
  // releaseScheduleOverridden commissions are deal-negotiated (buyer/broker agreed different terms) —
  // a company-wide settings edit must never overwrite one of those.
  const [brokerCommissions, ownerCommissions] = await Promise.all([
    SaleCommission.find({ business: businessId, status: { $in: ["pending", "approved"] }, "releaseSchedule.0": { $exists: true }, releaseScheduleOverridden: { $ne: true } }),
    SaleOwnerCommission.find({ business: businessId, status: { $in: ["pending", "approved"] }, "releaseSchedule.0": { $exists: true }, releaseScheduleOverridden: { $ne: true } }),
  ]);

  // Only actually write (and count) a record whose folded schedule genuinely differs — most commissions
  // on a resync pass are already in sync (nothing in settings changed for their side), and writing them
  // unconditionally would just be a no-op save plus a misleading "updated" count.
  const changedBroker = brokerCommissions.filter((c) => {
    const next = foldScheduleUpdate(c.releaseSchedule, c.tierReleases, brokerCommissionTiers);
    if (JSON.stringify(next) === JSON.stringify(c.releaseSchedule)) return false;
    c.releaseSchedule = next;
    return true;
  });
  const changedOwner = ownerCommissions.filter((c) => {
    const next = foldScheduleUpdate(c.releaseSchedule, c.tierReleases, ownerCommissionTiers);
    if (JSON.stringify(next) === JSON.stringify(c.releaseSchedule)) return false;
    c.releaseSchedule = next;
    return true;
  });

  const pctCache = await buildCurrentPctCache(businessId, [...changedBroker, ...changedOwner]);

  const saveBroker = async (commission) => {
    const currentPct = pctCache.get(String(commission.deal)) ?? 0;
    const crossed = newlyCrossedTiers(commission, 0, currentPct);
    const posted = [];
    for (const tier of crossed) {
      commission.tierReleases.push({ _id: undefined, ...tier, status: "accrued", accruedAt: new Date(), paidAt: null });
      const pushed = commission.tierReleases[commission.tierReleases.length - 1];
      commission.releasedAmount = round2(Number(commission.releasedAmount || 0) + tier.amount);
      await postPropertySaleCommissionTierRelease({ businessId, commission, tierRelease: pushed, userId });
      posted.push(pushed);
    }
    try {
      await commission.save();
    } catch (saveErr) {
      await Promise.all(posted.map((tierRelease) =>
        reversePropertySaleCommissionTierRelease({ businessId, commission, tierRelease, userId, reason: "Tier release save failed — compensating reversal" })
      ));
      throw saveErr;
    }
  };

  const saveOwner = async (ownerCommission) => {
    const currentPct = pctCache.get(String(ownerCommission.deal)) ?? 0;
    const crossed = newlyCrossedTiers(ownerCommission, 0, currentPct);
    const posted = [];
    for (const tier of crossed) {
      ownerCommission.tierReleases.push({ _id: undefined, ...tier, accruedAt: new Date() });
      const pushed = ownerCommission.tierReleases[ownerCommission.tierReleases.length - 1];
      ownerCommission.releasedAmount = round2(Number(ownerCommission.releasedAmount || 0) + tier.amount);
      await postPropertySaleOwnerCommissionTierRelease({ businessId, ownerCommission, tierRelease: pushed, userId });
      posted.push(pushed);
    }
    if (crossed.length) maybeAutoApproveOwnerCommission(ownerCommission);
    try {
      await ownerCommission.save();
    } catch (saveErr) {
      await Promise.all(posted.map((tierRelease) =>
        reversePropertySaleOwnerCommissionTierRelease({ businessId, ownerCommission, tierRelease, userId, reason: "Tier release save failed — compensating reversal" })
      ));
      throw saveErr;
    }
  };

  await Promise.all([...changedBroker.map(saveBroker), ...changedOwner.map(saveOwner)]);

  return { brokerUpdated: changedBroker.length, ownerUpdated: changedOwner.length };
};

// An owner (agency) commission has no manual approval step at all — unlike the broker's, "approved" here
// never means a human decided something, only "fully recognized." An immediate (non-staged) commission is
// auto-approved in full at deal creation; a staged one must get the same treatment the instant its last
// tier crosses, or it stays stuck showing "pending" (displayed as "Accruing") forever even once 100%
// released — nothing else ever flips it. Shared by applyTierCrossings (the live payment path) and
// commissionRecalculateService.js's recalculateOwnerCommission (the rate-resync path) so both stay in sync.
export const maybeAutoApproveOwnerCommission = (ownerCommission) => {
  if (ownerCommission.status !== "pending") return;
  const fullyReleased = Number(ownerCommission.releasedAmount || 0) >= Number(ownerCommission.commissionAmount || 0) - 0.01;
  if (fullyReleased) ownerCommission.status = "approved";
};

// Applies newly-crossed tiers for both the broker commission and the company's own commission on a deal,
// posting the GL for each. No-ops entirely when a commission's releaseSchedule is empty (today's exact
// immediate-release behavior is untouched; tiers are only ever consulted when a commission was created
// while commissionReleaseSchedule.enabled was on).
export const applyTierCrossings = async ({ businessId, dealId, previousPctPaid, newPctPaid, userId }) => {
  if (newPctPaid <= previousPctPaid) return;

  const [brokerCommission, ownerCommission] = await Promise.all([
    SaleCommission.findOne({ business: businessId, deal: dealId, status: { $in: ["pending", "approved", "paid"] } }),
    SaleOwnerCommission.findOne({ business: businessId, deal: dealId, status: { $in: ["pending", "approved"] } }),
  ]);

  if (brokerCommission?.releaseSchedule?.length) {
    const crossed = newlyCrossedTiers(brokerCommission, previousPctPaid, newPctPaid);
    const posted = [];
    for (const tier of crossed) {
      const tierRelease = { _id: undefined, ...tier, status: "accrued", accruedAt: new Date(), paidAt: null };
      brokerCommission.tierReleases.push(tierRelease);
      const pushed = brokerCommission.tierReleases[brokerCommission.tierReleases.length - 1];
      brokerCommission.releasedAmount = round2(Number(brokerCommission.releasedAmount || 0) + tier.amount);
      await postPropertySaleCommissionTierRelease({ businessId, commission: brokerCommission, tierRelease: pushed, userId });
      posted.push(pushed);
    }
    if (crossed.length) {
      try {
        await brokerCommission.save();
      } catch (saveErr) {
        // The tierRelease subdocument ids above are generated client-side at push() time, before this
        // save ever reaches the DB — if it fails (e.g. a concurrent payment crossing the same tier at
        // the same moment hits a version conflict), every GL entry already posted above is now orphaned:
        // not reflected in the persisted commission at all, and invisible to the next crossing's
        // idempotency check (which keys off these same not-yet-persisted ids). Reverse them before
        // propagating, so a failed save never leaves stranded GL behind.
        await Promise.all(posted.map((tierRelease) =>
          reversePropertySaleCommissionTierRelease({ businessId, commission: brokerCommission, tierRelease, userId, reason: "Tier release save failed — compensating reversal" })
        ));
        throw saveErr;
      }
    }
  }

  if (ownerCommission?.releaseSchedule?.length) {
    const crossed = newlyCrossedTiers(ownerCommission, previousPctPaid, newPctPaid);
    const posted = [];
    for (const tier of crossed) {
      ownerCommission.tierReleases.push({ _id: undefined, ...tier, accruedAt: new Date() });
      const pushed = ownerCommission.tierReleases[ownerCommission.tierReleases.length - 1];
      ownerCommission.releasedAmount = round2(Number(ownerCommission.releasedAmount || 0) + tier.amount);
      await postPropertySaleOwnerCommissionTierRelease({ businessId, ownerCommission, tierRelease: pushed, userId });
      posted.push(pushed);
    }
    if (crossed.length) {
      maybeAutoApproveOwnerCommission(ownerCommission);
      try {
        await ownerCommission.save();
      } catch (saveErr) {
        await Promise.all(posted.map((tierRelease) =>
          reversePropertySaleOwnerCommissionTierRelease({ businessId, ownerCommission, tierRelease, userId, reason: "Tier release save failed — compensating reversal" })
        ));
        throw saveErr;
      }
    }
  }
};
