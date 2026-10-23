// Deferred agency-commission income: a deal whose proceeds sit in an advocate's trust account defers
// the company's own commission income (Cr 2186 Agency Commission Payable (Unremitted), not 4430) until
// an explicit Agency Commission Payout — the one event that finally recognizes it (Dr 2186 / Cr 4430 /
// Dr Cashbook / Cr 1314). A deal paid directly to the company recognizes immediately, unchanged.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import { getAccountByCode } from "../../../test/factories.financial.js";
import SaleAdvocate from "../models/SaleAdvocate.js";
import SaleOwner from "../models/SaleOwner.js";
import SaleProject from "../models/SaleProject.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleListing from "../models/SaleListing.js";
import SaleOwnerCommission from "../models/SaleOwnerCommission.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import { createDeal } from "./dealsController.js";
import { createPayment } from "./paymentsController.js";
import { updateCommissionReleaseSchedule } from "./settingsController.js";
import {
  createAgencyCommissionPayout, listOutstandingAgencyCommissions, listAgencyCommissionPayouts, voidAgencyCommissionPayout,
} from "./agencyCommissionPayoutsController.js";

let seq = 0;

const setup = async () => {
  const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
  await createTestChartOfAccounts(company._id);
  const staffUser = await createTestUser({ company });
  const business = company._id;
  const staffCall = (fn, opts = {}) => callController(fn, { user: staffUser, ...opts });

  // Deferral only applies to a STAGED commission — a tier fires AFTER real payment progress, so the
  // deal's trust balance at that moment genuinely reflects what's been collected. A single full-release
  // (100%) tier keeps this a one-tier-per-deal setup, same shape the tests below assume.
  await staffCall(updateCommissionReleaseSchedule, {
    body: { enabled: true, ownerCommissionTiers: [{ thresholdPct: 100, releasePct: 100 }], brokerCommissionTiers: [{ thresholdPct: 100, releasePct: 100 }] },
  });

  const advocate = await SaleAdvocate.create({ business, advocateNumber: `ADV-${++seq}`, fullName: "John Advocate", phone: `0733${seq}` });
  const owner = await SaleOwner.create({ business, ownerNumber: `OWN-${++seq}`, fullName: "Jane Owner", phone: `0722${seq}` });
  const project = await SaleProject.create({ business, projectNumber: `PRJ-${seq}`, name: `Estate ${seq}`, owner: owner._id, assignedAdvocate: advocate._id });

  const advocateUser = await createTestUser({ company: { _id: business }, adminAccess: false });
  await SaleAdvocate.updateOne({ _id: advocate._id }, { userIds: [advocateUser._id] });
  const asAdvocate = (fn, opts = {}) => callController(fn, { user: advocateUser, saleAdvocateId: String(advocate._id), ...opts });

  // Each makeDeal() call creates the deal itself with zero tier releases — the tier only fires once a
  // payment crosses 100%, which every test below does with its own single full-price payment.
  const makeDeal = async (agreedPrice = 1_000_000) => {
    const n = ++seq;
    const listing = await SaleListing.create({ business, listingNumber: `L-${n}`, title: `Plot ${n}`, askingPrice: agreedPrice, project: project._id, unitNumber: `U${n}` });
    const buyer = await SaleBuyer.create({ business, buyerNumber: `B-${n}`, fullName: `Buyer ${n}`, phone: `0700${n}`, email: `b${n}@example.com` });
    const res = await staffCall(createDeal, { body: { listing: String(listing._id), buyer: String(buyer._id), agreedPrice } });
    return res.payload;
  };

  return { business, staffCall, asAdvocate, advocate, owner, makeDeal };
};

describe("agency commission deferral — tier release", () => {
  it("defers income (Cr 2186) for a deal funded via advocate trust", async () => {
    const { business, staffCall, makeDeal } = await setup();
    const deal = await makeDeal(1_000_000);
    await staffCall(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment", collectionMethod: "advocate_trust" } });

    const commission = await SaleOwnerCommission.findOne({ business, deal: deal._id }).lean();
    expect(commission.tierReleases).toHaveLength(1);
    expect(commission.tierReleases[0].deferred).toBe(true);

    const deferredAcc = await getAccountByCode(business, "2186");
    const legs = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_owner_commission_tier", sourceTransactionId: `${commission._id}:tier:${commission.tierReleases[0]._id}` }).lean();
    expect(legs.find((l) => l.direction === "credit")).toMatchObject({ accountId: deferredAcc._id });
    // 4430 is never even resolved/created for a fully-deferred tier — nothing was posted to it at all.
    const ChartOfAccount = (await import("../../../models/ChartOfAccount.js")).default;
    expect(await ChartOfAccount.findOne({ business, code: "4430" }).lean()).toBeNull();
  });

  it("recognizes income immediately (Cr 4430) for a deal paid directly, unchanged from before", async () => {
    const { business, staffCall, makeDeal } = await setup();
    const deal = await makeDeal(1_000_000);
    await staffCall(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment" } }); // direct, not advocate_trust

    const commission = await SaleOwnerCommission.findOne({ business, deal: deal._id }).lean();
    expect(commission.tierReleases[0].deferred).toBe(false);

    const incomeAcc = await getAccountByCode(business, "4430");
    const legs = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_owner_commission_tier", sourceTransactionId: `${commission._id}:tier:${commission.tierReleases[0]._id}` }).lean();
    expect(legs.find((l) => l.direction === "credit")).toMatchObject({ accountId: incomeAcc._id, credit: 30_000 });
  });
});

describe("agency commission payout — outstanding list and scoping", () => {
  it("an advocate sees their own deferred, unpaid commission", async () => {
    const { business, staffCall, asAdvocate, makeDeal } = await setup();
    const deal = await makeDeal(1_000_000);
    await staffCall(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment", collectionMethod: "advocate_trust" } });
    const commission = await SaleOwnerCommission.findOne({ business, deal: deal._id }).lean();

    const res = await asAdvocate(listOutstandingAgencyCommissions, {});
    expect(res.payload.data).toHaveLength(1);
    expect(res.payload.data[0]).toMatchObject({ outstanding: 30_000, deferredAmount: 30_000 });
    expect(String(res.payload.data[0].ownerCommissionId)).toBe(String(commission._id));
  });

  it("a different advocate (no relationship to this deal) sees nothing", async () => {
    const { business, staffCall, makeDeal } = await setup();
    const deal = await makeDeal(1_000_000);
    await staffCall(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment", collectionMethod: "advocate_trust" } });

    const otherUser = await createTestUser({ company: { _id: business }, adminAccess: false });
    const otherAdvocate = await SaleAdvocate.create({ business, advocateNumber: `ADV-OTHER-${++seq}`, fullName: "Other Advocate", phone: `0744${seq}`, userIds: [otherUser._id] });
    const res = await callController(listOutstandingAgencyCommissions, { user: otherUser, saleAdvocateId: String(otherAdvocate._id) });
    expect(res.payload.data).toEqual([]);
  });

  it("a non-trust (direct-paid) deal never shows up here — nothing was deferred", async () => {
    const { staffCall, asAdvocate, makeDeal } = await setup();
    const deal = await makeDeal(1_000_000);
    await staffCall(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment" } });

    const res = await asAdvocate(listOutstandingAgencyCommissions, {});
    expect(res.payload.data).toEqual([]);
  });
});

describe("agency commission payout — create", () => {
  it("pays out the full deferred amount: posts the 4-leg entry and the commission drops off the outstanding list", async () => {
    const { business, staffCall, asAdvocate, makeDeal } = await setup();
    const deal = await makeDeal(1_000_000);
    await staffCall(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment", collectionMethod: "advocate_trust" } });
    const commission = await SaleOwnerCommission.findOne({ business, deal: deal._id }).lean();

    const res = await asAdvocate(createAgencyCommissionPayout, {
      body: { allocations: [{ ownerCommission: String(commission._id), amount: 30_000 }] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.payload.amount).toBe(30_000);
    expect(res.payload.payoutNumber).toMatch(/^ACP/);

    const legs = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_agency_commission_payout", sourceTransactionId: String(res.payload._id) }).lean();
    expect(legs).toHaveLength(4);
    const deferredAcc = await getAccountByCode(business, "2186");
    const incomeAcc = await getAccountByCode(business, "4430");
    const trustAcc = await getAccountByCode(business, "1314");
    expect(legs.find((l) => l.direction === "debit" && String(l.accountId) === String(deferredAcc._id))).toMatchObject({ debit: 30_000 });
    expect(legs.find((l) => l.direction === "credit" && String(l.accountId) === String(incomeAcc._id))).toMatchObject({ credit: 30_000 });
    expect(legs.find((l) => l.direction === "credit" && String(l.accountId) === String(trustAcc._id))).toMatchObject({ credit: 30_000 });
    expect(legs.filter((l) => l.direction === "debit").reduce((s, l) => s + l.debit, 0)).toBe(
      legs.filter((l) => l.direction === "credit").reduce((s, l) => s + l.credit, 0)
    );

    const after = await asAdvocate(listOutstandingAgencyCommissions, {});
    expect(after.payload.data).toEqual([]);
  });

  it("rejects an allocation exceeding the commission's own outstanding balance", async () => {
    const { business, staffCall, asAdvocate, makeDeal } = await setup();
    const deal = await makeDeal(1_000_000);
    await staffCall(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment", collectionMethod: "advocate_trust" } });
    const commission = await SaleOwnerCommission.findOne({ business, deal: deal._id }).lean();

    await expect(asAdvocate(createAgencyCommissionPayout, {
      body: { allocations: [{ ownerCommission: String(commission._id), amount: 30_001 }] },
    })).rejects.toThrow(/exceeds its outstanding deferred balance/);
  });

  it("rejects when other disbursements have already drained the deal's trust below the commission's deferred amount", async () => {
    const { business, staffCall, asAdvocate, advocate, owner, makeDeal } = await setup();
    const deal = await makeDeal(1_000_000);
    await staffCall(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment", collectionMethod: "advocate_trust" } });
    const commission = await SaleOwnerCommission.findOne({ business, deal: deal._id }).lean();

    // The owner-payout cap (resolveOwnerOutstandingBalance) already prevents over-drawing through
    // normal means — by design, owner + commission entitlements always sum to exactly the agreed price,
    // so a LEGITIMATE owner payout can never leave less trust than the commission still needs. To
    // exercise this controller's OWN defensive trust-availability check specifically, insert a
    // SaleOwnerPayout directly at the model level (bypassing createOwnerPayout's own validation) to
    // simulate whatever edge case might drain a deal's trust unexpectedly.
    const SaleOwnerPayout = (await import("../models/SaleOwnerPayout.js")).default;
    await SaleOwnerPayout.create({
      business, payoutNumber: "OPY-DRAIN-TEST", owner: owner._id, deal: deal._id,
      amount: 990_000, source: "advocate_trust", advocate: advocate._id, reference: "OPY-DRAIN-TEST",
    });

    await expect(asAdvocate(createAgencyCommissionPayout, {
      body: { allocations: [{ ownerCommission: String(commission._id), amount: 30_000 }] },
    })).rejects.toThrow(/trust balance is only/);
  });

  it("settles two commissions across two deals in one combined payout", async () => {
    const { business, staffCall, asAdvocate, makeDeal } = await setup();
    const deal1 = await makeDeal(1_000_000);
    const deal2 = await makeDeal(500_000);
    await staffCall(createPayment, { body: { deal: String(deal1._id), amount: 1_000_000, paymentType: "installment", collectionMethod: "advocate_trust" } });
    await staffCall(createPayment, { body: { deal: String(deal2._id), amount: 500_000, paymentType: "installment", collectionMethod: "advocate_trust" } });
    const c1 = await SaleOwnerCommission.findOne({ business, deal: deal1._id }).lean();
    const c2 = await SaleOwnerCommission.findOne({ business, deal: deal2._id }).lean();

    const res = await asAdvocate(createAgencyCommissionPayout, {
      body: { allocations: [{ ownerCommission: String(c1._id), amount: 30_000 }, { ownerCommission: String(c2._id), amount: 15_000 }] },
    });
    expect(res.payload.amount).toBe(45_000);
    const legs = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_agency_commission_payout", sourceTransactionId: String(res.payload._id) }).lean();
    expect(legs.find((l) => l.direction === "credit" && l.credit === 45_000)).toBeTruthy();
  });
});

describe("agency commission payout — void", () => {
  it("reverses the GL and restores the commission's outstanding balance", async () => {
    const { business, staffCall, asAdvocate, makeDeal } = await setup();
    const deal = await makeDeal(1_000_000);
    await staffCall(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment", collectionMethod: "advocate_trust" } });
    const commission = await SaleOwnerCommission.findOne({ business, deal: deal._id }).lean();
    const created = await asAdvocate(createAgencyCommissionPayout, {
      body: { allocations: [{ ownerCommission: String(commission._id), amount: 30_000 }] },
    });

    const voided = await staffCall(voidAgencyCommissionPayout, { params: { id: String(created.payload._id) }, body: { reason: "test" } });
    expect(voided.payload.status).toBe("cancelled");

    const after = await asAdvocate(listOutstandingAgencyCommissions, {});
    expect(after.payload.data).toHaveLength(1);
    expect(after.payload.data[0].outstanding).toBe(30_000);
  });
});

describe("agency commission payout — list", () => {
  it("an advocate only ever lists their own payouts", async () => {
    const { business, staffCall, asAdvocate, advocate, makeDeal } = await setup();
    const deal = await makeDeal(1_000_000);
    await staffCall(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment", collectionMethod: "advocate_trust" } });
    const commission = await SaleOwnerCommission.findOne({ business, deal: deal._id }).lean();
    await asAdvocate(createAgencyCommissionPayout, { body: { allocations: [{ ownerCommission: String(commission._id), amount: 30_000 }] } });

    const mine = await asAdvocate(listAgencyCommissionPayouts, {});
    expect(mine.payload.data).toHaveLength(1);
    expect(String(mine.payload.data[0].advocate._id)).toBe(String(advocate._id));
  });
});
