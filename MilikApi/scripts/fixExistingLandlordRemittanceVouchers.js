// Retroactively corrects every existing PaymentVoucher created by payLandlord (identified by
// sourceProcessedStatement being set — the one field only that flow ever populates) to read
// correctly under the fix applied to landlordPaymentController.js this session:
//   - category: "landlord_other" -> "landlord_remittance" (all of them — including reversed ones,
//     for an accurate historical record; "landlord_other" was always just a placeholder, never a
//     real classification choice anyone made for these).
//   - debitAccount cleared to null for non-reversed vouchers only: it held a duplicate of the
//     cashbook (now correctly on settlementAccount alone — confirmed via a live check that every
//     one of these already has settlementAccount set, since each was already manually marked paid
//     at some point), which is what made the printed voucher's "Debit account" row confusingly show
//     a bank/M-Pesa account instead of being blank (this voucher type has no separate accrual debit
//     leg of its own — see the same comment in landlordPaymentController.js). Left untouched on
//     reversed vouchers — their account fields are a historical audit record, not worth touching for
//     a cosmetic-only field.
// Never touches status, amount, settlementAccount, liabilityAccount, or any GL entry — this is a
// pure reclassification of already-correct financial records, not a correction of their numbers.
//
// Usage:
//   node scripts/fixExistingLandlordRemittanceVouchers.js          (dry run, default)
//   node scripts/fixExistingLandlordRemittanceVouchers.js --apply
import mongoose from "mongoose";
import dotenv from "dotenv";
import PaymentVoucher from "../models/PaymentVoucher.js";
import Company from "../models/Company.js";

dotenv.config();
const apply = process.argv.includes("--apply");

async function main() {
  const mongoUrl = process.env.MONGO_URL || process.env.MONGODB_URL;
  if (!mongoUrl) throw new Error("MONGO_URL is required.");
  await mongoose.connect(mongoUrl);

  const vouchers = await PaymentVoucher.find({
    sourceProcessedStatement: { $ne: null },
    category: "landlord_other",
  }).select("voucherNo business status debitAccount").lean();

  if (!vouchers.length) {
    console.log("Nothing to do — no landlord_other vouchers with a sourceProcessedStatement found.");
    await mongoose.disconnect();
    process.exit(0);
  }

  const companies = await Company.find({ _id: { $in: [...new Set(vouchers.map((v) => String(v.business)))] } })
    .select("companyCode").lean();
  const companyCodeById = new Map(companies.map((c) => [String(c._id), c.companyCode]));

  let recategorized = 0, debitAccountCleared = 0;

  for (const v of vouchers) {
    const code = companyCodeById.get(String(v.business)) || String(v.business);
    const willClearDebit = v.status !== "reversed" && v.debitAccount;

    console.log(
      `  ${code} ${v.voucherNo} (status=${v.status}): ${apply ? "recategorizing" : "would recategorize"} landlord_other -> landlord_remittance` +
      (willClearDebit ? `, ${apply ? "clearing" : "would clear"} debitAccount` : "")
    );
    recategorized++;
    if (willClearDebit) debitAccountCleared++;

    if (!apply) continue;

    const update = { $set: { category: "landlord_remittance" } };
    if (willClearDebit) update.$set.debitAccount = null;
    await PaymentVoucher.updateOne({ _id: v._id }, update);
  }

  console.log(
    `\nTOTAL: ${recategorized} voucher(s) ${apply ? "recategorized" : "would be recategorized"}, ` +
    `${debitAccountCleared} debitAccount field(s) ${apply ? "cleared" : "would be cleared"}.`
  );
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err?.stack || err);
  process.exit(1);
});
