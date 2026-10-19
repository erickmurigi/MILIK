// Staged commission release: tiers fire as a deal's buyer pays progress, keyed off cumulative %paid —
// independent of whether the company bothers paying out the broker in between.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import { getAccountByCode } from "../../../test/factories.financial.js";
import SaleAgent from "../models/SaleAgent.js";
import SaleOwner from "../models/SaleOwner.js";
import SaleProject from "../models/SaleProject.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleListing from "../models/SaleListing.js";
import SaleCommission from "../models/SaleCommission.js";
import SaleOwnerCommission from "../models/SaleOwnerCommission.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import { createDeal } from "./dealsController.js";
import { createPayment, updatePayment } from "./paymentsController.js";
import { updateCommissionReleaseSchedule } from "./settingsController.js";

let seq = 0;

const setup = async () => {
  const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const business = company._id;
  const call = (fn, opts = {}) => callController(fn, { user, ...opts });

  const agent = await SaleAgent.create({ business, agentNumber: "AG-1", fullName: "Jane Agent", phone: "0711000111", commissionRate: 2 });
  const owner = await SaleOwner.create({ business, ownerNumber: "OWN-1", fullName: "John Mwangi", phone: "0722000222" });
  const project = await SaleProject.create({ business, projectNumber: "PRJ-1", name: "Sunset Gardens", owner: owner._id });

  await call(updateCommissionReleaseSchedule, {
    body: {
      enabled: true,
      ownerCommissionTiers: [{ thresholdPct: 30, releasePct: 25 }, { thresholdPct: 100, releasePct: 100 }],
      brokerCommissionTiers: [{ thresholdPct: 50, releasePct: 100 }],
    },
  });

  const n = ++seq;
  const listing = await SaleListing.create({ business, listingNumber: `L-${n}`, title: `Plot ${n}`, askingPrice: 1_000_000, project: project._id, unitNumber: `U${n}` });
  const buyer = await SaleBuyer.create({ business, buyerNumber: `B-${n}`, fullName: `Buyer ${n}`, phone: `0700${n}`, email: `b${n}@example.com` });
  const dealRes = await call(createDeal, { body: { listing: String(listing._id), buyer: String(buyer._id), agent: String(agent._id), agreedPrice: 1_000_000 } });
  const deal = dealRes.payload;

  const pay = (amount) => call(createPayment, { body: { deal: String(deal._id), amount, paymentType: "installment" } });
  const brokerCommission = () => SaleCommission.findOne({ business, deal: deal._id }).lean();
  const ownerCommission  = () => SaleOwnerCommission.findOne({ business, deal: deal._id }).lean();
  const tierLegs = (sourceTransactionType) => FinancialLedgerEntry.find({ business, sourceTransactionType }).lean();

  return { business, call, deal, pay, brokerCommission, ownerCommission, tierLegs, updatePayment };
};

describe("staged commission release — tier crossings on payment", () => {
  it("releases the owner's first tier at 30% paid, nothing yet for the broker", async () => {
    const { pay, brokerCommission, ownerCommission, tierLegs } = await setup();
    await pay(300_000); // exactly 30%

    const oc = await ownerCommission();
    expect(oc.releasedAmount).toBe(7500); // 25% of 30,000
    expect(oc.tierReleases).toMatchObject([{ thresholdPct: 30, releasePct: 25, amount: 7500 }]);

    const bc = await brokerCommission();
    expect(bc.releasedAmount).toBe(0);
    expect(bc.tierReleases).toEqual([]);

    expect((await tierLegs("property_sale_owner_commission_tier")).length).toBe(2);
    expect((await tierLegs("property_sale_commission_tier")).length).toBe(0);
  });

  it("releases the broker's full commission at 50% paid, owner tier unaffected", async () => {
    const { pay, brokerCommission, ownerCommission } = await setup();
    await pay(300_000);
    await pay(200_000); // cumulative 500,000 = 50%

    const bc = await brokerCommission();
    expect(bc.releasedAmount).toBe(20000); // 100% of 20,000
    expect(bc.tierReleases).toMatchObject([{ thresholdPct: 50, releasePct: 100, amount: 20000 }]);

    const oc = await ownerCommission();
    expect(oc.releasedAmount).toBe(7500); // unchanged — no owner tier between 30 and 100
  });

  it("releases the owner's remaining 75% at full payment, with no stray rounding, and auto-approves — no manual approval step exists for this commission", async () => {
    const { pay, ownerCommission } = await setup();
    await pay(300_000);
    const partial = await ownerCommission();
    expect(partial.status).toBe("pending"); // only 25% released so far — not auto-approved yet

    await pay(200_000);
    await pay(500_000); // cumulative 1,000,000 = 100%

    const oc = await ownerCommission();
    expect(oc.releasedAmount).toBe(30000); // full commissionAmount, exactly
    expect(oc.tierReleases).toMatchObject([
      { thresholdPct: 30, releasePct: 25, amount: 7500 },
      { thresholdPct: 100, releasePct: 100, amount: 22500 },
    ]);
    expect(oc.status).toBe("approved"); // flipped automatically the instant the last tier crossed
  });

  it("jumping straight to 100% in one payment releases both owner tiers correctly in one call", async () => {
    const { pay, ownerCommission, brokerCommission } = await setup();
    await pay(1_000_000); // 0% -> 100% in one jump

    const oc = await ownerCommission();
    expect(oc.releasedAmount).toBe(30000);
    expect(oc.tierReleases).toMatchObject([
      { thresholdPct: 30, releasePct: 25, amount: 7500 },
      { thresholdPct: 100, releasePct: 100, amount: 22500 },
    ]);

    const bc = await brokerCommission();
    expect(bc.releasedAmount).toBe(20000);
  });

  it("a payment amount edit that drops %paid back below a crossed threshold does not claw anything back", async () => {
    const { pay, brokerCommission, updatePayment, call } = await setup();
    const res = await pay(500_000); // crosses the broker's 50% tier
    const bc1 = await brokerCommission();
    expect(bc1.releasedAmount).toBe(20000);

    // Edit the payment down to 100,000 (10% paid) — the broker's released tier must stay released
    await call(updatePayment, { params: { id: String(res.payload._id) }, body: { amount: 100_000 } });
    const bc2 = await brokerCommission();
    expect(bc2.releasedAmount).toBe(20000);
    expect(bc2.tierReleases.length).toBe(1);
  });
});

describe("staged commission release — disabled is a complete no-op (backward compatibility)", () => {
  it("a company that never enables the schedule gets empty releaseSchedule and no tier postings at all", async () => {
    const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
    await createTestChartOfAccounts(company._id);
    const user = await createTestUser({ company });
    const business = company._id;
    const call = (fn, opts = {}) => callController(fn, { user, ...opts });
    const agent = await SaleAgent.create({ business, agentNumber: "AG-1", fullName: "Jane Agent", phone: "0711000111", commissionRate: 2 });
    const listing = await SaleListing.create({ business, listingNumber: "L-1", title: "Plot 1", askingPrice: 1_000_000 });
    const buyer = await SaleBuyer.create({ business, buyerNumber: "B-1", fullName: "Buyer 1", phone: "0700000000", email: "b@example.com" });
    const dealRes = await call(createDeal, { body: { listing: String(listing._id), buyer: String(buyer._id), agent: String(agent._id), agreedPrice: 1_000_000 } });

    await call(createPayment, { body: { deal: String(dealRes.payload._id), amount: 1_000_000, paymentType: "installment" } });

    const commission = await SaleCommission.findOne({ business, deal: dealRes.payload._id }).lean();
    expect(commission.releaseSchedule).toEqual([]);
    expect(commission.tierReleases).toEqual([]);
    expect(commission.releasedAmount).toBe(0);
    expect((await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_commission_tier" }).lean()).length).toBe(0);
  });
});
