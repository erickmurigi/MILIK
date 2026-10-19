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
import SaleDeal from "../models/SaleDeal.js";
import SaleCommission from "../models/SaleCommission.js";
import SaleOwnerCommission from "../models/SaleOwnerCommission.js";
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

// `commission` must be a mongoose document (not .lean()) — this mutates and saves it in place, and
// returns it. Throws on GL failure; the caller decides whether that aborts a single request (the manual
// action) or is caught and logged per-record while the rest of a bulk pass continues.
export const recalculateBrokerCommission = async ({ businessId, commission, commissionRate, commissionType, whtRate, userId }) => {
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
    const deal = await SaleDeal.findOne({ _id: commission.deal, business: businessId }).select("agreedPrice").lean();
    const totalPaid = deal ? await sumPaidForDeal(businessId, commission.deal) : 0;
    const currentPct = deal ? percentPaid(totalPaid, deal.agreedPrice) : 0;

    commission.tierReleases = [];
    commission.releasedAmount = 0;
    const crossed = newlyCrossedTiers(commission, 0, currentPct);
    for (const tier of crossed) {
      commission.tierReleases.push({ ...tier, status: "accrued", accruedAt: new Date(), paidAt: null });
      const pushed = commission.tierReleases[commission.tierReleases.length - 1];
      commission.releasedAmount = round2(Number(commission.releasedAmount || 0) + tier.amount);
      await postPropertySaleCommissionTierRelease({ businessId, commission, tierRelease: pushed, userId });
    }
  } else if (hadLegacyAccrual) {
    await postPropertySaleCommissionAccrual({ businessId, commission, userId });
  }

  commission.updatedBy = userId;
  await commission.save();
  return commission;
};

export const recalculateOwnerCommission = async ({ businessId, commission, rate, commissionType, userId }) => {
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
    const deal = await SaleDeal.findOne({ _id: commission.deal, business: businessId }).select("agreedPrice").lean();
    const totalPaid = deal ? await sumPaidForDeal(businessId, commission.deal) : 0;
    const currentPct = deal ? percentPaid(totalPaid, deal.agreedPrice) : 0;

    const crossed = newlyCrossedTiers(commission, 0, currentPct);
    for (const tier of crossed) {
      commission.tierReleases.push({ ...tier, accruedAt: new Date() });
      const pushed = commission.tierReleases[commission.tierReleases.length - 1];
      commission.releasedAmount = round2(Number(commission.releasedAmount || 0) + tier.amount);
      await postPropertySaleOwnerCommissionTierRelease({ businessId, ownerCommission: commission, tierRelease: pushed, userId });
    }
    maybeAutoApproveOwnerCommission(commission);
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
  const recalculated = [];
  const failed = [];
  for (const commission of commissions) {
    try {
      await recalculateBrokerCommission({ businessId, commission, commissionRate, commissionType, whtRate, userId });
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
  const recalculated = [];
  const failed = [];
  for (const commission of commissions) {
    try {
      await recalculateOwnerCommission({ businessId, commission, rate, commissionType, userId });
      recalculated.push(commission.commissionNumber);
    } catch (err) {
      failed.push({ commissionNumber: commission.commissionNumber, error: err.message });
    }
  }
  return { recalculated, failed };
};
