// A commission's rate/type/WHT are snapshotted at deal creation from the agent's own record (broker) or
// SaleSettings.ownerCommissionDefaults (owner). A later correction to either must take effect on every
// still-open commission immediately — not just commissions created from then on — mirroring the same
// "resync on save" behavior already built for the release-schedule tiers.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import SaleAgent from "../models/SaleAgent.js";
import SaleOwner from "../models/SaleOwner.js";
import SaleProject from "../models/SaleProject.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleListing from "../models/SaleListing.js";
import SaleCommission from "../models/SaleCommission.js";
import SaleOwnerCommission from "../models/SaleOwnerCommission.js";
import { createDeal } from "./dealsController.js";
import { updateCommissionStatus } from "./commissionsController.js";
import { updateAgent } from "./agentsController.js";
import { updateOwnerCommissionDefaults } from "./settingsController.js";

let seq = 0;

const setup = async () => {
  const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const business = company._id;
  const call = (fn, opts = {}) => callController(fn, { user, ...opts });

  const n = ++seq;
  const agent = await SaleAgent.create({ business, agentNumber: `AG-${n}`, fullName: "Jane Agent", phone: `0711${n}`, commissionRate: 2, commissionType: "percentage" });
  const owner = await SaleOwner.create({ business, ownerNumber: `OWN-${n}`, fullName: "John Owner", phone: `0722${n}` });
  const project = await SaleProject.create({ business, projectNumber: `PRJ-${n}`, name: "Sunset Gardens", owner: owner._id });

  const newDeal = async () => {
    const m = ++seq;
    const listing = await SaleListing.create({ business, listingNumber: `L-${m}`, title: `Plot ${m}`, askingPrice: 1_000_000, project: project._id, unitNumber: `U${m}` });
    const buyer = await SaleBuyer.create({ business, buyerNumber: `B-${m}`, fullName: `Buyer ${m}`, phone: `0700${m}`, email: `b${m}@example.com` });
    const res = await call(createDeal, { body: { listing: String(listing._id), buyer: String(buyer._id), agent: String(agent._id), agreedPrice: 1_000_000 } });
    return res.payload;
  };

  const brokerCommission = (dealId) => SaleCommission.findOne({ business, deal: dealId }).lean();
  const ownerCommission  = (dealId) => SaleOwnerCommission.findOne({ business, deal: dealId }).lean();

  return { business, call, agent, owner, newDeal, brokerCommission, ownerCommission };
};

describe("broker commission — resync on agent rate save", () => {
  it("raising an agent's commissionRate recalculates every one of that agent's open commissions immediately", async () => {
    const { call, agent, newDeal, brokerCommission } = await setup();
    const deal1 = await newDeal();
    const deal2 = await newDeal();
    const bc1Before = await brokerCommission(deal1._id);
    expect(bc1Before.commissionAmount).toBe(20_000); // 2% of 1,000,000

    await call(updateAgent, { params: { id: String(agent._id) }, body: { commissionRate: 5 } });

    const bc1After = await brokerCommission(deal1._id);
    const bc2After = await brokerCommission(deal2._id);
    expect(bc1After.commissionRate).toBe(5);
    expect(bc1After.commissionAmount).toBe(50_000); // 5% of 1,000,000
    expect(bc2After.commissionAmount).toBe(50_000);
  });

  it("a 'paid' commission is never touched by the resync", async () => {
    const { call, agent, newDeal, brokerCommission } = await setup();
    const deal = await newDeal();
    const commission = await brokerCommission(deal._id);
    await call(updateCommissionStatus, { params: { id: String(commission._id) }, body: { status: "approved" } });
    await call(updateCommissionStatus, { params: { id: String(commission._id) }, body: { status: "paid", payoutDate: "2026-01-01", payoutMethod: "cash" } });

    await call(updateAgent, { params: { id: String(agent._id) }, body: { commissionRate: 9 } });

    const after = await brokerCommission(deal._id);
    expect(after.status).toBe("paid");
    expect(after.commissionAmount).toBe(20_000); // untouched — still the original 2% amount
  });

  it("another agent's commissions are unaffected", async () => {
    const { business, call, agent, newDeal, brokerCommission } = await setup();
    const otherAgent = await SaleAgent.create({ business, agentNumber: "AG-OTHER", fullName: "Other Agent", phone: "0799999999", commissionRate: 2 });
    const deal = await newDeal();

    await call(updateAgent, { params: { id: String(otherAgent._id) }, body: { commissionRate: 8 } });

    const after = await brokerCommission(deal._id);
    expect(after.commissionAmount).toBe(20_000); // unchanged — a different agent's rate changed, not this one's
  });

  it("saving an agent without actually changing the rate/type triggers no recalculation", async () => {
    const { call, agent, newDeal, brokerCommission } = await setup();
    const deal = await newDeal();
    const before = await brokerCommission(deal._id);

    await call(updateAgent, { params: { id: String(agent._id) }, body: { phone: "0799000000" } }); // unrelated field only

    const after = await brokerCommission(deal._id);
    expect(after.updatedAt).toEqual(before.updatedAt);
  });
});

describe("owner (agency) commission — resync on ownerCommissionDefaults save", () => {
  it("raising the company's owner commission rate recalculates every open agency commission", async () => {
    const { call, newDeal, ownerCommission } = await setup();
    const deal1 = await newDeal();
    const deal2 = await newDeal();
    const before = await ownerCommission(deal1._id);
    expect(before.commissionAmount).toBe(30_000); // default 3%

    await call(updateOwnerCommissionDefaults, { body: { rate: 4 } });

    const oc1 = await ownerCommission(deal1._id);
    const oc2 = await ownerCommission(deal2._id);
    expect(oc1.commissionAmount).toBe(40_000);
    expect(oc2.commissionAmount).toBe(40_000);
  });

  it("saving the same rate again triggers no recalculation", async () => {
    const { call, newDeal, ownerCommission } = await setup();
    const deal = await newDeal();
    const before = await ownerCommission(deal._id);

    await call(updateOwnerCommissionDefaults, { body: { rate: 3 } }); // the existing default, unchanged

    const after = await ownerCommission(deal._id);
    expect(after.updatedAt).toEqual(before.updatedAt);
  });
});
