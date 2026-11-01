// One-off manual verification: does downloadMyLiveStatementPdf actually render a real PDF
// against real dev data, now that it feeds a synthetic (non-persisted) "statement" object
// into generateStatementPdf for the first time? Writes the PDF next to this script for a
// byte-size sanity check and reports any thrown error in full.
//
//   node scripts/verifyLivePortalPdf.js --landlordCode=LL001
import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Landlord from "../models/Landlord.js";
import Property from "../models/Property.js";
import Company from "../models/Company.js";
import { downloadMyLiveStatementPdf } from "../controllers/propertyController/landlordPortalController.js";
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

  const landlordCode = getArg("landlordCode", "LL001");
  const companyCode = getArg("companyCode", "");
  const propertyCode = getArg("propertyCode", "");
  const period = getArg("period", "this_month");
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

  const req = {
    query: { propertyId: String(property._id), period },
    landlordPortal: { landlordId: String(landlord._id), companyId: String(landlord.company) },
  };
  let bodyBuffer = null;
  const res = {
    setHeader() {},
    send(buf) { bodyBuffer = buf; },
  };
  const next = (err) => { throw err; };

  await downloadMyLiveStatementPdf(req, res, next);

  if (!bodyBuffer) throw new Error("No PDF buffer was produced.");
  const outPath = path.join(__dirname, "verifyLivePortalPdf.output.pdf");
  fs.writeFileSync(outPath, bodyBuffer);
  console.log("PDF generated OK —", bodyBuffer.length, "bytes, written to", outPath);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err?.stack || err);
  process.exit(1);
});
