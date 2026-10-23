// postPropertySaleCommissionPayout's default (no explicit source/whtHandledBy) behavior — a pure
// regression check that company_cashbook commission payouts keep posting byte-identically regardless of
// the advocate-trust-settlement machinery elsewhere in this module. The broader worked-example
// reconciliation this file used to run (company commission + broker commission + recoverable expense +
// owner payout, all settled via a generic advocate remittance) was retired along with that generic
// remittance flow — each of those pieces now has its own dedicated coverage: owner payout
// (ownerPayoutsController.test.js), broker commission payout
// (commissionsController.advocateTrustPayout.test.js), recoverable-expense recovery
// (rechargeRemittancesController.test.js), and deferred agency commission
// (agencyCommissionPayoutsController.test.js).
import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { createTestCompany, createTestChartOfAccounts } from "../../../test/factories.js";
import { getAccountByCode } from "../../../test/factories.financial.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import SaleCommission from "../models/SaleCommission.js";
import { postPropertySaleCommissionPayout, resolvePSAccount } from "./propertySaleAccountingService.js";

const oid = () => new mongoose.Types.ObjectId();

const legsFor = async (business, sourceTransactionType, sourceTransactionId) =>
  FinancialLedgerEntry.find({ business, sourceTransactionType, sourceTransactionId: String(sourceTransactionId), status: { $ne: "reversed" }, category: { $ne: "REVERSAL" } }).lean();

describe("postPropertySaleCommissionPayout — company_cashbook default", () => {
  it("is unaffected by source/whtHandledBy defaults — pure regression check", async () => {
    const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
    await createTestChartOfAccounts(company._id);
    const business = company._id;
    const userId = oid();
    const bank = await resolvePSAccount(business, "1311");

    const commission = await SaleCommission.create({
      business, commissionNumber: "BC-REG-1", deal: oid(), agent: oid(), saleAmount: 1_000_000,
      commissionRate: 2, commissionAmount: 20_000, whtRate: 5, whtAmount: 1_000, netAmount: 19_000, status: "approved",
    });
    // No source/whtHandledBy passed at all — defaults must reproduce today's exact posting.
    const commissionPayout = { _id: oid(), amount: 20_000, whtAmount: 1_000, netAmount: 19_000, method: "bank_transfer", date: new Date(), cashbook: bank._id };
    await postPropertySaleCommissionPayout({ businessId: business, commission, userId, payout: commissionPayout });

    const legs = await legsFor(business, "property_sale_commission_payout", `${commission._id}:payout:${commissionPayout._id}`);
    expect(legs).toHaveLength(3);
    const wht = await getAccountByCode(business, "2141");
    expect(legs.find((l) => String(l.accountId) === String(bank._id))).toMatchObject({ direction: "credit", credit: 19_000 });
    expect(legs.find((l) => String(l.accountId) === String(wht._id))).toMatchObject({ direction: "credit", credit: 1_000 });
  });
});
