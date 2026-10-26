// Read-only diagnostic: find PaymentReferenceLock rows for a given reference text, and check whether
// the SaleCommission payout they claim to belong to still actually exists. A lock whose payout entry
// is gone (reverted after a failed GL post, pre-fix) is orphaned and safe to release.
import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import PaymentReferenceLock from "../models/PaymentReferenceLock.js";
import SaleCommission from "../modules/propertySale/models/SaleCommission.js";
import { voucherReferenceKey } from "../utils/voucherReference.js";

const REFERENCE = process.argv[2];
if (!REFERENCE) {
  console.error("Usage: node scripts/inspectStuckCommissionReference.js \"Chq.no 003432, 003433\"");
  process.exit(1);
}

const run = async () => {
  await mongoose.connect(process.env.MONGO_URL);
  const referenceKey = voucherReferenceKey(REFERENCE);
  const locks = await PaymentReferenceLock.find({ referenceKey }).lean();
  if (!locks.length) {
    console.log(`No PaymentReferenceLock found for "${REFERENCE}" (key: ${referenceKey}).`);
  }
  for (const lock of locks) {
    console.log("---");
    console.log("Lock:", { _id: lock._id, business: lock.business, sourceModel: lock.sourceModel, sourceId: lock.sourceId, rawReference: lock.rawReference });
    if (lock.sourceModel === "SaleCommission") {
      const commission = await SaleCommission.findOne({ business: lock.business, "payouts._id": lock.sourceId }).lean();
      if (commission) {
        const payout = commission.payouts.find((p) => String(p._id) === String(lock.sourceId));
        console.log("  -> Payout STILL EXISTS on commission", commission.commissionNumber, payout);
      } else {
        console.log("  -> ORPHANED: no SaleCommission has a payout with this _id. Safe to release.");
      }
    }
  }
  await mongoose.disconnect();
};

run().catch((err) => { console.error(err); process.exit(1); });
