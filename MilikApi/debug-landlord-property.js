import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import Landlord from "./models/Landlord.js";
import Property from "./models/Property.js";

const checkData = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL);
    console.log("Connected to MongoDB\n");

    // Get all landlords
    const landlords = await Landlord.find().limit(5);
    console.log("=== LANDLORDS ===");
    landlords.forEach((ll) => {
      console.log(`ID: ${ll._id}, Name: ${ll.landlordName}, Code: ${ll.landlordCode}`);
    });

    // Get all properties and show their landlords
    const properties = await Property.find().limit(10);
    console.log("\n=== PROPERTIES & THEIR LANDLORDS ===");
    properties.forEach((prop) => {
      console.log(`\nProperty: ${prop.propertyName} (${prop.propertyCode})`);
      console.log(`Status: ${prop.status}`);
      console.log("Landlords in property:");
      prop.landlords.forEach((ll, idx) => {
        console.log(`  [${idx}] landlordId: ${ll.landlordId}, name: ${ll.name}, isPrimary: ${ll.isPrimary}`);
      });
    });

    console.log("\n\n=== TESTING QUERY ===");
    // Test the query
    if (landlords.length > 0) {
      const testLandlord = landlords[0];
      console.log(`\nTesting with landlord: ${testLandlord.landlordName} (ID: ${testLandlord._id})\n`);

      const matchByID = await Property.find({ 'landlords.landlordId': testLandlord._id });
      console.log(`Properties matching by landlordId: ${matchByID.length}`);
      matchByID.forEach(p => console.log(`  - ${p.propertyName}`));

      const matchByName = await Property.find({ 'landlords.name': testLandlord.landlordName });
      console.log(`\nProperties matching by name (${testLandlord.landlordName}): ${matchByName.length}`);
      matchByName.forEach(p => console.log(`  - ${p.propertyName}`));

      const matchBoth = await Property.find({
        $or: [
          { 'landlords.landlordId': testLandlord._id },
          { 'landlords.name': testLandlord.landlordName }
        ]
      });
      console.log(`\nProperties matching by BOTH queries: ${matchBoth.length}`);
      matchBoth.forEach(p => console.log(`  - ${p.propertyName}`));
    }

    await mongoose.connection.close();
    console.log("\n✅ Debug complete");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
};

checkData();
