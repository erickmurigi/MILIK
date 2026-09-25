// Withholding tax on agent commissions: the rate a deal starts with, and what a payout posts.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import { getAccountByCode } from "../../../test/factories.financial.js";
import SaleAgent from "../models/SaleAgent.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleListing from "../models/SaleListing.js";
import SaleCommission from "../models/SaleCommission.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import { createDeal } from "./dealsController.js";
import { updateCommissionStatus } from "./commissionsController.js";
import { updateCommissionDefaults } from "./settingsController.js";

let seq = 0;

const setup = async () => {
  const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const business = company._id;
  const call = (fn, opts = {}) => callController(fn, { user, ...opts });
  const agent = await SaleAgent.create({ business, agentNumber: "AG-1", fullName: "Jane Agent", phone: "0711000111", commissionRate: 5 });
  const bank = await ChartOfAccount.create({ business, code: "1399", name: "Equity Bank", type: "asset", group: "assets", subGroup: "Cashbooks", isPosting: true });

  const newDeal = async (extra = {}) => {
    const n = ++seq;
    const listing = await SaleListing.create({ business, listingNumber: `L-${n}`, title: `Plot ${n}`, askingPrice: 1_000_000 });
    const buyer = await SaleBuyer.create({ business, buyerNumber: `B-${n}`, fullName: `Buyer ${n}`, phone: `0700${n}`, email: `b${n}@example.com` });
    const res = await call(createDeal, { body: { listing: String(listing._id), buyer: String(buyer._id), agent: String(agent._id), agreedPrice: 1_000_000, ...extra } });
    return SaleCommission.findOne({ business, deal: res.payload._id }).lean();
  };
  const setStatus = (id, body) => call(updateCommissionStatus, { params: { id: String(id) }, body });
  const payout = (id) => setStatus(id, { status: "paid", payoutDate: "2026-09-25", payoutMethod: "bank_transfer", cashbook: String(bank._id) });
  const legs = (id, type) => FinancialLedgerEntry.find({ business, sourceTransactionType: type, sourceTransactionId: String(id) }).lean();
  return { business, call, bank, newDeal, setStatus, payout, legs };
};

describe("commission withholding tax rate", () => {
  it("starts from the company default rate, unless the deal sets its own, and 0% is allowed", async () => {
    const { call, newDeal } = await setup();
    expect((await newDeal()).whtRate).toBe(5); // nothing configured: the statutory 5%

    await call(updateCommissionDefaults, { body: { whtRate: 10 } });
    const inherited = await newDeal();
    expect(inherited).toMatchObject({ whtRate: 10, commissionAmount: 50000, whtAmount: 5000, netAmount: 45000 });

    const own = await newDeal({ whtRate: 3 });
    expect(own).toMatchObject({ whtRate: 3, whtAmount: 1500, netAmount: 48500 });

    const none = await newDeal({ whtRate: 0 });
    expect(none).toMatchObject({ whtRate: 0, whtAmount: 0, netAmount: 50000 });
  });

  it("refuses a default rate outside 0-30%", async () => {
    const { call } = await setup();
    for (const whtRate of [-1, 31, "abc", ""]) {
      await expect(call(updateCommissionDefaults, { body: { whtRate } })).rejects.toThrow(/between 0 and 30/);
    }
    expect((await call(updateCommissionDefaults, { body: { whtRate: 0 } })).statusCode).toBe(200);
  });
});

describe("commission payout with withholding tax", () => {
  it("credits the cashbook only the net, and the tax to 2141 Withholding Tax Payable, balanced", async () => {
    const { business, bank, newDeal, setStatus, payout, legs } = await setup();
    const commission = await newDeal(); // 50,000 at 5%
    await setStatus(commission._id, { status: "approved" });
    expect((await payout(commission._id)).statusCode).toBe(200);

    const rows = await legs(commission._id, "property_sale_commission_payout");
    expect(rows.length).toBe(3);
    const wht = await getAccountByCode(business, "2141");
    const byAccount = (id) => rows.filter((r) => String(r.accountId) === String(id));
    expect(byAccount(bank._id)).toMatchObject([{ direction: "credit", amount: 47500 }]);
    expect(byAccount(wht._id)).toMatchObject([{ direction: "credit", amount: 2500 }]);
    expect(rows.reduce((s, r) => s + Number(r.debit || 0), 0)).toBe(50000);
    expect(rows.reduce((s, r) => s + Number(r.credit || 0), 0)).toBe(50000);
  });

  it("posts just two legs when nothing is withheld", async () => {
    const { newDeal, setStatus, payout, legs } = await setup();
    const commission = await newDeal({ whtRate: 0 });
    await setStatus(commission._id, { status: "approved" });
    await payout(commission._id);
    const rows = await legs(commission._id, "property_sale_commission_payout");
    expect(rows.length).toBe(2);
    expect(rows.find((r) => r.direction === "credit").amount).toBe(50000);
  });

  it("reversing a paid commission reverses every leg, tax included", async () => {
    const { newDeal, setStatus, payout, legs } = await setup();
    const commission = await newDeal();
    await setStatus(commission._id, { status: "approved" });
    await payout(commission._id);
    await setStatus(commission._id, { status: "reversed" });

    const rows = await legs(commission._id, "property_sale_commission_payout");
    expect(rows.length).toBe(6); // 3 legs + 3 reversing legs
    expect(rows.filter((r) => r.status === "reversed").length).toBe(3);
    expect(rows.reduce((s, r) => s + Number(r.debit || 0), 0)).toBe(rows.reduce((s, r) => s + Number(r.credit || 0), 0));
  });

  it("refuses the payout, leaving the commission approved and nothing posted, when the tax account is switched off", async () => {
    const { business, newDeal, setStatus, payout, legs } = await setup();
    const commission = await newDeal();
    await setStatus(commission._id, { status: "approved" });
    await ChartOfAccount.updateOne({ business, code: "2141" }, { $set: { isActive: false } });

    await expect(payout(commission._id)).rejects.toThrow(/inactive/i);
    expect((await SaleCommission.findById(commission._id).lean()).status).toBe("approved");
    expect((await legs(commission._id, "property_sale_commission_payout")).length).toBe(0);
  });
});
