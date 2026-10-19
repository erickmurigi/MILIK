// One-off / manual catch-up: a commission created before a later edit to Settings > Commission Release
// tiers is stuck with its original (now incomplete) releaseSchedule snapshot — e.g. a tier added after
// the commission existed never makes it onto that commission's record, so it can never reach 100%
// released. Going forward this happens automatically on every settings save (updateCommissionReleaseSchedule
// in settingsController.js calls resyncOpenCommissionReleaseSchedules itself) — this script exists only to
// catch up records from BEFORE that was wired in, or to re-run the sync manually if ever needed.
//
//   node scripts/resyncCommissionReleaseSchedules.js                      (dry run: lists what would change)
//   node scripts/resyncCommissionReleaseSchedules.js --apply              (applies it)
//   node scripts/resyncCommissionReleaseSchedules.js --business=<id>      (one company only)
//
// Safe to run again: a commission already in sync with current settings is reported as "no change".
import mongoose from "mongoose";
import dotenv from "dotenv";
import SaleSettings from "../modules/propertySale/models/SaleSettings.js";
import SaleCommission from "../modules/propertySale/models/SaleCommission.js";
import SaleOwnerCommission from "../modules/propertySale/models/SaleOwnerCommission.js";
import { resyncOpenCommissionReleaseSchedules, foldScheduleUpdate } from "../modules/propertySale/services/commissionReleaseService.js";

dotenv.config();

const getArg = (name) => {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : "";
};

async function main() {
  const mongoUrl = process.env.MONGO_URL || process.env.MONGODB_URL;
  if (!mongoUrl) throw new Error("MONGO_URL is required.");
  const apply = process.argv.includes("--apply");
  const businessArg = getArg("business");

  await mongoose.connect(mongoUrl);

  const settingsList = await SaleSettings.find({
    "commissionReleaseSchedule.enabled": true,
    ...(businessArg ? { business: businessArg } : {}),
  }).lean();

  let totalBroker = 0, totalOwner = 0;
  for (const settings of settingsList) {
    const business = settings.business;
    const { ownerCommissionTiers, brokerCommissionTiers } = settings.commissionReleaseSchedule;

    const [staleBroker, staleOwner] = await Promise.all([
      SaleCommission.find({ business, status: { $in: ["pending", "approved"] }, "releaseSchedule.0": { $exists: true } }).lean(),
      SaleOwnerCommission.find({ business, status: { $in: ["pending", "approved"] }, "releaseSchedule.0": { $exists: true } }).lean(),
    ]);
    const changed = (c, tiers) => JSON.stringify(foldScheduleUpdate(c.releaseSchedule, c.tierReleases, tiers)) !== JSON.stringify(c.releaseSchedule);
    const brokerChanged = staleBroker.filter((c) => changed(c, brokerCommissionTiers));
    const ownerChanged  = staleOwner.filter((c) => changed(c, ownerCommissionTiers));

    for (const c of brokerChanged) console.log(`[business ${business}] ${c.commissionNumber}: releaseSchedule out of sync with current settings${apply ? "" : "   (dry run)"}`);
    for (const c of ownerChanged)  console.log(`[business ${business}] ${c.commissionNumber}: releaseSchedule out of sync with current settings${apply ? "" : "   (dry run)"}`);

    if (apply && (brokerChanged.length || ownerChanged.length)) {
      const result = await resyncOpenCommissionReleaseSchedules({ businessId: business, ownerCommissionTiers, brokerCommissionTiers });
      totalBroker += result.brokerUpdated;
      totalOwner  += result.ownerUpdated;
    } else {
      totalBroker += brokerChanged.length;
      totalOwner  += ownerChanged.length;
    }
  }

  console.log(apply
    ? `Done: ${totalBroker} broker commission(s) + ${totalOwner} owner commission(s) resynced.`
    : `Dry run only. ${totalBroker} broker + ${totalOwner} owner commission(s) would be resynced. Re-run with --apply to apply.`);
  await mongoose.disconnect();
}

main().catch((error) => { console.error(error); process.exit(1); });
