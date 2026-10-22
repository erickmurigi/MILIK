// Deal-level commission release-schedule override — buyer/broker (or owner) may agree to different
// tiers for one specific deal. Each commission snapshots its own releaseSchedule at creation time
// already (see dealsController.resolveReleaseContext) — the override just lets that snapshot come from
// the request body instead of company settings, and flags itself so a later company-wide schedule edit
// (resyncOpenCommissionReleaseSchedules) never overwrites it.
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
import { createPayment } from "./paymentsController.js";
import { updateCommissionReleaseSchedule } from "./settingsController.js";
import { updateCommissionReleaseScheduleOverride } from "./commissionsController.js";
import { updateOwnerCommissionReleaseScheduleOverride } from "./ownerCommissionsController.js";

let seq = 0;

const setup = async () => {
  const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const business = company._id;
  const call = (fn, opts = {}) => callController(fn, { user, ...opts });

  // Company-wide default schedule, so a sibling non-overridden deal has something to resync against.
  await call(updateCommissionReleaseSchedule, {
    body: {
      enabled: true,
      brokerCommissionTiers: [{ thresholdPct: 30, releasePct: 50 }, { thresholdPct: 100, releasePct: 100 }],
      ownerCommissionTiers:  [{ thresholdPct: 30, releasePct: 25 }, { thresholdPct: 100, releasePct: 100 }],
    },
  });

  const agent = await SaleAgent.create({ business, agentNumber: `AG-${++seq}`, fullName: "Jane Agent", phone: "0711000111", commissionRate: 2 });
  const owner = await SaleOwner.create({ business, ownerNumber: `OWN-${++seq}`, fullName: "John Mwangi", phone: "0722000222" });

  const makeDeal = async (overrideBody = {}) => {
    const n = ++seq;
    const project = await SaleProject.create({ business, projectNumber: `PRJ-${n}`, name: `Sunset Gardens ${n}`, owner: owner._id });
    const listing = await SaleListing.create({ business, listingNumber: `L-${n}`, title: `Plot ${n}`, askingPrice: 1_000_000, project: project._id, unitNumber: `U${n}` });
    const buyer = await SaleBuyer.create({ business, buyerNumber: `B-${n}`, fullName: `Buyer ${n}`, phone: `0700${n}`, email: `b${n}@example.com` });
    const res = await call(createDeal, {
      body: { listing: String(listing._id), buyer: String(buyer._id), agent: String(agent._id), agreedPrice: 1_000_000, ...overrideBody },
    });
    return res.payload;
  };

  return { business, call, agent, owner, makeDeal };
};

describe("deal-level commission release schedule override — at creation", () => {
  it("stores custom tiers and flags both commissions as overridden", async () => {
    const { business, makeDeal } = await setup();
    const deal = await makeDeal({
      brokerCommissionTiersOverride: [{ thresholdPct: 20, releasePct: 60 }, { thresholdPct: 100, releasePct: 100 }],
      ownerCommissionTiersOverride:  [{ thresholdPct: 20, releasePct: 40 }, { thresholdPct: 100, releasePct: 100 }],
    });

    const broker = await SaleCommission.findOne({ business, deal: deal._id }).lean();
    expect(broker.releaseSchedule).toEqual([{ thresholdPct: 20, releasePct: 60 }, { thresholdPct: 100, releasePct: 100 }]);
    expect(broker.releaseScheduleOverridden).toBe(true);

    const owner = await SaleOwnerCommission.findOne({ business, deal: deal._id }).lean();
    expect(owner.releaseSchedule).toEqual([{ thresholdPct: 20, releasePct: 40 }, { thresholdPct: 100, releasePct: 100 }]);
    expect(owner.releaseScheduleOverridden).toBe(true);
  });

  it("an explicit empty-array override means immediate release for this deal only, still flagged overridden", async () => {
    const { business, makeDeal } = await setup();
    const deal = await makeDeal({ brokerCommissionTiersOverride: [], ownerCommissionTiersOverride: [] });

    const broker = await SaleCommission.findOne({ business, deal: deal._id }).lean();
    expect(broker.releaseSchedule).toEqual([]);
    expect(broker.releaseScheduleOverridden).toBe(true);

    const owner = await SaleOwnerCommission.findOne({ business, deal: deal._id }).lean();
    expect(owner.releaseSchedule).toEqual([]);
    expect(owner.releaseScheduleOverridden).toBe(true);
    // Owner commission has no manual approve step — immediate release still auto-recognizes it in full.
    expect(owner.status).toBe("approved");
    expect(owner.releasedAmount).toBe(owner.commissionAmount);
  });

  it("omitting the override fields falls through to the company default, not overridden", async () => {
    const { business, makeDeal } = await setup();
    const deal = await makeDeal();
    const broker = await SaleCommission.findOne({ business, deal: deal._id }).lean();
    expect(broker.releaseSchedule).toEqual([{ thresholdPct: 30, releasePct: 50 }, { thresholdPct: 100, releasePct: 100 }]);
    expect(broker.releaseScheduleOverridden).toBe(false);
  });

  it("rejects malformed override tiers (descending thresholds) and creates nothing", async () => {
    const { business, call, agent, owner } = await setup();
    const listing = await SaleListing.create({ business, listingNumber: "L-BAD", title: "Plot Bad", askingPrice: 1_000_000 });
    const buyer = await SaleBuyer.create({ business, buyerNumber: "B-BAD", fullName: "Buyer Bad", phone: "0700999999", email: "bad@example.com" });
    await expect(call(createDeal, {
      body: {
        listing: String(listing._id), buyer: String(buyer._id), agent: String(agent._id), agreedPrice: 1_000_000,
        brokerCommissionTiersOverride: [{ thresholdPct: 50, releasePct: 50 }, { thresholdPct: 20, releasePct: 100 }],
      },
    })).rejects.toThrow(/ascending order/);
    expect(await SaleListing.findById(listing._id).select("status").lean()).toMatchObject({ status: "available" });
  });

  it("a later company-wide schedule change skips the overridden deal but still resyncs a sibling non-overridden one", async () => {
    const { business, call, makeDeal } = await setup();
    const overriddenDeal   = await makeDeal({ brokerCommissionTiersOverride: [{ thresholdPct: 40, releasePct: 70 }, { thresholdPct: 100, releasePct: 100 }] });
    const defaultDeal      = await makeDeal();

    await call(updateCommissionReleaseSchedule, {
      body: {
        enabled: true,
        brokerCommissionTiers: [{ thresholdPct: 30, releasePct: 50 }, { thresholdPct: 60, releasePct: 80 }, { thresholdPct: 100, releasePct: 100 }],
        ownerCommissionTiers:  [{ thresholdPct: 30, releasePct: 25 }, { thresholdPct: 100, releasePct: 100 }],
      },
    });

    const overriddenAfter = await SaleCommission.findOne({ business, deal: overriddenDeal._id }).lean();
    expect(overriddenAfter.releaseSchedule).toEqual([{ thresholdPct: 40, releasePct: 70 }, { thresholdPct: 100, releasePct: 100 }]);

    const defaultAfter = await SaleCommission.findOne({ business, deal: defaultDeal._id }).lean();
    expect(defaultAfter.releaseSchedule).toEqual([{ thresholdPct: 30, releasePct: 50 }, { thresholdPct: 60, releasePct: 80 }, { thresholdPct: 100, releasePct: 100 }]);
  });
});

describe("deal-level commission release schedule override — on an existing commission", () => {
  it("sets an override on a just-created commission (nothing released yet), then 'clear' restores the company default", async () => {
    const { business, call, makeDeal } = await setup();
    const deal = await makeDeal();
    const broker = await SaleCommission.findOne({ business, deal: deal._id }).lean();
    expect(broker.releaseScheduleOverridden).toBe(false);

    const res = await call(updateCommissionReleaseScheduleOverride, {
      params: { id: String(broker._id) },
      body: { tiers: [{ thresholdPct: 10, releasePct: 90 }, { thresholdPct: 100, releasePct: 100 }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload.releaseScheduleOverridden).toBe(true);
    expect(res.payload.releaseSchedule).toEqual([{ thresholdPct: 10, releasePct: 90 }, { thresholdPct: 100, releasePct: 100 }]);

    const cleared = await call(updateCommissionReleaseScheduleOverride, { params: { id: String(broker._id) }, body: { clear: true } });
    expect(cleared.payload.releaseScheduleOverridden).toBe(false);
    expect(cleared.payload.releaseSchedule).toEqual([{ thresholdPct: 30, releasePct: 50 }, { thresholdPct: 100, releasePct: 100 }]);
  });

  it("blocks changing the schedule once a tier has already released", async () => {
    const { business, call, makeDeal } = await setup();
    const deal = await makeDeal();
    await call(createPayment, { body: { deal: String(deal._id), amount: 300_000, paymentType: "installment" } }); // crosses the 30% tier

    const broker = await SaleCommission.findOne({ business, deal: deal._id }).lean();
    expect(broker.tierReleases.length).toBe(1);

    await expect(call(updateCommissionReleaseScheduleOverride, {
      params: { id: String(broker._id) },
      body: { tiers: [{ thresholdPct: 10, releasePct: 90 }] },
    })).rejects.toThrow(/already released at least one tier/);
  });

  it("works the same way for the owner (agency) commission", async () => {
    const { business, call, makeDeal } = await setup();
    const deal = await makeDeal();
    const owner = await SaleOwnerCommission.findOne({ business, deal: deal._id }).lean();

    const res = await call(updateOwnerCommissionReleaseScheduleOverride, {
      params: { id: String(owner._id) },
      body: { tiers: [{ thresholdPct: 15, releasePct: 100 }] },
    });
    expect(res.payload.releaseScheduleOverridden).toBe(true);
    expect(res.payload.releaseSchedule).toEqual([{ thresholdPct: 15, releasePct: 100 }]);
  });
});
