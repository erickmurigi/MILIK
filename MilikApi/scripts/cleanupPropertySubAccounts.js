import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.MONGO_URL;

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB");

  const db = mongoose.connection.db;
  const accounts = db.collection("chartofaccounts");
  const properties = db.collection("properties");

  // Delete all property GL sub-accounts:
  //   - code matches NNNN-XXXXX pattern (parent-code dash property-code)
  //   - but NOT PCTRL- accounts (those are the correct control accounts we keep)
  const subAccountPattern = /^\d{3,5}-[A-Z0-9]+$/;
  const deleteResult = await accounts.deleteMany({
    property: { $exists: true, $ne: null },
    $expr: { $not: { $regexMatch: { input: "$code", regex: "^PCTRL-" } } },
  });

  console.log(`Deleted ${deleteResult.deletedCount} property sub-accounts from ChartOfAccounts`);

  // Also remove the stale propertyAccounts subdoc from all Property documents.
  // (Schema field was removed — MongoDB keeps old data until explicitly unset.)
  const unsetResult = await properties.updateMany(
    { propertyAccounts: { $exists: true } },
    { $unset: { propertyAccounts: "" } }
  );

  console.log(`Cleared propertyAccounts field from ${unsetResult.modifiedCount} property documents`);

  await mongoose.disconnect();
  console.log("Done.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
