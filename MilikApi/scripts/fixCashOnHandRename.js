/**
 * fixCashOnHandRename.js
 *
 * One-time cleanup script.
 *
 * Problem: Account code 1100 was originally named "Cash on Hand" but was renamed
 * to "COOPERATIVE BANK". Any transaction created BEFORE the rename still stores
 * the old string "Cash on Hand" in denormalised name fields.
 *
 * What this script does (scoped per business):
 *  1. Finds every ChartOfAccount with code 1100 now named "COOPERATIVE BANK".
 *  2. Updates RentPayment.cashbook      "Cash on Hand" → "COOPERATIVE BANK"
 *  3. Updates LandlordReceipt.cashbook  "Cash on Hand" → "COOPERATIVE BANK"
 *  4. Updates BankReconciliation.accountName (keyed by account ObjectId)
 *  5. Updates Budget.lines[].accountName (keyed by account ObjectId)
 *  6. Prints a summary, then DELETES ITSELF.
 *
 * Run:  node MilikApi/scripts/fixCashOnHandRename.js
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import fs from "fs";

dotenv.config();

const MONGO_URI = process.env.MONGO_URL;
if (!MONGO_URI) {
  console.error("MONGO_URL env variable is not set. Aborting.");
  process.exit(1);
}

const ObjId = mongoose.Schema.Types.ObjectId;

const ChartOfAccount = mongoose.models.ChartOfAccount ||
  mongoose.model("ChartOfAccount", new mongoose.Schema({
    business: { type: ObjId },
    code:     String,
    name:     String,
  }));

const RentPayment = mongoose.models.RentPayment ||
  mongoose.model("RentPayment", new mongoose.Schema({
    business: { type: ObjId },
    cashbook: String,
  }));

const LandlordReceipt = mongoose.models.LandlordReceipt ||
  mongoose.model("LandlordReceipt", new mongoose.Schema({
    business: { type: ObjId },
    cashbook: String,
  }));

const BankReconciliation = mongoose.models.BankReconciliation ||
  mongoose.model("BankReconciliation", new mongoose.Schema({
    business:    { type: ObjId },
    account:     { type: ObjId },
    accountName: String,
  }));

const Budget = mongoose.models.Budget ||
  mongoose.model("Budget", new mongoose.Schema({
    business: { type: ObjId },
    lines: [new mongoose.Schema({
      account:     { type: ObjId },
      accountName: String,
    }, { _id: false })],
  }));

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB.\n");

  const OLD_NAME = "Cash on Hand";
  const NEW_NAME = "COOPERATIVE BANK";
  const CODE     = "1100";

  const accounts = await ChartOfAccount.find({ code: CODE, name: NEW_NAME }).lean();

  if (accounts.length === 0) {
    console.log(`No account with code ${CODE} named "${NEW_NAME}" found. Nothing to do.`);
    await mongoose.disconnect();
    const __filename = fileURLToPath(import.meta.url);
    fs.unlinkSync(__filename);
    return;
  }

  for (const acct of accounts) {
    const biz = acct.business;
    console.log(`\nBusiness: ${biz}`);

    // RentPayment — keyed by old name string + business
    const rp = await RentPayment.updateMany(
      { business: biz, cashbook: OLD_NAME },
      { $set: { cashbook: NEW_NAME } }
    );
    console.log(`  RentPayment.cashbook           : ${rp.modifiedCount} updated`);

    // LandlordReceipt — keyed by old name string + business
    const lr = await LandlordReceipt.updateMany(
      { business: biz, cashbook: OLD_NAME },
      { $set: { cashbook: NEW_NAME } }
    );
    console.log(`  LandlordReceipt.cashbook       : ${lr.modifiedCount} updated`);

    // BankReconciliation — keyed by account ObjectId
    const br = await BankReconciliation.updateMany(
      { business: biz, account: acct._id },
      { $set: { accountName: NEW_NAME } }
    );
    console.log(`  BankReconciliation.accountName : ${br.modifiedCount} updated`);

    // Budget lines — array filter by account ObjectId
    const bg = await Budget.updateMany(
      { business: biz, "lines.account": acct._id },
      { $set: { "lines.$[line].accountName": NEW_NAME } },
      { arrayFilters: [{ "line.account": acct._id }] }
    );
    console.log(`  Budget lines.accountName       : ${bg.modifiedCount} budget(s) updated`);
  }

  console.log("\nDone.\n");
  await mongoose.disconnect();

  const __filename = fileURLToPath(import.meta.url);
  fs.unlinkSync(__filename);
  console.log("Script deleted itself. Cleanup complete.");
}

run().catch((err) => {
  console.error("Script failed:", err);
  mongoose.disconnect();
  process.exit(1);
});
