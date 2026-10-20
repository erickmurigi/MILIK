// One-time correction for the "staged commission double-posted its accrual" bug (fixed today in
// postPropertySaleCommissionAccrual) — reverses ONLY the erroneous standalone lump accrual entry for
// each affected staged commission, leaving its correct tier-release entries untouched. Identifies
// affected commissions precisely: a staged commission (releaseSchedule.length > 0) that has BOTH a
// "property_sale_commission" (lump) entry AND "property_sale_commission_tier" entries — that
// combination can only exist from the bug (a staged commission's accrual should ONLY ever be tiers).
//
//   node scripts/fixDoubleAccruedCommissions.js           -- dry run, reports what it would do
//   node scripts/fixDoubleAccruedCommissions.js --apply   -- actually posts the reversals
import mongoose from "mongoose";
import dotenv from "dotenv";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import Company from "../models/Company.js";
import SaleCommission from "../modules/propertySale/models/SaleCommission.js";
import { reversePropertySaleCommissionAccrual } from "../modules/propertySale/services/propertySaleAccountingService.js";

dotenv.config();
const APPLY = process.argv.includes("--apply");

async function main() {
  const mongoUrl = process.env.MONGO_URL || process.env.MONGODB_URL;
  if (!mongoUrl) throw new Error("MONGO_URL is required.");
  await mongoose.connect(mongoUrl);

  const businesses = await Company.find({ "modules.propertySale": true }).select("companyName").lean();
  let fixedCount = 0;

  for (const biz of businesses) {
    const lumpIds = await FinancialLedgerEntry.distinct("sourceTransactionId", {
      business: biz._id, sourceTransactionType: "property_sale_commission", status: { $in: ["approved", "reversed"] },
    });
    for (const commId of lumpIds) {
      const tierCount = await FinancialLedgerEntry.countDocuments({
        business: biz._id, sourceTransactionType: "property_sale_commission_tier",
        sourceTransactionId: { $regex: `^${commId}:` },
      });
      if (tierCount === 0) continue; // not staged — a lone lump accrual here is correct, not the bug

      const commission = await SaleCommission.findById(commId);
      if (!commission || !commission.releaseSchedule?.length) continue; // defensive — should always match above

      console.log(`${APPLY ? "FIXING" : "WOULD FIX"}: ${biz.companyName} / ${commission.commissionNumber} — reversing erroneous duplicate lump accrual (commissionAmount=${commission.commissionAmount}, releasedAmount=${commission.releasedAmount}, paidOutAmount=${commission.paidOutAmount}, status=${commission.status})`);

      if (APPLY) {
        await reversePropertySaleCommissionAccrual({
          businessId: biz._id, commission, userId: null,
          reason: "One-time correction: erroneous duplicate lump accrual on a staged commission — fixed in postPropertySaleCommissionAccrual, this reverses the stray entry from before that fix.",
        });
      }
      fixedCount++;
    }
  }

  console.log(`\n${APPLY ? "Fixed" : "Would fix"} ${fixedCount} commission(s).`);
  if (!APPLY && fixedCount > 0) console.log("Re-run with --apply to actually post the corrections.");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
