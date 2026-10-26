// Deletes a specific, confirmed-orphaned PaymentReferenceLock by its own _id (never by reference text
// alone, to guarantee this only ever touches the exact row inspectStuckCommissionReference.js verified).
import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import PaymentReferenceLock from "../models/PaymentReferenceLock.js";

const LOCK_ID = process.argv[2];
if (!LOCK_ID) {
  console.error("Usage: node scripts/releaseOrphanedCommissionReference.js <lockId>");
  process.exit(1);
}

const run = async () => {
  await mongoose.connect(process.env.MONGO_URL);
  const res = await PaymentReferenceLock.deleteOne({ _id: LOCK_ID });
  console.log(`Deleted ${res.deletedCount} lock(s) with _id ${LOCK_ID}`);
  await mongoose.disconnect();
};

run().catch((err) => { console.error(err); process.exit(1); });
