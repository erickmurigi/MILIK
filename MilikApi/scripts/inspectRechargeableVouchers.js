// Read-only diagnostic: every "sale_owner_expense" PaymentVoucher that's still outstanding (not yet
// recovered via a SaleAdvocateRechargeRemittance, old or new) — i.e. exactly what would show up on an
// advocate's "Rechargeable Expenses" list today, so a pre-existing voucher created before that feature
// shipped can be confirmed visible and actionable without guessing. Uses the REAL exported helpers
// (outstandingRecoverableExpenseVouchers, ownAdvocateOwnerIds) so this can never drift from live logic.
//
//   node scripts/inspectRechargeableVouchers.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import Company from "../models/Company.js";
import SaleOwner from "../modules/propertySale/models/SaleOwner.js";
import SaleAdvocate from "../modules/propertySale/models/SaleAdvocate.js";
import { outstandingRecoverableExpenseVouchers } from "../modules/propertySale/services/recoverableExpense.js";
import { ownAdvocateOwnerIds } from "../modules/propertySale/middleware/advocateScope.js";

dotenv.config();

const fmtKES = (n) => `KES ${Number(n || 0).toLocaleString()}`;

async function main() {
  const mongoUrl = process.env.MONGO_URL || process.env.MONGODB_URL;
  if (!mongoUrl) throw new Error("MONGO_URL is required.");
  await mongoose.connect(mongoUrl);

  const companies = await Company.find({ "modules.propertySale": true }).select("companyName").lean();
  let grandTotalOutstanding = 0;
  let grandTotalVouchers = 0;

  for (const company of companies) {
    const owners = await SaleOwner.find({ business: company._id }).select("fullName ownerNumber").lean();
    if (!owners.length) continue;

    const advocates = await SaleAdvocate.find({ business: company._id }).select("fullName advocateNumber").lean();
    // Reuses the real scoping logic via a fake req, exactly like inspectAdvocateScoping.js — for each
    // advocate, which owners they'd actually see.
    const ownerIdsByAdvocate = new Map();
    for (const adv of advocates) {
      const ids = await ownAdvocateOwnerIds({ saleAdvocateId: String(adv._id) }, company._id);
      ownerIdsByAdvocate.set(String(adv._id), new Set(ids.map(String)));
    }

    let companyPrinted = false;
    for (const owner of owners) {
      const outstanding = await outstandingRecoverableExpenseVouchers(company._id, owner._id);
      if (!outstanding.length) continue;

      if (!companyPrinted) { console.log(`\n=== ${company.companyName} (${company._id}) ===`); companyPrinted = true; }
      const ownerTotal = outstanding.reduce((s, v) => s + v.outstanding, 0);
      const visibleTo = advocates.filter((a) => ownerIdsByAdvocate.get(String(a._id))?.has(String(owner._id)));
      console.log(`\n  Owner: ${owner.fullName} (${owner.ownerNumber}) — outstanding total ${fmtKES(ownerTotal)}`);
      console.log(`  Visible to advocate(s): ${visibleTo.length ? visibleTo.map((a) => `${a.fullName} (${a.advocateNumber})`).join(", ") : "NONE — no advocate is linked to this owner's project(s) yet"}`);
      for (const v of outstanding) {
        const due = v.dueDate ? new Date(v.dueDate).toLocaleDateString() : "—";
        console.log(`    - ${v.voucherNo || v.voucherId} — ${v.narration || v.payeeName || "(no description)"} — due ${due} — outstanding ${fmtKES(v.outstanding)} of ${fmtKES(v.amount)}`);
      }
      grandTotalOutstanding += ownerTotal;
      grandTotalVouchers += outstanding.length;
    }
  }

  console.log(`\n\nTOTAL: ${grandTotalVouchers} outstanding recoverable-expense voucher(s) across all companies, ${fmtKES(grandTotalOutstanding)} unrecovered.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
