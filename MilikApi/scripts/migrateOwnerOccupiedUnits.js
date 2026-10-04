// Converts units flagged with the old ownerOccupied checkbox into the owner_occupied status.
// Dry run by default: node scripts/migrateOwnerOccupiedUnits.js
// Apply the change:   node scripts/migrateOwnerOccupiedUnits.js --apply
import "dotenv/config";
import mongoose from "mongoose";

const apply = process.argv.includes("--apply");

await mongoose.connect(process.env.MONGO_URL, { serverSelectionTimeoutMS: 30000 });
const units = mongoose.connection.db.collection("units");

const filter = { ownerOccupied: true };
const count = await units.countDocuments(filter);
console.log(`Units flagged owner occupied: ${count}`);

if (apply && count > 0) {
  const result = await units.updateMany(filter, {
    $set: { status: "owner_occupied", isVacant: false },
    $unset: { ownerOccupied: "", vacantSince: "" },
  });
  console.log(`Updated: ${result.modifiedCount}`);
} else if (!apply) {
  console.log("Dry run only. Re-run with --apply to change these units.");
}

await mongoose.disconnect();
