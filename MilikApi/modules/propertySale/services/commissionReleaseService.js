import SaleCommission from "../models/SaleCommission.js";
import SaleOwnerCommission from "../models/SaleOwnerCommission.js";
import { round2 } from "../../../utils/math.js";
import {
  postPropertySaleCommissionTierRelease,
  postPropertySaleOwnerCommissionTierRelease,
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
    for (const tier of crossed) {
      const tierRelease = { _id: undefined, ...tier, status: "accrued", accruedAt: new Date(), paidAt: null };
      brokerCommission.tierReleases.push(tierRelease);
      const pushed = brokerCommission.tierReleases[brokerCommission.tierReleases.length - 1];
      brokerCommission.releasedAmount = round2(Number(brokerCommission.releasedAmount || 0) + tier.amount);
      await postPropertySaleCommissionTierRelease({ businessId, commission: brokerCommission, tierRelease: pushed, userId });
    }
    if (crossed.length) await brokerCommission.save();
  }

  if (ownerCommission?.releaseSchedule?.length) {
    const crossed = newlyCrossedTiers(ownerCommission, previousPctPaid, newPctPaid);
    for (const tier of crossed) {
      ownerCommission.tierReleases.push({ _id: undefined, ...tier, accruedAt: new Date() });
      const pushed = ownerCommission.tierReleases[ownerCommission.tierReleases.length - 1];
      ownerCommission.releasedAmount = round2(Number(ownerCommission.releasedAmount || 0) + tier.amount);
      await postPropertySaleOwnerCommissionTierRelease({ businessId, ownerCommission, tierRelease: pushed, userId });
    }
    if (crossed.length) await ownerCommission.save();
  }
};
