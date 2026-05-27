/**
 * One-time fix: enable all modules on the admin company and set companyMode.
 * Run from MilikApi directory:  node fixAdminCompany.js
 */

import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const MONGO_URL = process.env.MONGO_URL;
if (!MONGO_URL) {
  console.error("❌  MONGO_URL not set in .env");
  process.exit(1);
}

const ALL_MODULES_ON = {
  propertyManagement: true,
  accounts: true,
  billing: false,
  inventory: true,
  telcoDealership: false,
  procurement: false,
  hr: true,
  facilityManagement: false,
  hotelManagement: false,
  propertySale: true,
  frontOffice: false,
  dms: false,
  academics: false,
  projectManagement: false,
  assetValuation: false,
  pos: false,
  securityServices: false,
  carwash: true,
  crm: false,
  sacco: false,
  revenueRecognition: false,
  incidentManagement: false,
};

async function run() {
  await mongoose.connect(MONGO_URL);
  console.log("✅  Connected to MongoDB");

  const db = mongoose.connection.db;
  const companies = db.collection("companies");

  // Find admin company — tries common identifiers
  const adminEmail = process.env.MILIK_ADMIN_EMAIL || "";
  const query = adminEmail
    ? { $or: [{ email: adminEmail }, { companyName: /milik/i }] }
    : { companyName: /milik/i };

  const found = await companies.find(query).toArray();

  if (found.length === 0) {
    console.log("⚠️   No matching company found. Listing all companies so you can pick:");
    const all = await companies.find({}, { projection: { _id: 1, companyName: 1, email: 1, companyMode: 1 } }).toArray();
    all.forEach((c) => console.log(`  ${c._id}  |  ${c.companyName}  |  ${c.email}  |  mode: ${c.companyMode}`));
    await mongoose.disconnect();
    return;
  }

  for (const company of found) {
    const result = await companies.updateOne(
      { _id: company._id },
      {
        $set: {
          companyMode: "property_manager",
          modules: ALL_MODULES_ON,
          accountStatus: "Active",
          accountActive: true,
          isActive: true,
        },
      }
    );
    console.log(`✅  Updated: "${company.companyName}" (${company._id})  — matched: ${result.matchedCount}, modified: ${result.modifiedCount}`);
  }

  await mongoose.disconnect();
  console.log("Done.");
}

run().catch((err) => {
  console.error("❌  Error:", err.message);
  process.exit(1);
});
