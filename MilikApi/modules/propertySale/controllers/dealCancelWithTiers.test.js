// Phase 5: cancelDeal must reverse staged/tiered commission accruals (broker + owner), not just the
// legacy whole-amount accrual — and a staged commission can be paid out tier by tier, exactly as each
// one releases (never ahead of it — a payout is always capped at releasedAmount - paidOutAmount, not
// the full commissionAmount, until the last tier fires and the two converge).
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
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import SaleDeal from "../models/SaleDeal.js";
import { createDeal, cancelDeal } from "./dealsController.js";
import { createPayment, voidPayment } from "./paymentsController.js";
import { updateCommissionStatus } from "./commissionsController.js";
import { updateCommissionReleaseSchedule } from "./settingsController.js";

let seq = 0;

// Base setup shared by every test: a company with chart of accounts, one agent, one owner-linked project.
const setup = async () => {
  const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const business = company._id;
  const call = (fn, opts = {}) => callController(fn, { user, ...opts });

  const agent = await SaleAgent.create({ business, agentNumber: `AG-${++seq}`, fullName: "Jane Agent", phone: "0711000111", commissionRate: 2 });
  const owner = await SaleOwner.create({ business, ownerNumber: `OWN-${++seq}`, fullName: "John Mwangi", phone: "0722000222" });

  return { business, call, agent, owner };
};

// Creates a deal + optional owner-linked project, returns the deal payload plus the helpers tests need.
const makeDeal = async ({ business, call, agent, owner, withOwnerProject }) => {
  const n = ++seq;
  const project = withOwnerProject
    ? await SaleProject.create({ business, projectNumber: `PRJ-${n}`, name: `Sunset Gardens ${n}`, owner: owner._id })
    : null;
  const listing = await SaleListing.create({
    business, listingNumber: `L-${n}`, title: `Plot ${n}`, askingPrice: 1_000_000,
    project: project ? project._id : null, unitNumber: project ? `U${n}` : undefined,
  });
  const buyer = await SaleBuyer.create({ business, buyerNumber: `B-${n}`, fullName: `Buyer ${n}`, phone: `0700${n}`, email: `b${n}@example.com` });
  const res = await call(createDeal, { body: { listing: String(listing._id), buyer: String(buyer._id), agent: String(agent._id), agreedPrice: 1_000_000 } });
  return res.payload;
};

const pay = (call, deal, amount) => call(createPayment, { body: { deal: String(deal._id), amount, paymentType: "installment" } });

describe("cancelDeal — legacy deal, regression", () => {
  it("still hard-blocks cancellation when a (non-staged) broker commission is already paid, same message as before", async () => {
    const { business, call, agent, owner } = await setup();
    const deal = await makeDeal({ business, call, agent, owner, withOwnerProject: false });

    const commission = await SaleCommission.findOne({ business, deal: deal._id }).lean();
    expect(commission.releaseSchedule).toEqual([]); // legacy, no staged schedule

    await call(updateCommissionStatus, { params: { id: String(commission._id) }, body: { status: "approved" } });
    await call(updateCommissionStatus, {
      params: { id: String(commission._id) },
      body: { status: "paid", payoutDate: new Date().toISOString(), payoutMethod: "bank_transfer" },
    });

    await expect(call(cancelDeal, { params: { id: String(deal._id) }, body: {} }))
      .rejects.toThrow(/1 commission\(s\) have already been paid out — reverse them before cancelling this deal/);

    const dealAfter = await SaleDeal.findById(deal._id).lean();
    expect(dealAfter.status).toBe("active");
  });
});

describe("cancelDeal — staged broker commission, partial release", () => {
  const setupStaged = async () => {
    const base = await setup();
    const { business, call, agent, owner } = base;
    await call(updateCommissionReleaseSchedule, {
      body: {
        enabled: true,
        brokerCommissionTiers: [{ thresholdPct: 30, releasePct: 50 }, { thresholdPct: 100, releasePct: 100 }],
        ownerCommissionTiers:  [{ thresholdPct: 30, releasePct: 25 }, { thresholdPct: 100, releasePct: 100 }],
      },
    });
    const deal = await makeDeal({ business, call, agent, owner, withOwnerProject: true });
    const paymentRes = await pay(call, deal, 300_000); // exactly 30% — crosses only the first tier on each schedule
    // Tier release is a one-way ratchet (commissionReleaseService.applyTierCrossings) — voiding the
    // payment afterwards does NOT claw the accrued tier back, it only clears cancelDeal's unrelated
    // "non-deposit payment(s) must be voided" guard so the commission-reversal path can be exercised.
    await call(voidPayment, { params: { id: String(paymentRes.payload._id) } });
    return { ...base, deal };
  };

  it("reverses the broker commission's accrued tier cleanly and cancels it", async () => {
    const { business, call, deal } = await setupStaged();

    const brokerBefore = await SaleCommission.findOne({ business, deal: deal._id }).lean();
    expect(brokerBefore.status).toBe("pending"); // tier accrual never advances status
    expect(brokerBefore.releasedAmount).toBe(10000); // 50% of the 20,000 commission
    expect(brokerBefore.tierReleases.length).toBe(1);

    const res = await call(cancelDeal, { params: { id: String(deal._id) }, body: {} });
    expect(res.statusCode).toBe(200);

    const brokerAfter = await SaleCommission.findOne({ business, deal: deal._id }).lean();
    expect(brokerAfter.status).toBe("cancelled");

    const tierEntries = await FinancialLedgerEntry.find({
      business, sourceTransactionType: "property_sale_commission_tier",
      sourceTransactionId: `${brokerBefore._id}:tier:${brokerBefore.tierReleases[0]._id}`,
    }).lean();
    expect(tierEntries.length).toBeGreaterThan(0);
    expect(tierEntries.some((e) => e.status === "reversed")).toBe(true);
  });

  it("also reverses the owner commission's accrued tier and cancels it", async () => {
    const { business, call, deal } = await setupStaged();

    const ownerBefore = await SaleOwnerCommission.findOne({ business, deal: deal._id }).lean();
    expect(ownerBefore.status).toBe("pending");
    expect(ownerBefore.releasedAmount).toBe(7500); // 25% of the 30,000 owner commission
    expect(ownerBefore.tierReleases.length).toBe(1);

    const res = await call(cancelDeal, { params: { id: String(deal._id) }, body: {} });
    expect(res.statusCode).toBe(200);

    const ownerAfter = await SaleOwnerCommission.findOne({ business, deal: deal._id }).lean();
    expect(ownerAfter.status).toBe("cancelled");

    const tierEntries = await FinancialLedgerEntry.find({
      business, sourceTransactionType: "property_sale_owner_commission_tier",
      sourceTransactionId: `${ownerBefore._id}:tier:${ownerBefore.tierReleases[0]._id}`,
    }).lean();
    expect(tierEntries.length).toBeGreaterThan(0);
    expect(tierEntries.some((e) => e.status === "reversed")).toBe(true);
  });
});

describe("cancelDeal — updateCommissionStatus 'paid' gate on staged commissions", () => {
  it("pays out exactly the released tier when only some have fired, stays 'approved' (not 'paid'), and rejects asking for more than that", async () => {
    const { business, call, agent, owner } = await setup();
    await call(updateCommissionReleaseSchedule, {
      body: {
        enabled: true,
        brokerCommissionTiers: [{ thresholdPct: 30, releasePct: 50 }, { thresholdPct: 100, releasePct: 100 }],
        ownerCommissionTiers:  [{ thresholdPct: 30, releasePct: 25 }, { thresholdPct: 100, releasePct: 100 }],
      },
    });
    const deal = await makeDeal({ business, call, agent, owner, withOwnerProject: true });
    await pay(call, deal, 300_000); // only the first tier releases — 10,000 of 20,000

    const commission = await SaleCommission.findOne({ business, deal: deal._id }).lean();
    expect(commission.releasedAmount).toBe(10000);
    expect(commission.commissionAmount).toBe(20000);

    // Force to "approved" directly (bypassing the manual-approve GL flow, which is irrelevant to this gate)
    await SaleCommission.updateOne({ _id: commission._id }, { status: "approved" });

    // Asking for more than what's released (even though it's less than the full commissionAmount) is
    // rejected — a payout can never run ahead of accrual.
    await expect(call(updateCommissionStatus, {
      params: { id: String(commission._id) },
      body: { status: "paid", amount: 15000, payoutDate: new Date().toISOString(), payoutMethod: "bank_transfer" },
    })).rejects.toThrow(/exceeds what's released and unpaid so far/);

    // Omitting amount pays out exactly what's released (10,000) — not the full commissionAmount (20,000).
    const res = await call(updateCommissionStatus, {
      params: { id: String(commission._id) },
      body: { status: "paid", payoutDate: new Date().toISOString(), payoutMethod: "bank_transfer" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload.status).toBe("approved"); // not fully paid yet — tier 2 hasn't released
    expect(res.payload.paidOutAmount).toBe(10000);

    const payoutEntries = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_commission_payout" }).lean();
    expect(payoutEntries.length).toBeGreaterThan(0);
    const thisPayout = payoutEntries.filter((e) => e.sourceTransactionId.startsWith(`${commission._id}:payout:`));
    const net = thisPayout.reduce((s, e) => s + (e.debit || 0) - (e.credit || 0), 0);
    expect(Math.abs(net)).toBeLessThan(0.01); // the payout's own leg is internally balanced

    // A second attempt for the now-exhausted released balance correctly finds nothing left to pay.
    await expect(call(updateCommissionStatus, {
      params: { id: String(commission._id) },
      body: { status: "paid", payoutDate: new Date().toISOString(), payoutMethod: "bank_transfer" },
    })).rejects.toThrow(/Nothing available to pay out yet/);
  });

  it("allows marking a staged commission paid once every tier has released (gate doesn't over-block)", async () => {
    const { business, call, agent, owner } = await setup();
    await call(updateCommissionReleaseSchedule, {
      body: {
        enabled: true,
        brokerCommissionTiers: [{ thresholdPct: 30, releasePct: 50 }, { thresholdPct: 100, releasePct: 100 }],
        ownerCommissionTiers:  [{ thresholdPct: 30, releasePct: 25 }, { thresholdPct: 100, releasePct: 100 }],
      },
    });
    const deal = await makeDeal({ business, call, agent, owner, withOwnerProject: true });
    await pay(call, deal, 1_000_000); // 100% in one jump — every tier releases

    const commission = await SaleCommission.findOne({ business, deal: deal._id }).lean();
    expect(commission.releasedAmount).toBe(commission.commissionAmount);

    await SaleCommission.updateOne({ _id: commission._id }, { status: "approved" });

    const res = await call(updateCommissionStatus, {
      params: { id: String(commission._id) },
      body: { status: "paid", payoutDate: new Date().toISOString(), payoutMethod: "bank_transfer" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload.status).toBe("paid");

    const commissionAfter = await SaleCommission.findById(commission._id).lean();
    expect(commissionAfter.status).toBe("paid");
  });
});
