// Read-only diagnostic: prints the access-relevant fields of one LandlordStatement, to
// debug "Statement not found or access denied" on approve/pdf/etc. — that 404 fires
// whenever findStatementForAccess's {_id, business} filter in statementController.js
// doesn't match, which is usually either a stale frontend id or a business mismatch.
//
//   node scripts/inspectStatementAccess.js --id=<statementId>
import mongoose from "mongoose";
import dotenv from "dotenv";
import LandlordStatement from "../models/LandlordStatement.js";
import Company from "../models/Company.js";

dotenv.config();

const getArg = (name) => {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : "";
};

async function main() {
  const mongoUrl = process.env.MONGO_URL || process.env.MONGODB_URL;
  if (!mongoUrl) throw new Error("MONGO_URL is required.");
  const id = getArg("id");
  if (!id) throw new Error("--id=<statementId> is required.");

  await mongoose.connect(mongoUrl);

  const statement = await LandlordStatement.findById(id).lean();
  if (!statement) {
    console.log(`No LandlordStatement document exists with _id ${id}.`);
  } else {
    const company = await Company.findById(statement.business).select("companyName companyCode").lean();
    console.log({
      _id: String(statement._id),
      status: statement.status,
      business: String(statement.business),
      businessCompany: company ? `${company.companyName} (${company.companyCode})` : "NOT FOUND",
      property: String(statement.property),
      landlord: String(statement.landlord),
      statementNumber: statement.statementNumber,
      periodStart: statement.periodStart,
      periodEnd: statement.periodEnd,
      createdAt: statement.createdAt,
      updatedAt: statement.updatedAt,
    });
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
