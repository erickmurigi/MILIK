// Commission rate/type/WHT are snapshotted onto SaleCommission at deal creation, deliberately — a later
// change to the agent's own rate (or the company's WHT default) must never silently rewrite an
// already-agreed deal. recalculateCommissionRate is the explicit, one-commission-at-a-time escape hatch:
// staff fix the agent's rate going forward, then (only if they choose to) refresh a specific still-pending
// commission that was created before that fix.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import SaleAgent from "../models/SaleAgent.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleListing from "../models/SaleListing.js";
import SaleCommission from "../models/SaleCommission.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import { createDeal } from "./dealsController.js";
import { createPayment } from "./paymentsController.js";
import { updateCommissionStatus, recalculateCommissionRate } from "./commissionsController.js";
import { updateCommissionDefaults, updateCommissionReleaseSchedule } from "./settingsController.js";

let seq = 0;

const setup = async (agentOverrides = {}) => {
  const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const business = company._id;
  const call = (fn, opts = {}) => callController(fn, { user, ...opts });

  const agent = await SaleAgent.create({ business, agentNumber: "AG-1", fullName: "Jane Agent", phone: "0711000111", commissionRate: 3, commissionType: "percentage", ...agentOverrides });

  const n = ++seq;
  const listing = await SaleListing.create({ business, listingNumber: `L-${n}`, title: `Plot ${n}`, askingPrice: 1_000_000, unitNumber: `U${n}` });
  const buyer = await SaleBuyer.create({ business, buyerNumber: `B-${n}`, fullName: `Buyer ${n}`, phone: `0700${n}`, email: `b${n}@example.com` });
  const dealRes = await call(createDeal, { body: { listing: String(listing._id), buyer: String(buyer._id), agent: String(agent._id), agreedPrice: 1_000_000 } });
  const commission = await SaleCommission.findOne({ business, deal: dealRes.payload._id }).lean();

  return { business, call, agent, commission };
};

describe("recalculateCommissionRate", () => {
  it("refreshes rate/amount/WHT from the agent's CURRENT rate — a pending commission created at 3% picks up the agent's new 2%", async () => {
    const { business, call, agent, commission } = await setup();
    expect(commission.commissionRate).toBe(3);
    expect(commission.commissionAmount).toBe(30_000); // 3% of 1,000,000

    await SaleAgent.updateOne({ _id: agent._id }, { commissionRate: 2 });

    const res = await call(recalculateCommissionRate, { params: { id: String(commission._id) } });
    expect(res.statusCode).toBe(200);
    expect(res.payload.commissionRate).toBe(2);
    expect(res.payload.commissionAmount).toBe(20_000); // 2% of 1,000,000, not 3%

    const reloaded = await SaleCommission.findById(commission._id).lean();
    expect(reloaded.commissionRate).toBe(2);
    expect(reloaded.commissionAmount).toBe(20_000);
  });

  it("also refreshes the WHT rate from the current company default", async () => {
    const { business, call, commission } = await setup();
    expect(commission.whtRate).toBe(5); // statutory default, nothing configured yet

    await call(updateCommissionDefaults, { body: { rate: 3, commissionType: "percentage", whtRate: 10 } });

    const res = await call(recalculateCommissionRate, { params: { id: String(commission._id) } });
    expect(res.payload.whtRate).toBe(10);
    expect(res.payload.whtAmount).toBe(3_000); // 10% of the (unchanged) 30,000 commission
    expect(res.payload.netAmount).toBe(27_000);
  });

  it("still rejects recalculating a paid commission — money has already moved", async () => {
    const { call, commission } = await setup();
    await call(updateCommissionStatus, { params: { id: String(commission._id) }, body: { status: "approved" } });
    await call(updateCommissionStatus, { params: { id: String(commission._id) }, body: { status: "paid", payoutDate: new Date().toISOString(), payoutMethod: "bank" } });

    await expect(
      call(recalculateCommissionRate, { params: { id: String(commission._id) } })
    ).rejects.toThrow(/pending or approved/i);
  });

  it("an approved, non-staged (legacy) commission: reverses the full accrual and reposts it at the new rate", async () => {
    const { business, call, agent, commission } = await setup();
    const approved = await call(updateCommissionStatus, { params: { id: String(commission._id) }, body: { status: "approved" } });
    expect(approved.statusCode).toBe(200);

    const entriesBefore = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_commission", sourceTransactionId: String(commission._id) }).lean();
    expect(entriesBefore).toHaveLength(2);
    expect(entriesBefore.reduce((s, e) => s + Number(e.credit || 0), 0)).toBe(30_000); // 3% of 1,000,000

    await SaleAgent.updateOne({ _id: agent._id }, { commissionRate: 2 });

    const res = await call(recalculateCommissionRate, { params: { id: String(commission._id) } });
    expect(res.statusCode).toBe(200);
    expect(res.payload.status).toBe("approved"); // status itself is untouched
    expect(res.payload.commissionRate).toBe(2);
    expect(res.payload.commissionAmount).toBe(20_000);

    // The old 3% entries are reversed (not deleted), and a fresh 2% accrual is posted under the same key.
    const allEntries = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_commission", sourceTransactionId: String(commission._id) }).lean();
    const live = allEntries.filter((e) => e.status !== "reversed" && e.category !== "REVERSAL");
    expect(live.reduce((s, e) => s + Number(e.credit || 0), 0)).toBe(20_000);
  });

  it("an approved, staged commission with tiers already accrued: reverses the accrued tiers and re-derives them against the agent's new rate", async () => {
    const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
    await createTestChartOfAccounts(company._id);
    const user = await createTestUser({ company });
    const business = company._id;
    const call = (fn, opts = {}) => callController(fn, { user, ...opts });

    const agent = await SaleAgent.create({ business, agentNumber: "AG-1", fullName: "Jane Agent", phone: "0711000111", commissionRate: 2, commissionType: "percentage" });
    await call(updateCommissionReleaseSchedule, {
      body: { enabled: true, ownerCommissionTiers: [], brokerCommissionTiers: [{ thresholdPct: 30, releasePct: 50 }, { thresholdPct: 100, releasePct: 100 }] },
    });

    const n = ++seq;
    const listing = await SaleListing.create({ business, listingNumber: `L-${n}`, title: `Plot ${n}`, askingPrice: 1_000_000, unitNumber: `U${n}` });
    const buyer = await SaleBuyer.create({ business, buyerNumber: `B-${n}`, fullName: `Buyer ${n}`, phone: `0700${n}`, email: `b${n}@example.com` });
    const dealRes = await call(createDeal, { body: { listing: String(listing._id), buyer: String(buyer._id), agent: String(agent._id), agreedPrice: 1_000_000 } });
    const deal = dealRes.payload;

    await call(createPayment, { body: { deal: String(deal._id), amount: 300_000, paymentType: "installment" } }); // 30% -> first tier: 50% of 2% of 1,000,000 = 10,000

    const commission = await SaleCommission.findOne({ business, deal: deal._id }).lean();
    expect(commission.releasedAmount).toBe(10_000);

    const approved = await call(updateCommissionStatus, { params: { id: String(commission._id) }, body: { status: "approved" } });
    expect(approved.statusCode).toBe(200);

    await SaleAgent.updateOne({ _id: agent._id }, { commissionRate: 4 }); // 4% of 1,000,000 = 40,000 total; first tier now 50% of 40,000 = 20,000

    const res = await call(recalculateCommissionRate, { params: { id: String(commission._id) } });
    expect(res.statusCode).toBe(200);
    expect(res.payload.commissionRate).toBe(4);
    expect(res.payload.commissionAmount).toBe(40_000);
    expect(res.payload.releasedAmount).toBe(20_000); // still only the 30%-crossed tier, re-derived at the new rate
    expect(res.payload.tierReleases).toHaveLength(1); // the 100% tier hasn't been reached yet — not re-fabricated

    const tierEntries = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_commission_tier" }).lean();
    const live = tierEntries.filter((e) => e.status !== "reversed" && e.category !== "REVERSAL");
    expect(live.reduce((s, e) => s + Number(e.credit || 0), 0)).toBe(20_000); // old 10,000 reversed, new 20,000 live
  });

  it("a commissionType change (percentage -> flat) on the agent also carries through", async () => {
    const { call, agent, commission } = await setup();
    await SaleAgent.updateOne({ _id: agent._id }, { commissionType: "flat", commissionRate: 50_000 });

    const res = await call(recalculateCommissionRate, { params: { id: String(commission._id) } });
    expect(res.payload.commissionType).toBe("flat");
    expect(res.payload.commissionRate).toBe(50_000);
    expect(res.payload.commissionAmount).toBe(50_000); // flat amount, not a % of saleAmount
  });
});
