// One-off manual verification: hit the real, running HTTP server exactly like the web portal
// does (sign a portal token in-process — never printed — then call the live-statement/pdf
// route over the network) to see whether the actual request/response path fails differently
// than the direct in-process controller call already proved to work.
//
//   node scripts/verifyLivePdfHttp.js --companyCode=AR --landlordCode=LL004 --propertyCode=PRO003 --period=this_month
import dotenv from "dotenv";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Landlord from "../models/Landlord.js";
import Property from "../models/Property.js";
import Company from "../models/Company.js";
import { buildLandlordPropertyMatch } from "../controllers/propertyController/landlord.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const getArg = (name, fallback = "") => {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
};

async function main() {
  const mongoUrl = process.env.MONGO_URL || process.env.MONGODB_URL;
  if (!mongoUrl) throw new Error("MONGO_URL is required.");
  await mongoose.connect(mongoUrl);

  const companyCode = getArg("companyCode", "");
  const landlordCode = getArg("landlordCode", "LL001");
  const propertyCode = getArg("propertyCode", "");
  const period = getArg("period", "this_month");
  const port = getArg("port", "8800");

  const companyFilter = {};
  if (companyCode) {
    const company = await Company.findOne({ companyCode }).lean();
    if (!company) throw new Error(`Company ${companyCode} not found.`);
    companyFilter.company = company._id;
  }
  const landlord = await Landlord.findOne({ landlordCode, ...companyFilter }).lean();
  if (!landlord) throw new Error(`Landlord ${landlordCode} not found.`);

  const match = buildLandlordPropertyMatch(landlord);
  const property = propertyCode
    ? await Property.findOne({ ...match, propertyCode }).lean()
    : await Property.findOne(match).lean();
  if (!property) throw new Error(`No property found for ${landlordCode}${propertyCode ? ` / ${propertyCode}` : ""}.`);

  console.log("Using landlord:", landlord.landlordName, "| property:", property.propertyName, property.propertyCode);

  const token = jwt.sign(
    { landlordId: String(landlord._id), companyId: String(landlord.company), role: "landlordPortal" },
    process.env.JWT_SECRET,
    { expiresIn: "1h", issuer: "milik-api", audience: "milik-client" }
  );

  const url = `http://localhost:${port}/api/landlord-portal/live-statement/pdf?propertyId=${property._id}&period=${period}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  console.log("HTTP status:", res.status, res.headers.get("content-type"));

  if (res.headers.get("content-type")?.includes("application/pdf")) {
    const buf = Buffer.from(await res.arrayBuffer());
    const outPath = path.join(__dirname, "verifyLivePdfHttp.output.pdf");
    fs.writeFileSync(outPath, buf);
    console.log("PDF OK —", buf.length, "bytes, written to", outPath);
  } else {
    const text = await res.text();
    console.log("Response body:", text);
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err?.stack || err);
  process.exit(1);
});
