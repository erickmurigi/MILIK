// Verifies the auto-tagging added to the module's own postings (payment revenue, commission accrual) so
// Profit by Tag has real data without anyone hand-tagging a journal — see dealDimensions() in
// propertySaleAccountingService.js. Confirms both that the ledger entries carry the right dimensions AND
// that the tag summary report actually picks them up end to end.
import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { createTestCompany, createTestChartOfAccounts } from "../../../test/factories.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import SalePayment from "../models/SalePayment.js";
import SaleCommission from "../models/SaleCommission.js";
import { postPropertySalePaymentLedger, postPropertySaleCommissionAccrual } from "./propertySaleAccountingService.js";
import { getTagSummaryReport } from "../../../controllers/propertyController/tagReports.js";
import { callController } from "../../../test/callController.js";

const oid = () => new mongoose.Types.ObjectId();
const range = { startDate: "2000-01-01", endDate: "2100-01-01" };

describe("property-sale auto-tagging", () => {
  it("tags a payment's revenue ledger entries with the deal and listing, visible via Profit by Tag", async () => {
    const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
    await createTestChartOfAccounts(company._id);
    const business = company._id;
    const deal = oid();
    const listing = oid();

    const payment = await SalePayment.create({
      business, paymentNumber: "PMT-TAG-1", deal, listing, paymentType: "installment", amount: 50_000,
    });
    await postPropertySalePaymentLedger({ businessId: business, payment, userId: oid() });

    const legs = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_payment", sourceTransactionId: String(payment._id) }).lean();
    expect(legs).toHaveLength(2);
    for (const leg of legs) {
      expect(String(leg.dimensions?.saleDeal)).toBe(String(deal));
      expect(String(leg.dimensions?.saleListing)).toBe(String(listing));
    }

    const byDeal = (await callController(getTagSummaryReport, { user: { company: business }, query: { by: "deal", ...range } })).payload;
    expect(byDeal.rows).toEqual([expect.objectContaining({ income: 50_000, expenses: 0 })]);
  });

  it("tags a commission's accrual ledger entries with the deal and agent, visible via Profit by Tag", async () => {
    const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
    await createTestChartOfAccounts(company._id);
    const business = company._id;
    const deal = oid();
    const agent = oid();

    const commission = await SaleCommission.create({
      business, commissionNumber: "BC-TAG-1", deal, agent, saleAmount: 1_000_000,
      commissionRate: 2, commissionAmount: 20_000, whtRate: 5, whtAmount: 1_000, netAmount: 19_000, status: "approved",
    });
    await postPropertySaleCommissionAccrual({ businessId: business, commission, userId: oid() });

    const legs = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_commission", sourceTransactionId: String(commission._id) }).lean();
    expect(legs).toHaveLength(2);
    for (const leg of legs) {
      expect(String(leg.dimensions?.saleDeal)).toBe(String(deal));
      expect(String(leg.dimensions?.saleAgent)).toBe(String(agent));
    }

    const byAgent = (await callController(getTagSummaryReport, { user: { company: business }, query: { by: "agent", ...range } })).payload;
    expect(byAgent.rows).toEqual([expect.objectContaining({ expenses: 20_000, income: 0 })]);
  });
});
