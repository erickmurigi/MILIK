// One-off catch-up for SaleOwnerCommission tiers that released BEFORE deferred agency-commission
// recognition existed (propertySaleAccountingService.postPropertySaleOwnerCommissionTierRelease's
// `isDeferred` check). Those tiers posted straight to income (4430) under the old eager-recognition
// behavior even though the deal was trust-funded — financially correct for what the system knew at the
// time, but now inconsistent with every tier released going forward.
//
// Re-runs each qualifying commission through recalculateOwnerCommission with its OWN existing rate/type
// (never the company default), so commissionAmount is unchanged — only the account each tier's income
// posts to is re-derived (4430 -> 2186 where the deal is trust-funded). Reuses the exact reverse+repost
// path Settings > Commission Defaults already triggers for a rate edit; nothing new or less-tested.
//
//   node scripts/backfillAgencyCommissionDeferral.js                  (dry run: lists what would change)
//   node scripts/backfillAgencyCommissionDeferral.js --apply          (applies it)
//   node scripts/backfillAgencyCommissionDeferral.js --business=<id>  (one company only)
import mongoose from "mongoose";
import dotenv from "dotenv";
import Company from "../models/Company.js";
import SaleOwnerCommission from "../modules/propertySale/models/SaleOwnerCommission.js";
import { dealAdvocateTrustBalance } from "../modules/propertySale/services/dealProgress.js";
import { recalculateOwnerCommission } from "../modules/propertySale/services/commissionRecalculateService.js";

dotenv.config();

const getArg = (name) => {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : "";
};

async function main() {
  const mongoUrl = process.env.MONGO_URL;
  if (!mongoUrl) throw new Error("MONGO_URL is required.");
  const apply = process.argv.includes("--apply");
  const businessArg = getArg("business");

  await mongoose.connect(mongoUrl);

  const businesses = await Company.find({
    "modules.propertySale": true,
    ...(businessArg ? { _id: businessArg } : {}),
  }).select("companyName").lean();

  let fixedCount = 0;
  let touchedAmount = 0;

  for (const biz of businesses) {
    // .lean() first — the schema now declares `deferred` with a `default: false`, so a hydrated
    // mongoose document would show `false` for a legacy tier that never actually had the field stored,
    // indistinguishable from a tier that genuinely deferred=false on purpose. Raw/lean reads bypass
    // schema defaults and show the field only when it's truly present in the stored document.
    const rawCommissions = await SaleOwnerCommission.find({
      business: biz._id,
      status: { $in: ["pending", "approved"] },
      "releaseSchedule.0": { $exists: true },
      "tierReleases.0": { $exists: true },
    }).lean();
    const rawById = new Map(rawCommissions.map((c) => [String(c._id), c]));
    const legacyIds = rawCommissions
      .filter((c) => c.tierReleases.some((t) => !("deferred" in t)))
      .map((c) => c._id);
    if (!legacyIds.length) continue;

    const legacy = await SaleOwnerCommission.find({ _id: { $in: legacyIds } });
    for (const commission of legacy) {
      const trust = await dealAdvocateTrustBalance(biz._id, commission.deal);
      if (trust.collected <= 0) continue; // never trust-funded — the old eager posting was already correct

      const legacyAmount = rawById.get(String(commission._id)).tierReleases
        .filter((t) => !("deferred" in t))
        .reduce((s, t) => s + Number(t.amount || 0), 0);
      console.log(`${apply ? "FIXING" : "WOULD FIX"}: ${biz.companyName} / ${commission.commissionNumber} — deal trust-funded (collected ${trust.collected}), reclassifying ${legacyAmount} of already-recognized income as deferred (4430 -> 2186)`);
      fixedCount++;
      touchedAmount += legacyAmount;
      if (!apply) continue;

      await recalculateOwnerCommission({
        businessId: biz._id,
        commission,
        rate: commission.commissionRate,
        commissionType: commission.commissionType,
        userId: null,
      });
    }
  }

  console.log(`\n${apply ? "Fixed" : "Would fix"} ${fixedCount} commission(s), KES ${touchedAmount.toLocaleString()} reclassified.`);
  if (!apply && fixedCount > 0) console.log("Re-run with --apply to actually reverse/repost these tiers.");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
