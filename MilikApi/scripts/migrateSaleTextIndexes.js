// One-time: rebuild the PropertySale text indexes with `business` as a prefix so $text searches only touch the
// current company's documents. MongoDB allows one text index per collection, so the old one is dropped first
// (search is briefly unavailable on that collection while it rebuilds). Safe to re-run: already-prefixed
// indexes are left alone.  Usage: node scripts/migrateSaleTextIndexes.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import SaleAgent from "../modules/propertySale/models/SaleAgent.js";
import SaleBuyer from "../modules/propertySale/models/SaleBuyer.js";
import SaleLead from "../modules/propertySale/models/SaleLead.js";
import SaleListing from "../modules/propertySale/models/SaleListing.js";

dotenv.config();

const isText = (idx) => Object.values(idx.key).includes("text") || idx.key._fts === "text";

const run = async () => {
  await mongoose.connect(process.env.MONGO_URL || process.env.MONGO || process.env.MONGODB_URI);
  for (const Model of [SaleAgent, SaleBuyer, SaleLead, SaleListing]) {
    const name = Model.collection.collectionName;
    try {
      const existing = (await Model.collection.indexes()).find(isText);
      if (existing && existing.weights && Object.keys(existing.key).includes("business")) {
        console.log(`${name}: already business-prefixed (${existing.name}) — skipped`);
        continue;
      }
      if (existing) {
        await Model.collection.dropIndex(existing.name);
        console.log(`${name}: dropped ${existing.name}`);
      }
      await Model.createIndexes();
      console.log(`${name}: text index rebuilt with business prefix`);
    } catch (err) {
      console.error(`${name}: FAILED — ${err.message}`);
      process.exitCode = 1;
    }
  }
  await mongoose.disconnect();
};

run().catch((err) => { console.error(err); process.exit(1); });
