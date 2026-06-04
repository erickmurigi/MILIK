import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

const MONGO_URL = process.env.MONGO_URL;
if (!MONGO_URL) { console.error("MONGO_URL not set"); process.exit(1); }

await mongoose.connect(MONGO_URL);
console.log("Connected to MongoDB — database:", mongoose.connection.db.databaseName);

const collections = [
  "carwashjobs",
  "carwashpayments",
  "carwashcustomers",
  "carwashloyaltycards",
  "carwashstaffcommissions",
  "carwashcommissionpayouts",
  "carwashaccountstatements",
  "carwashstaffsavings",
  "carwashdeposits",
  "carwashexpenses",
];

const KEEP = [
  "carwashloyaltyprograms",
  "carwashservices",
  "carwashstaff",
  "carwashbranches",
  "carwashcreditaccounts",
  "carwashcommissionrules",
];

console.log("\nWILL DELETE:", collections.join(", "));
console.log("WILL KEEP:  ", KEEP.join(", "), "\n");

for (const col of collections) {
  const result = await mongoose.connection.db.collection(col).deleteMany({});
  console.log(`  ✓ ${col}: deleted ${result.deletedCount} documents`);
}

console.log("\nDone — car wash data cleared. Services, staff, and loyalty program intact.");
await mongoose.disconnect();
