// One-time: moves SaleAdvocate's old singular `userId` link onto the new `userIds` array (a firm can now
// have several people linked, not just one — see middleware/advocateScope.js, which already scopes by
// the firm id regardless of how many users are linked to it). Safe to re-run: records with no legacy
// userId are skipped, and $addToSet means running it twice never duplicates an entry.
//   node scripts/migrateAdvocateUserIds.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import SaleAdvocate from "../modules/propertySale/models/SaleAdvocate.js";

dotenv.config();

async function main() {
  const mongoUrl = process.env.MONGO_URL || process.env.MONGODB_URL;
  if (!mongoUrl) throw new Error("MONGO_URL is required.");
  await mongoose.connect(mongoUrl);

  const legacy = await SaleAdvocate.collection.find({ userId: { $exists: true, $ne: null } }).toArray();
  console.log(`Found ${legacy.length} SaleAdvocate record(s) with a legacy userId to migrate.`);

  for (const row of legacy) {
    await SaleAdvocate.collection.updateOne(
      { _id: row._id },
      { $addToSet: { userIds: row.userId }, $unset: { userId: "" } }
    );
    console.log(`${row.advocateNumber || row._id}: userId ${row.userId} -> userIds`);
  }

  await mongoose.disconnect();
  console.log("Done.");
}

main().catch((err) => { console.error(err); process.exit(1); });
