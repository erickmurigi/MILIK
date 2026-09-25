// One-off: agent commissions paid before withholding tax was posted.
//
// Those payouts credited the cashbook with the FULL commission although the agent was paid the net, and never put the tax
// held back into 2141 Withholding Tax Payable. For each such commission this posts the missing correction, dated the
// payout date:   Dr cashbook (the account the payout credited)   Cr 2141 Withholding Tax Payable   — for the WHT amount.
//
//   node scripts/fixCommissionWithholding.js                      (dry run: lists what would be posted)
//   node scripts/fixCommissionWithholding.js --apply              (posts it)
//   node scripts/fixCommissionWithholding.js --business=<id>      (one company only)
//
// Safe to run again: a commission that already has its withholding leg is skipped.
import mongoose from "mongoose";
import dotenv from "dotenv";
import SaleCommission from "../modules/propertySale/models/SaleCommission.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import { postEntries } from "../services/ledgerPostingService.js";
import { resolveWhtPayableAccount } from "../services/withholdingTaxService.js";
import { aggregateChartOfAccountBalances } from "../services/chartAccountAggregationService.js";
import { round2 } from "../utils/math.js";

dotenv.config();

const getArg = (name) => {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : "";
};

const SOURCE = "property_sale_commission_payout";

async function main() {
  const mongoUrl = process.env.MONGO_URL || process.env.MONGODB_URL;
  if (!mongoUrl) throw new Error("MONGO_URL is required.");
  const apply = process.argv.includes("--apply");
  const businessArg = getArg("business");

  await mongoose.connect(mongoUrl);

  const commissions = await SaleCommission.find({ status: "paid", whtAmount: { $gt: 0 }, ...(businessArg ? { business: businessArg } : {}) }).lean();
  let fixed = 0;

  for (const commission of commissions) {
    const live = await FinancialLedgerEntry.find({
      business: commission.business, sourceTransactionType: SOURCE, sourceTransactionId: String(commission._id),
      status: { $nin: ["reversed", "void"] }, category: { $ne: "REVERSAL" },
    }).lean();

    const cashLeg = live.find((entry) => entry.direction === "credit" && entry.metadata?.postingRole !== "wht_payable");
    if (!cashLeg) { console.log(`${commission.commissionNumber}: no payout entries to correct, skipped`); continue; }
    if (live.some((entry) => ["wht_payable", "wht_correction"].includes(entry.metadata?.postingRole))) {
      console.log(`${commission.commissionNumber}: withholding already posted, skipped`);
      continue;
    }
    // the payout must have credited the gross: only then is there anything to correct
    if (Math.abs(cashLeg.amount - round2(commission.commissionAmount)) > 0.01) {
      console.log(`${commission.commissionNumber}: cashbook leg is ${cashLeg.amount}, not the gross ${commission.commissionAmount}, needs a manual look`);
      continue;
    }

    const wht = round2(commission.whtAmount);
    console.log(`${commission.commissionNumber}: gross ${commission.commissionAmount}, WHT ${wht}: Dr cashbook / Cr 2141 ${wht}${apply ? "" : "   (dry run)"}`);
    if (!apply) continue;

    const whtAccount = await resolveWhtPayableAccount({ businessId: commission.business });
    const date = commission.payoutDate ? new Date(commission.payoutDate) : new Date();
    const start = new Date(date); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    const base = {
      business: commission.business, sourceTransactionType: SOURCE, sourceTransactionId: String(commission._id),
      transactionDate: date, statementPeriodStart: start, statementPeriodEnd: end, journalGroupId: new mongoose.Types.ObjectId(),
      category: "PROPERTY_SALE_COMMISSION_PAYOUT", createdBy: cashLeg.createdBy, allowUnscoped: true, amount: wht,
      notes: `Withholding tax on agent commission — ${commission.commissionNumber} (correction)`,
      metadata: { postingRole: "wht_correction", whtRate: commission.whtRate },
    };
    await postEntries([
      { ...base, accountId: cashLeg.accountId, direction: "debit" },
      { ...base, accountId: whtAccount._id, direction: "credit" },
    ]);
    await aggregateChartOfAccountBalances(commission.business, [String(cashLeg.accountId), String(whtAccount._id)]);
    fixed += 1;
  }

  console.log(apply ? `Done: ${fixed} commission(s) corrected.` : "Dry run only. Nothing was posted. Re-run with --apply to post.");
  await mongoose.disconnect();
}

main().catch((error) => { console.error(error); process.exit(1); });
