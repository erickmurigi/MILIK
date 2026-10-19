// One-off / manual catch-up: a staged owner (agency) commission that fully released its tiers BEFORE
// maybeAutoApproveOwnerCommission existed never got flipped from "pending" to "approved" — nothing else
// ever did that for a staged one (only the immediate/non-staged path auto-approved at creation). Going
// forward this happens automatically the instant the last tier crosses (commissionReleaseService.js's
// applyTierCrossings) or on a manual rate recalculate. This script only fixes the status FLAG for records
// already fully released under their current numbers — it never touches tierReleases/releasedAmount or
// posts/reverses any GL entry, since those are already correct; only the stale status is wrong.
//
//   node scripts/fixOwnerCommissionAutoApprove.js                      (dry run: lists what would change)
//   node scripts/fixOwnerCommissionAutoApprove.js --apply              (applies it)
//   node scripts/fixOwnerCommissionAutoApprove.js --business=<id>      (one company only)
//
// Safe to run again: a commission already "approved" (or not yet fully released) is skipped.
import mongoose from "mongoose";
import dotenv from "dotenv";
import SaleOwnerCommission from "../modules/propertySale/models/SaleOwnerCommission.js";

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

  const stuck = await SaleOwnerCommission.find({
    status: "pending",
    "releaseSchedule.0": { $exists: true },
    ...(businessArg ? { business: businessArg } : {}),
  }).lean();

  let fixed = 0;
  for (const c of stuck) {
    const fullyReleased = Number(c.releasedAmount || 0) >= Number(c.commissionAmount || 0) - 0.01;
    if (!fullyReleased) continue;
    console.log(`${c.commissionNumber}: releasedAmount ${c.releasedAmount} / ${c.commissionAmount} — pending -> approved${apply ? "" : "   (dry run)"}`);
    if (apply) {
      await SaleOwnerCommission.updateOne({ _id: c._id }, { $set: { status: "approved" } });
    }
    fixed += 1;
  }

  console.log(apply ? `Done: ${fixed} owner commission(s) corrected.` : `Dry run only. ${fixed} owner commission(s) would be corrected. Re-run with --apply to apply.`);
  await mongoose.disconnect();
}

main().catch((error) => { console.error(error); process.exit(1); });
