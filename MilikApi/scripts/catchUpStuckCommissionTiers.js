// One-time catch-up for commissions whose stored releaseSchedule is already correct but which never
// got the "re-check against current payment progress" pass commissionReleaseService.js's
// resyncOpenCommissionReleaseSchedules now does for commissions whose schedule CHANGES — these ones
// didn't change on the last settings save (they'd already been folded in earlier), so that fix doesn't
// touch them retroactively. Concretely: a tier was added/edited while a deal already sat at or past its
// threshold, and no NEW payment has come in since to naturally trigger applyTierCrossings.
//
// Finds every open (pending/approved) STAGED commission across every propertySale business, re-derives
// each deal's current %paid, and fires any tier that newlyCrossedTiers says should already have fired —
// exactly the same posting path a live payment would use.
//
//   node scripts/catchUpStuckCommissionTiers.js           -- dry run, reports what it would do
//   node scripts/catchUpStuckCommissionTiers.js --apply   -- actually posts the tier releases
import mongoose from "mongoose";
import dotenv from "dotenv";
import Company from "../models/Company.js";
import SaleCommission from "../modules/propertySale/models/SaleCommission.js";
import SaleOwnerCommission from "../modules/propertySale/models/SaleOwnerCommission.js";
import SaleDeal from "../modules/propertySale/models/SaleDeal.js";
import SalePayment from "../modules/propertySale/models/SalePayment.js";
import { percentPaid } from "../modules/propertySale/services/dealProgress.js";
import { newlyCrossedTiers, maybeAutoApproveOwnerCommission } from "../modules/propertySale/services/commissionReleaseService.js";
import {
  postPropertySaleCommissionTierRelease,
  postPropertySaleOwnerCommissionTierRelease,
  reversePropertySaleCommissionTierRelease,
  reversePropertySaleOwnerCommissionTierRelease,
} from "../modules/propertySale/services/propertySaleAccountingService.js";
import { round2 } from "../utils/math.js";

dotenv.config();
const APPLY = process.argv.includes("--apply");

async function main() {
  const mongoUrl = process.env.MONGO_URL || process.env.MONGODB_URL;
  if (!mongoUrl) throw new Error("MONGO_URL is required.");
  await mongoose.connect(mongoUrl);

  const businesses = await Company.find({ "modules.propertySale": true }).select("companyName").lean();
  let fixedCount = 0;

  for (const biz of businesses) {
    const [brokerCommissions, ownerCommissions] = await Promise.all([
      SaleCommission.find({ business: biz._id, status: { $in: ["pending", "approved"] }, "releaseSchedule.0": { $exists: true } }),
      SaleOwnerCommission.find({ business: biz._id, status: { $in: ["pending", "approved"] }, "releaseSchedule.0": { $exists: true } }),
    ]);
    const all = [...brokerCommissions, ...ownerCommissions];
    if (!all.length) continue;

    const dealIds = [...new Set(all.map((c) => String(c.deal)))].map((id) => new mongoose.Types.ObjectId(id));
    const [deals, paidTotals] = await Promise.all([
      SaleDeal.find({ _id: { $in: dealIds }, business: biz._id }).select("agreedPrice").lean(),
      SalePayment.aggregate([
        { $match: { business: biz._id, deal: { $in: dealIds }, status: "paid" } },
        { $group: { _id: "$deal", total: { $sum: "$amount" } } },
      ]),
    ]);
    const dealsById = new Map(deals.map((d) => [String(d._id), d]));
    const paidByDeal = new Map(paidTotals.map((p) => [String(p._id), p.total || 0]));
    const pctFor = (dealId) => {
      const deal = dealsById.get(String(dealId));
      return deal ? percentPaid(paidByDeal.get(String(dealId)) || 0, deal.agreedPrice) : 0;
    };

    for (const commission of brokerCommissions) {
      const currentPct = pctFor(commission.deal);
      const crossed = newlyCrossedTiers(commission, 0, currentPct);
      if (!crossed.length) continue;
      console.log(`${APPLY ? "FIXING" : "WOULD FIX"}: ${biz.companyName} / broker ${commission.commissionNumber} — deal at ${currentPct}% paid, catching up ${crossed.length} stuck tier(s): ${JSON.stringify(crossed)}`);
      fixedCount++;
      if (!APPLY) continue;
      const posted = [];
      for (const tier of crossed) {
        commission.tierReleases.push({ _id: undefined, ...tier, status: "accrued", accruedAt: new Date(), paidAt: null });
        const pushed = commission.tierReleases[commission.tierReleases.length - 1];
        commission.releasedAmount = round2(Number(commission.releasedAmount || 0) + tier.amount);
        await postPropertySaleCommissionTierRelease({ businessId: biz._id, commission, tierRelease: pushed, userId: null });
        posted.push(pushed);
      }
      try {
        await commission.save();
      } catch (saveErr) {
        await Promise.all(posted.map((tierRelease) =>
          reversePropertySaleCommissionTierRelease({ businessId: biz._id, commission, tierRelease, userId: null, reason: "Tier release save failed — compensating reversal" })
        ));
        throw saveErr;
      }
    }

    for (const ownerCommission of ownerCommissions) {
      const currentPct = pctFor(ownerCommission.deal);
      const crossed = newlyCrossedTiers(ownerCommission, 0, currentPct);
      if (!crossed.length) continue;
      console.log(`${APPLY ? "FIXING" : "WOULD FIX"}: ${biz.companyName} / owner ${ownerCommission.commissionNumber} — deal at ${currentPct}% paid, catching up ${crossed.length} stuck tier(s): ${JSON.stringify(crossed)}`);
      fixedCount++;
      if (!APPLY) continue;
      const posted = [];
      for (const tier of crossed) {
        ownerCommission.tierReleases.push({ _id: undefined, ...tier, accruedAt: new Date() });
        const pushed = ownerCommission.tierReleases[ownerCommission.tierReleases.length - 1];
        ownerCommission.releasedAmount = round2(Number(ownerCommission.releasedAmount || 0) + tier.amount);
        await postPropertySaleOwnerCommissionTierRelease({ businessId: biz._id, ownerCommission, tierRelease: pushed, userId: null });
        posted.push(pushed);
      }
      maybeAutoApproveOwnerCommission(ownerCommission);
      try {
        await ownerCommission.save();
      } catch (saveErr) {
        await Promise.all(posted.map((tierRelease) =>
          reversePropertySaleOwnerCommissionTierRelease({ businessId: biz._id, ownerCommission, tierRelease, userId: null, reason: "Tier release save failed — compensating reversal" })
        ));
        throw saveErr;
      }
    }
  }

  console.log(`\n${APPLY ? "Fixed" : "Would fix"} ${fixedCount} commission(s).`);
  if (!APPLY && fixedCount > 0) console.log("Re-run with --apply to actually post the catch-up tier releases.");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
