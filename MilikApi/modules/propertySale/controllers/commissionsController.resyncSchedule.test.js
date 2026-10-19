// A commission already staged (non-empty releaseSchedule) must pick up a LATER edit to Settings >
// Commission Release immediately — otherwise it's stuck forever on whatever tiers existed when it was
// created, unable to ever reach 100% released if a tier was added afterward. updateCommissionReleaseSchedule
// resyncs every still-open staged commission right after saving; already-accrued tiers must never move.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import SaleAgent from "../models/SaleAgent.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleListing from "../models/SaleListing.js";
import SaleCommission from "../models/SaleCommission.js";
import { createDeal } from "./dealsController.js";
import { createPayment } from "./paymentsController.js";
import { updateCommissionReleaseSchedule } from "./settingsController.js";

let seq = 0;

const setup = async (brokerTiers) => {
  const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const business = company._id;
  const call = (fn, opts = {}) => callController(fn, { user, ...opts });

  await call(updateCommissionReleaseSchedule, { body: { enabled: true, ownerCommissionTiers: [], brokerCommissionTiers: brokerTiers } });

  const n = ++seq;
  const agent = await SaleAgent.create({ business, agentNumber: `AG-${n}`, fullName: "Jane Agent", phone: `0711${n}`, commissionRate: 2 });
  const listing = await SaleListing.create({ business, listingNumber: `L-${n}`, title: `Plot ${n}`, askingPrice: 1_000_000, unitNumber: `U${n}` });
  const buyer = await SaleBuyer.create({ business, buyerNumber: `B-${n}`, fullName: `Buyer ${n}`, phone: `0700${n}`, email: `b${n}@example.com` });
  const dealRes = await call(createDeal, { body: { listing: String(listing._id), buyer: String(buyer._id), agent: String(agent._id), agreedPrice: 1_000_000 } });
  const deal = dealRes.payload;

  const pay = (amount) => call(createPayment, { body: { deal: String(deal._id), amount, paymentType: "installment" } });
  const commission = () => SaleCommission.findOne({ business, deal: deal._id }).lean();

  return { business, call, commission, pay };
};

describe("commission release schedule — resync on settings save", () => {
  it("adding a later tier after the commission was created lets it reach 100% released, without re-crediting the already-accrued earlier tier", async () => {
    const { call, commission, pay } = await setup([{ thresholdPct: 30, releasePct: 50 }]);
    await pay(300_000); // crosses the only tier that existed at creation time

    const before = await commission();
    expect(before.releaseSchedule).toEqual([{ thresholdPct: 30, releasePct: 50 }]);
    expect(before.releasedAmount).toBe(10_000); // 50% of 20,000
    expect(before.tierReleases).toHaveLength(1);

    // Settings now adds a second tier — this commission was already staged (non-empty releaseSchedule),
    // so it must be resynced immediately, not left stuck on the old 1-tier schedule.
    await call(updateCommissionReleaseSchedule, {
      body: { enabled: true, ownerCommissionTiers: [], brokerCommissionTiers: [{ thresholdPct: 30, releasePct: 50 }, { thresholdPct: 70, releasePct: 100 }] },
    });

    const afterSync = await commission();
    expect(afterSync.releaseSchedule).toEqual([{ thresholdPct: 30, releasePct: 50 }, { thresholdPct: 70, releasePct: 100 }]);
    // The already-accrued tier is untouched — same amount, same tierReleases entry, nothing re-posted.
    expect(afterSync.releasedAmount).toBe(10_000);
    expect(afterSync.tierReleases).toHaveLength(1);

    // Paying the deal off to 70% now correctly fires the newly-added second tier.
    await pay(400_000); // cumulative 700,000 = 70%
    const afterSecondTier = await commission();
    expect(afterSecondTier.releasedAmount).toBe(20_000); // fully released
    expect(afterSecondTier.tierReleases).toHaveLength(2);
  });

  it("a commission already in sync with the saved tiers is left untouched (no spurious save)", async () => {
    const { call, commission } = await setup([{ thresholdPct: 30, releasePct: 50 }, { thresholdPct: 70, releasePct: 100 }]);
    const before = await commission();

    // Re-saving the exact same tiers must not change updatedAt or anything else.
    await call(updateCommissionReleaseSchedule, {
      body: { enabled: true, ownerCommissionTiers: [], brokerCommissionTiers: [{ thresholdPct: 30, releasePct: 50 }, { thresholdPct: 70, releasePct: 100 }] },
    });
    const after = await commission();
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it("a commission with no releaseSchedule at all (created before staging was enabled) is never converted into a staged one by a resync", async () => {
    const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
    await createTestChartOfAccounts(company._id);
    const user = await createTestUser({ company });
    const business = company._id;
    const call = (fn, opts = {}) => callController(fn, { user, ...opts });

    // Staging starts OFF — commission is created immediate-release (empty releaseSchedule).
    const agent = await SaleAgent.create({ business, agentNumber: "AG-X", fullName: "Jane Agent", phone: "0711999999", commissionRate: 2 });
    const listing = await SaleListing.create({ business, listingNumber: "L-X", title: "Plot X", askingPrice: 1_000_000 });
    const buyer = await SaleBuyer.create({ business, buyerNumber: "B-X", fullName: "Buyer X", phone: "0700999999", email: "bx@example.com" });
    const dealRes = await call(createDeal, { body: { listing: String(listing._id), buyer: String(buyer._id), agent: String(agent._id), agreedPrice: 1_000_000 } });
    const commission = await SaleCommission.findOne({ business, deal: dealRes.payload._id }).lean();
    expect(commission.releaseSchedule).toEqual([]);

    // Now staging gets turned on — this pre-existing immediate commission must NOT be retroactively staged.
    await call(updateCommissionReleaseSchedule, {
      body: { enabled: true, ownerCommissionTiers: [], brokerCommissionTiers: [{ thresholdPct: 50, releasePct: 100 }] },
    });
    const after = await SaleCommission.findById(commission._id).lean();
    expect(after.releaseSchedule).toEqual([]);
  });
});
