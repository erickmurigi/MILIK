// Verifies the Car Wash liability-clearing postings actually clear what was accrued — the same
// class of check that found a real bug on Landlord Remittance Payable (2110) in rentPayment.js
// (a settlement debit sized by an unrelated total instead of what was actually credited). Unlike
// that bug, these functions size every clearing debit from the SAME document field the accrual
// credited (commission.commissionAmount, credit.amount), so this is a positive-confirmation test,
// not a bug-driven one.
import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { createTestCompany, createTestChartOfAccounts } from "../../../test/factories.js";
import { getAccountByCode } from "../../../test/factories.financial.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import CarWashStaffCommission from "../models/CarWashStaffCommission.js";
import CarWashCommissionPayout from "../models/CarWashCommissionPayout.js";
import CarWashCustomerCredit from "../models/CarWashCustomerCredit.js";
import {
  postCarWashCommissionAccrual,
  postCarWashCommissionPayoutWithSavings,
  postCarWashCustomerCreditCreationLedger,
  postCarWashCreditAppliedLedger,
  resolveCarWashAccount,
} from "./carwashAccountingService.js";

const oid = () => new mongoose.Types.ObjectId();

const netBalance = async (business, accountId) => {
  const rows = await FinancialLedgerEntry.aggregate([
    { $match: { business: new mongoose.Types.ObjectId(String(business)), accountId: new mongoose.Types.ObjectId(String(accountId)), status: { $in: ["approved", "reversed"] } } },
    { $group: { _id: null, debit: { $sum: "$debit" }, credit: { $sum: "$credit" } } },
  ]);
  if (!rows.length) return 0;
  return Math.round((rows[0].credit - rows[0].debit) * 100) / 100; // normal liability balance sign
};

describe("Car Wash liability settlement — debit must clear exactly what was credited", () => {
  it("2160/2161: a commission payout-with-savings fully clears the payable and moves exactly the held amount to savings", async () => {
    const company = await createTestCompany({ modules: { carwash: true, accounts: true } });
    await createTestChartOfAccounts(company._id);
    const cashbookAccount = await getAccountByCode(company._id, "1100");

    const commission = await CarWashStaffCommission.create({
      business: company._id, job: oid(), staff: oid(), commissionAmount: 1000,
    });
    await postCarWashCommissionAccrual({ req: null, commission });

    const payableAccount = await resolveCarWashAccount(company._id, "2160");
    const savingsAccount = await resolveCarWashAccount(company._id, "2161");
    expect(await netBalance(company._id, payableAccount._id)).toBe(1000);

    const payout = await CarWashCommissionPayout.create({
      business: company._id, payoutNumber: "CWP-1", staff: commission.staff, amount: 700, cashbookAccount: cashbookAccount._id,
    });
    await postCarWashCommissionPayoutWithSavings({
      req: null, payout, cashbookAccount, commissionAmount: 1000, netCash: 700, savingsHeld: 300,
    });

    // The payable must be fully cleared — not partially, not over-cleared.
    expect(await netBalance(company._id, payableAccount._id)).toBe(0);
    // Exactly the held amount landed in savings, nothing more.
    expect(await netBalance(company._id, savingsAccount._id)).toBe(300);
  });

  it("2162: creating then fully applying a customer credit nets the liability back to zero", async () => {
    const company = await createTestCompany({ modules: { carwash: true, accounts: true } });
    await createTestChartOfAccounts(company._id);
    const cashbookAccount = await getAccountByCode(company._id, "1100");

    const credit = await CarWashCustomerCredit.create({
      business: company._id, customer: oid(), amount: 500, plates: ["KAA001A"], status: "active",
    });
    await postCarWashCustomerCreditCreationLedger({
      businessId: company._id, creditDoc: credit, cashbookAccountId: cashbookAccount._id, userId: oid(),
    });

    const liabilityAccount = await resolveCarWashAccount(company._id, "2162");
    expect(await netBalance(company._id, liabilityAccount._id)).toBe(500);

    await postCarWashCreditAppliedLedger({ businessId: company._id, credit, appliedToJob: { jobNumber: "J-1" }, userId: oid() });

    expect(await netBalance(company._id, liabilityAccount._id)).toBe(0);
  });
});
