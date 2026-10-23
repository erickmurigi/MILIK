// Advocate trust accounting: conveyancing advocates physically collect buyer payments into their own
// trust account, then pay the broker/owner/company directly out of it. This is orthogonal to the
// owner-commission/staged-release feature — tier-crossing keys off the buyer's SalePayment record
// regardless of collectionMethod, so nothing about commissions changes. See
// modules/propertySale/services/propertySaleAccountingService.js (1314 Advocate Trust Receivable) and
// middleware/advocateScope.js.
import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import { getAccountByCode } from "../../../test/factories.financial.js";
import SaleAgent from "../models/SaleAgent.js";
import SaleAdvocate from "../models/SaleAdvocate.js";
import SaleProject from "../models/SaleProject.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleListing from "../models/SaleListing.js";
import SaleCommission from "../models/SaleCommission.js";
import SalePaymentSchedule from "../models/SalePaymentSchedule.js";
import Company from "../../../models/Company.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import { createDeal, getDeal, listDeals } from "./dealsController.js";
import { createPayment } from "./paymentsController.js";
import { getAdvocateTrustBalance } from "./advocateTrustController.js";
import { getAdvocate, listAdvocates } from "./advocatesController.js";
import { getBuyer, listBuyers } from "./buyersController.js";
import { createOffer, getOffer, listOffers } from "./offersController.js";
import { getCommission, listCommissions } from "./commissionsController.js";
import { getProject, listProjects, listProjectUnits } from "./projectsController.js";
import { getListing, listListings } from "./listingsController.js";
import { getDashboardStats } from "./reportsController.js";
import { getOverdueSchedule } from "./scheduleController.js";
import { updateCommissionReleaseSchedule } from "./settingsController.js";
import { attachAdvocateScope } from "../middleware/advocateScope.js";
import { hasCompanyActionPermission } from "../../../utils/permissionControl.js";

let seq = 0;

const setup = async () => {
  const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const business = company._id;
  const call = (fn, opts = {}) => callController(fn, { user, ...opts });

  const agent = await SaleAgent.create({ business, agentNumber: "AG-1", fullName: "Jane Agent", phone: "0711000111", commissionRate: 2 });
  const advocate = await SaleAdvocate.create({ business, advocateNumber: "ADV-1", fullName: "John Advocate", firm: "Advocate & Co", phone: "0733000333" });
  const project = await SaleProject.create({ business, projectNumber: "PRJ-1", name: "Sunset Gardens", assignedAdvocate: advocate._id });
  const cashbook = await getAccountByCode(business, "1100"); // Cash on Hand

  const makeDeal = async (proj = project) => {
    const n = ++seq;
    const listing = await SaleListing.create({
      business, listingNumber: `L-${n}`, title: `Plot ${n}`, askingPrice: 1_000_000,
      project: proj ? proj._id : null, unitNumber: proj ? `U${n}` : undefined,
    });
    const buyer = await SaleBuyer.create({ business, buyerNumber: `B-${n}`, fullName: `Buyer ${n}`, phone: `0700${n}`, email: `b${n}@example.com` });
    const body = { listing: String(listing._id), buyer: String(buyer._id), agent: String(agent._id), agreedPrice: 1_000_000 };
    const res = await call(createDeal, { body });
    return res.payload;
  };

  return { business, call, agent, advocate, project, cashbook, makeDeal };
};

describe("advocate trust accounting — payment debit side", () => {
  it("an advocate_trust payment debits 1314 Advocate Trust Receivable instead of the cashbook; credit side (4410) is unchanged", async () => {
    const { business, call, advocate, cashbook, makeDeal } = await setup();
    const deal = await makeDeal();

    const res = await call(createPayment, {
      body: { deal: String(deal._id), amount: 200_000, paymentType: "installment", collectionMethod: "advocate_trust", cashbook: String(cashbook._id) },
    });
    expect(res.statusCode).toBe(201);
    expect(res.payload.collectionMethod).toBe("advocate_trust");
    expect(String(res.payload.advocate?._id || res.payload.advocate)).toBe(String(advocate._id));

    const trustAcc = await getAccountByCode(business, "1314");
    expect(trustAcc.name).toBe("Advocate Trust Receivable");
    expect(trustAcc.type).toBe("asset");

    const entries = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_payment", sourceTransactionId: String(res.payload._id) }).lean();
    expect(entries).toHaveLength(2);

    const debit = entries.find((e) => e.direction === "debit");
    expect(String(debit.accountId)).toBe(String(trustAcc._id));
    expect(debit.debit).toBe(200000);

    const revenueAcc = await getAccountByCode(business, "4410");
    const credit = entries.find((e) => e.direction === "credit");
    expect(String(credit.accountId)).toBe(String(revenueAcc._id));
    expect(credit.credit).toBe(200000);

    // the chosen cashbook must NOT have been debited — the whole point of advocate_trust
    expect(entries.some((e) => String(e.accountId) === String(cashbook._id))).toBe(false);
  });

  it("a direct payment (collectionMethod omitted) debits the cashbook exactly as before — pure regression check", async () => {
    const { business, call, cashbook, makeDeal } = await setup();
    const deal = await makeDeal();

    const res = await call(createPayment, {
      body: { deal: String(deal._id), amount: 150_000, paymentType: "installment", cashbook: String(cashbook._id) },
    });
    expect(res.statusCode).toBe(201);
    expect(res.payload.collectionMethod).toBe("direct");

    const entries = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_payment", sourceTransactionId: String(res.payload._id) }).lean();
    expect(entries).toHaveLength(2);
    const debit = entries.find((e) => e.direction === "debit");
    expect(String(debit.accountId)).toBe(String(cashbook._id));
    expect(debit.debit).toBe(150000);

    const revenueAcc = await getAccountByCode(business, "4410");
    const credit = entries.find((e) => e.direction === "credit");
    expect(String(credit.accountId)).toBe(String(revenueAcc._id));
    expect(credit.credit).toBe(150000);
  });

  it("auto-fills the payment's advocate from the deal's project.assignedAdvocate when not supplied", async () => {
    const { call, advocate, makeDeal } = await setup();
    const deal = await makeDeal();
    const res = await call(createPayment, { body: { deal: String(deal._id), amount: 50_000, paymentType: "installment" } });
    expect(res.statusCode).toBe(201);
    expect(String(res.payload.advocate?._id || res.payload.advocate)).toBe(String(advocate._id));
  });
});

describe("advocate trust balance", () => {
  it("collected reflects advocate_trust payments; outstanding starts equal to collected with nothing disbursed yet", async () => {
    const { business, call, advocate, makeDeal } = await setup();
    const deal = await makeDeal();

    const payRes = await call(createPayment, {
      body: { deal: String(deal._id), amount: 300_000, paymentType: "installment", collectionMethod: "advocate_trust" },
    });
    expect(payRes.statusCode).toBe(201);

    const balance = await call(getAdvocateTrustBalance, { params: { advocateId: String(advocate._id) } });
    expect(balance.payload).toMatchObject({ collected: 300000, outstanding: 300000 });
  });
});

describe("advocate scoping — visibility and commission hiding", () => {
  it("an advocate-scoped user sees deals under their own assigned project, not another project's, and never sees commission fields", async () => {
    const { business, call, advocate, project, makeDeal } = await setup();
    const ownDeal = await makeDeal(project);

    // A second, unrelated project with no advocate assigned
    const otherProject = await SaleProject.create({ business, projectNumber: "PRJ-2", name: "Other Estate" });
    const otherDeal = await makeDeal(otherProject);

    // Link a company user to the advocate record (what being listed in SaleAdvocate.userIds means). adminAccess:false and
    // no explicit permission grants, so hasCompanyActionPermission below reflects a real narrow account.
    const advocateUser = await createTestUser({ company: { _id: business }, adminAccess: false });
    await SaleAdvocate.updateOne({ _id: advocate._id }, { userIds: [advocateUser._id] });

    const asAdvocate = async (fn, opts = {}) => {
      const req = { user: advocateUser, query: opts.query || {}, body: opts.body || {}, params: opts.params || {}, headers: {} };
      await attachAdvocateScope(req, {}, (err) => { if (err) throw err; });
      expect(req.saleAdvocateId).toBe(String(advocate._id)); // sanity: the link actually took
      return callController(fn, { user: advocateUser, query: req.query, body: req.body, params: req.params, saleAdvocateId: req.saleAdvocateId });
    };

    const listRes = await asAdvocate(listDeals, {});
    const ids = listRes.payload.data.map((d) => String(d._id));
    expect(ids).toContain(String(ownDeal._id));
    expect(ids).not.toContain(String(otherDeal._id));

    // Commission rate/type must never leak to an advocate-scoped response
    const row = listRes.payload.data.find((d) => String(d._id) === String(ownDeal._id));
    expect(row.agent).toBeTruthy();
    expect(row.agent.commissionRate).toBeUndefined();
    expect(row.agent.commissionType).toBeUndefined();

    const getOwnRes = await asAdvocate(getDeal, { params: { id: String(ownDeal._id) } });
    expect(getOwnRes.statusCode).toBe(200);
    expect(getOwnRes.payload.agent.commissionRate).toBeUndefined();

    // The other project's deal is invisible to this advocate — scoped out as 404, not just filtered from a list
    await expect(asAdvocate(getDeal, { params: { id: String(otherDeal._id) } })).rejects.toThrow();

    // A commission-specific endpoint's permission check must reject this advocate-linked account outright:
    // no explicit grant exists for sale-commissions, and (unlike an admin) adminAccess is false, so the
    // generic permission gate the commissions route runs behind denies it.
    const companyDoc = await Company.findById(business).lean();
    const commissionsAllowed = hasCompanyActionPermission({
      user: advocateUser, company: companyDoc, moduleKey: "propertySale", resource: "sale-commissions", action: "view",
    });
    expect(commissionsAllowed).toBe(false);
  });
});

describe("advocate scoping — the advocates directory and trust balance", () => {
  it("an advocate-scoped user sees only their own record and trust balance, never another advocate's", async () => {
    const { business, call, advocate, cashbook, makeDeal } = await setup();

    const otherProject = await SaleProject.create({ business, projectNumber: "PRJ-2", name: "Other Estate", assignedAdvocate: null });
    const otherAdvocate = await SaleAdvocate.create({ business, advocateNumber: "ADV-2", fullName: "Other Advocate", phone: "0733000444" });
    await SaleProject.updateOne({ _id: otherProject._id }, { assignedAdvocate: otherAdvocate._id });
    const otherDeal = await makeDeal(otherProject);
    await call(createPayment, { body: { deal: String(otherDeal._id), amount: 100_000, paymentType: "installment", collectionMethod: "advocate_trust", cashbook: String(cashbook._id) } });

    const ownDeal = await makeDeal();
    await call(createPayment, { body: { deal: String(ownDeal._id), amount: 100_000, paymentType: "installment", collectionMethod: "advocate_trust", cashbook: String(cashbook._id) } });

    const advocateUser = await createTestUser({ company: { _id: business }, adminAccess: false });
    await SaleAdvocate.updateOne({ _id: advocate._id }, { userIds: [advocateUser._id] });

    const asAdvocate = async (fn, opts = {}) => {
      const req = { user: advocateUser, query: opts.query || {}, body: opts.body || {}, params: opts.params || {}, headers: {} };
      await attachAdvocateScope(req, {}, (err) => { if (err) throw err; });
      expect(req.saleAdvocateId).toBe(String(advocate._id));
      return callController(fn, { user: advocateUser, query: req.query, body: req.body, params: req.params, saleAdvocateId: req.saleAdvocateId });
    };

    // Directory: only their own record comes back, regardless of total advocates on the business.
    const listAdvRes = await asAdvocate(listAdvocates, {});
    const advIds = listAdvRes.payload.data.map((a) => String(a._id));
    expect(advIds).toEqual([String(advocate._id)]);
    expect(advIds).not.toContain(String(otherAdvocate._id));

    const getOwnAdvRes = await asAdvocate(getAdvocate, { params: { id: String(advocate._id) } });
    expect(getOwnAdvRes.statusCode).toBe(200);

    // Another advocate's record is a 404, not a 403 — existence isn't even confirmed.
    await expect(asAdvocate(getAdvocate, { params: { id: String(otherAdvocate._id) } })).rejects.toThrow();

    // Trust balance: own id works, another advocate's id is scoped out as 404.
    const ownBalance = await asAdvocate(getAdvocateTrustBalance, { params: { advocateId: String(advocate._id) } });
    expect(ownBalance.statusCode).toBe(200);
    expect(ownBalance.payload.collected).toBe(100000);
    await expect(asAdvocate(getAdvocateTrustBalance, { params: { advocateId: String(otherAdvocate._id) } })).rejects.toThrow();
  });
});

describe("advocate scoping — deal-level override and standalone-listing fallback", () => {
  it("a deal's own advocate overrides the project default in both directions", async () => {
    const { business, call, project, makeDeal } = await setup();
    const otherAdvocate = await SaleAdvocate.create({ business, advocateNumber: "ADV-2", fullName: "Other Advocate", phone: "0733000444" });

    // In the project's own default-advocate's project, but explicitly reassigned to a different advocate.
    const n = ++seq;
    const listing = await SaleListing.create({ business, listingNumber: `L-${n}`, title: `Plot ${n}`, askingPrice: 1_000_000, project: project._id, unitNumber: `U${n}` });
    const buyer = await SaleBuyer.create({ business, buyerNumber: `B-${n}`, fullName: `Buyer ${n}`, phone: `0700${n}`, email: `b${n}@example.com` });
    const overriddenRes = await call(createDeal, { body: { listing: String(listing._id), buyer: String(buyer._id), agreedPrice: 1_000_000, advocate: String(otherAdvocate._id) } });
    expect(overriddenRes.statusCode).toBe(201);
    expect(String(overriddenRes.payload.advocate?._id || overriddenRes.payload.advocate)).toBe(String(otherAdvocate._id));
    const overriddenDeal = overriddenRes.payload;

    const ownDeal = await makeDeal(project); // ordinary deal, no override, uses the project's default

    const asAdvocate = async (advocateUser, advocateId, fn, opts = {}) => {
      const req = { user: advocateUser, query: opts.query || {}, body: opts.body || {}, params: opts.params || {}, headers: {} };
      await attachAdvocateScope(req, {}, (err) => { if (err) throw err; });
      expect(req.saleAdvocateId).toBe(String(advocateId));
      return callController(fn, { user: advocateUser, query: req.query, body: req.body, params: req.params, saleAdvocateId: req.saleAdvocateId });
    };

    const projectAdvocateUser = await createTestUser({ company: { _id: business }, adminAccess: false });
    await SaleAdvocate.updateOne({ _id: project.assignedAdvocate }, { userIds: [projectAdvocateUser._id] });
    const otherAdvocateUser = await createTestUser({ company: { _id: business }, adminAccess: false });
    await SaleAdvocate.updateOne({ _id: otherAdvocate._id }, { userIds: [otherAdvocateUser._id] });

    // The project's own default advocate: sees the ordinary deal, but NOT the one explicitly
    // reassigned away from them, even though it sits in their own project.
    const projectAdvList = await asAdvocate(projectAdvocateUser, project.assignedAdvocate, listDeals, {});
    const projectAdvIds = projectAdvList.payload.data.map((d) => String(d._id));
    expect(projectAdvIds).toContain(String(ownDeal._id));
    expect(projectAdvIds).not.toContain(String(overriddenDeal._id));

    // The reassigned advocate: sees ONLY the overridden deal, not the project's other deals.
    const otherAdvList = await asAdvocate(otherAdvocateUser, otherAdvocate._id, listDeals, {});
    const otherAdvIds = otherAdvList.payload.data.map((d) => String(d._id));
    expect(otherAdvIds).toEqual([String(overriddenDeal._id)]);
  });

  it("a standalone listing (no project) falls back to its own assignedAdvocate", async () => {
    const { business, call } = await setup();
    const standaloneAdvocate = await SaleAdvocate.create({ business, advocateNumber: "ADV-3", fullName: "Standalone Advocate", phone: "0733000555" });

    const n = ++seq;
    const listing = await SaleListing.create({ business, listingNumber: `L-${n}`, title: `Standalone Plot`, askingPrice: 500_000, assignedAdvocate: standaloneAdvocate._id });
    const buyer = await SaleBuyer.create({ business, buyerNumber: `B-${n}`, fullName: `Buyer ${n}`, phone: `0700${n}`, email: `b${n}@example.com` });
    const dealRes = await call(createDeal, { body: { listing: String(listing._id), buyer: String(buyer._id), agreedPrice: 500_000 } });
    expect(dealRes.statusCode).toBe(201);

    const advocateUser = await createTestUser({ company: { _id: business }, adminAccess: false });
    await SaleAdvocate.updateOne({ _id: standaloneAdvocate._id }, { userIds: [advocateUser._id] });

    const req = { user: advocateUser, query: {}, body: {}, params: {}, headers: {} };
    await attachAdvocateScope(req, {}, (err) => { if (err) throw err; });
    expect(req.saleAdvocateId).toBe(String(standaloneAdvocate._id));

    const listRes = await callController(listDeals, { user: advocateUser, query: {}, saleAdvocateId: req.saleAdvocateId });
    expect(listRes.payload.data.map((d) => String(d._id))).toContain(String(dealRes.payload._id));
  });

  it("createDeal rejects an advocate id that doesn't belong to this business", async () => {
    const { business, call, makeDeal } = await setup();
    void (await makeDeal()); // just to exercise setup fully; not otherwise used
    const n = ++seq;
    const listing = await SaleListing.create({ business, listingNumber: `L-${n}`, title: `Plot ${n}`, askingPrice: 1_000_000 });
    const buyer = await SaleBuyer.create({ business, buyerNumber: `B-${n}`, fullName: `Buyer ${n}`, phone: `0700${n}`, email: `b${n}@example.com` });
    await expect(
      call(createDeal, { body: { listing: String(listing._id), buyer: String(buyer._id), agreedPrice: 1_000_000, advocate: new mongoose.Types.ObjectId().toString() } })
    ).rejects.toThrow(/advocate not found/i);
  });
});

describe("advocate scoping — buyers, offers and commissions", () => {
  it("an advocate-scoped user only sees buyers reachable through their own deals", async () => {
    const { business, call, project, makeDeal } = await setup();
    const ownDeal = await makeDeal(project);
    const otherProject = await SaleProject.create({ business, projectNumber: "PRJ-BUY", name: "Buyer Scope Estate" });
    const otherDeal = await makeDeal(otherProject);

    const advocateUser = await createTestUser({ company: { _id: business }, adminAccess: false });
    await SaleAdvocate.updateOne({ _id: project.assignedAdvocate }, { userIds: [advocateUser._id] });
    const asAdvocate = async (fn, opts = {}) => {
      const req = { user: advocateUser, query: opts.query || {}, body: opts.body || {}, params: opts.params || {}, headers: {} };
      await attachAdvocateScope(req, {}, (err) => { if (err) throw err; });
      return callController(fn, { user: advocateUser, query: req.query, body: req.body, params: req.params, saleAdvocateId: req.saleAdvocateId });
    };

    const listRes = await asAdvocate(listBuyers, {});
    const ids = listRes.payload.data.map((b) => String(b._id));
    expect(ids).toContain(String(ownDeal.buyer?._id || ownDeal.buyer));
    expect(ids).not.toContain(String(otherDeal.buyer?._id || otherDeal.buyer));

    const getOwnRes = await asAdvocate(getBuyer, { params: { id: String(ownDeal.buyer?._id || ownDeal.buyer) } });
    expect(getOwnRes.statusCode).toBe(200);
    await expect(asAdvocate(getBuyer, { params: { id: String(otherDeal.buyer?._id || otherDeal.buyer) } })).rejects.toThrow();
  });

  it("an advocate-scoped user only sees offers on listings they're the default advocate for", async () => {
    const { business, call, project } = await setup();
    const n1 = ++seq;
    const ownListing = await SaleListing.create({ business, listingNumber: `L-${n1}`, title: `Offer Plot ${n1}`, askingPrice: 800_000, project: project._id, unitNumber: `U${n1}` });
    const buyer1 = await SaleBuyer.create({ business, buyerNumber: `B-${n1}`, fullName: `Buyer ${n1}`, phone: `0700${n1}`, email: `b${n1}@example.com` });
    const ownOffer = await call(createOffer, { body: { listing: String(ownListing._id), buyer: String(buyer1._id), offerAmount: 780_000 } });
    expect(ownOffer.statusCode).toBe(201);

    const otherProject = await SaleProject.create({ business, projectNumber: "PRJ-OFR", name: "Offer Scope Estate" });
    const n2 = ++seq;
    const otherListing = await SaleListing.create({ business, listingNumber: `L-${n2}`, title: `Offer Plot ${n2}`, askingPrice: 500_000, project: otherProject._id, unitNumber: `U${n2}` });
    const buyer2 = await SaleBuyer.create({ business, buyerNumber: `B-${n2}`, fullName: `Buyer ${n2}`, phone: `0700${n2}`, email: `b${n2}@example.com` });
    const otherOffer = await call(createOffer, { body: { listing: String(otherListing._id), buyer: String(buyer2._id), offerAmount: 480_000 } });
    expect(otherOffer.statusCode).toBe(201);

    const advocateUser = await createTestUser({ company: { _id: business }, adminAccess: false });
    await SaleAdvocate.updateOne({ _id: project.assignedAdvocate }, { userIds: [advocateUser._id] });
    const asAdvocate = async (fn, opts = {}) => {
      const req = { user: advocateUser, query: opts.query || {}, body: opts.body || {}, params: opts.params || {}, headers: {} };
      await attachAdvocateScope(req, {}, (err) => { if (err) throw err; });
      return callController(fn, { user: advocateUser, query: req.query, body: req.body, params: req.params, saleAdvocateId: req.saleAdvocateId });
    };

    const listRes = await asAdvocate(listOffers, {});
    const ids = listRes.payload.data.map((o) => String(o._id));
    expect(ids).toContain(String(ownOffer.payload._id));
    expect(ids).not.toContain(String(otherOffer.payload._id));

    const getOwnRes = await asAdvocate(getOffer, { params: { id: String(ownOffer.payload._id) } });
    expect(getOwnRes.statusCode).toBe(200);
    await expect(asAdvocate(getOffer, { params: { id: String(otherOffer.payload._id) } })).rejects.toThrow();
  });

  it("an advocate-scoped user only sees commissions on their own deals, including in the summary stats", async () => {
    const { business, call, project, makeDeal } = await setup();
    const ownDeal = await makeDeal(project);
    const otherProject = await SaleProject.create({ business, projectNumber: "PRJ-COM", name: "Commission Scope Estate" });
    const otherDeal = await makeDeal(otherProject);

    const ownCommission = await SaleCommission.findOne({ business, deal: ownDeal._id }).lean();
    const otherCommission = await SaleCommission.findOne({ business, deal: otherDeal._id }).lean();
    expect(ownCommission).toBeTruthy();
    expect(otherCommission).toBeTruthy();

    const advocateUser = await createTestUser({ company: { _id: business }, adminAccess: false });
    await SaleAdvocate.updateOne({ _id: project.assignedAdvocate }, { userIds: [advocateUser._id] });
    const asAdvocate = async (fn, opts = {}) => {
      const req = { user: advocateUser, query: opts.query || {}, body: opts.body || {}, params: opts.params || {}, headers: {} };
      await attachAdvocateScope(req, {}, (err) => { if (err) throw err; });
      return callController(fn, { user: advocateUser, query: req.query, body: req.body, params: req.params, saleAdvocateId: req.saleAdvocateId });
    };

    const listRes = await asAdvocate(listCommissions, {});
    const ids = listRes.payload.data.map((c) => String(c._id));
    expect(ids).toContain(String(ownCommission._id));
    expect(ids).not.toContain(String(otherCommission._id));
    // The summary tiles must stay scoped too — not leak the other project's commission into the totals.
    const totalTiles = Object.values(listRes.payload.stats).reduce((sum, s) => sum + s.count, 0);
    expect(totalTiles).toBe(1);

    const getOwnRes = await asAdvocate(getCommission, { params: { id: String(ownCommission._id) } });
    expect(getOwnRes.statusCode).toBe(200);
    await expect(asAdvocate(getCommission, { params: { id: String(otherCommission._id) } })).rejects.toThrow();
  });
});

describe("advocate scoping — projects, units and listings", () => {
  it("an advocate-scoped user only sees the project(s) they're the default advocate for", async () => {
    const { business, project } = await setup();
    const otherProject = await SaleProject.create({ business, projectNumber: "PRJ-SCOPE", name: "Unrelated Estate" });

    const advocateUser = await createTestUser({ company: { _id: business }, adminAccess: false });
    await SaleAdvocate.updateOne({ _id: project.assignedAdvocate }, { userIds: [advocateUser._id] });
    const asAdvocate = async (fn, opts = {}) => {
      const req = { user: advocateUser, query: opts.query || {}, body: opts.body || {}, params: opts.params || {}, headers: {} };
      await attachAdvocateScope(req, {}, (err) => { if (err) throw err; });
      return callController(fn, { user: advocateUser, query: req.query, body: req.body, params: req.params, saleAdvocateId: req.saleAdvocateId });
    };

    const listRes = await asAdvocate(listProjects, {});
    const ids = listRes.payload.data.map((p) => String(p._id));
    expect(ids).toContain(String(project._id));
    expect(ids).not.toContain(String(otherProject._id));

    const getOwnRes = await asAdvocate(getProject, { params: { id: String(project._id) } });
    expect(getOwnRes.statusCode).toBe(200);
    await expect(asAdvocate(getProject, { params: { id: String(otherProject._id) } })).rejects.toThrow();
    await expect(asAdvocate(listProjectUnits, { params: { id: String(otherProject._id) } })).rejects.toThrow();

    const ownUnitsRes = await asAdvocate(listProjectUnits, { params: { id: String(project._id) } });
    expect(ownUnitsRes.statusCode).toBe(200);
  });

  it("an advocate-scoped user only sees listings/units they're the default advocate for (project or standalone)", async () => {
    const { business, project } = await setup();
    const n1 = ++seq;
    const ownUnit = await SaleListing.create({ business, listingNumber: `L-${n1}`, title: `Scope Unit ${n1}`, askingPrice: 900_000, project: project._id, unitNumber: `U${n1}` });

    const otherProject = await SaleProject.create({ business, projectNumber: "PRJ-LST", name: "Listing Scope Estate" });
    const n2 = ++seq;
    const otherUnit = await SaleListing.create({ business, listingNumber: `L-${n2}`, title: `Scope Unit ${n2}`, askingPrice: 400_000, project: otherProject._id, unitNumber: `U${n2}` });

    const standaloneAdvocate = await SaleAdvocate.create({ business, advocateNumber: "ADV-STANDALONE", fullName: "Standalone Advocate", phone: "0733000999" });
    const n3 = ++seq;
    const otherStandalone = await SaleListing.create({ business, listingNumber: `L-${n3}`, title: "Other Standalone Plot", askingPrice: 300_000, assignedAdvocate: standaloneAdvocate._id });

    const advocateUser = await createTestUser({ company: { _id: business }, adminAccess: false });
    await SaleAdvocate.updateOne({ _id: project.assignedAdvocate }, { userIds: [advocateUser._id] });
    const asAdvocate = async (fn, opts = {}) => {
      const req = { user: advocateUser, query: opts.query || {}, body: opts.body || {}, params: opts.params || {}, headers: {} };
      await attachAdvocateScope(req, {}, (err) => { if (err) throw err; });
      return callController(fn, { user: advocateUser, query: req.query, body: req.body, params: req.params, saleAdvocateId: req.saleAdvocateId });
    };

    const listRes = await asAdvocate(listListings, {});
    const ids = listRes.payload.data.map((l) => String(l._id));
    expect(ids).toContain(String(ownUnit._id));
    expect(ids).not.toContain(String(otherUnit._id));
    expect(ids).not.toContain(String(otherStandalone._id));
    // Stats tiles must stay scoped too
    const totalTiles = Object.values(listRes.payload.stats).reduce((sum, s) => sum + s.count, 0);
    expect(totalTiles).toBe(1);

    const getOwnRes = await asAdvocate(getListing, { params: { id: String(ownUnit._id) } });
    expect(getOwnRes.statusCode).toBe(200);
    await expect(asAdvocate(getListing, { params: { id: String(otherUnit._id) } })).rejects.toThrow();
    await expect(asAdvocate(getListing, { params: { id: String(otherStandalone._id) } })).rejects.toThrow();
  });
});

describe("advocate scoping — dashboard and overdue schedule", () => {
  it("getDashboardStats and getOverdueSchedule only reflect the advocate's own listings, deals and schedule items", async () => {
    const { business, project, makeDeal } = await setup();
    const ownDeal = await makeDeal(project);
    const otherProject = await SaleProject.create({ business, projectNumber: "PRJ-DASH", name: "Dashboard Scope Estate" });
    const otherDeal = await makeDeal(otherProject);

    const overdueDate = new Date(Date.now() - 5 * 86_400_000);
    await SalePaymentSchedule.create([
      { business, deal: ownDeal._id, installmentNumber: 1, dueDate: overdueDate, expectedAmount: 100_000, status: "overdue" },
      { business, deal: otherDeal._id, installmentNumber: 1, dueDate: overdueDate, expectedAmount: 50_000, status: "overdue" },
    ]);

    const advocateUser = await createTestUser({ company: { _id: business }, adminAccess: false });
    await SaleAdvocate.updateOne({ _id: project.assignedAdvocate }, { userIds: [advocateUser._id] });
    const asAdvocate = async (fn, opts = {}) => {
      const req = { user: advocateUser, query: opts.query || {}, body: opts.body || {}, params: opts.params || {}, headers: {} };
      await attachAdvocateScope(req, {}, (err) => { if (err) throw err; });
      return callController(fn, { user: advocateUser, query: req.query, body: req.body, params: req.params, saleAdvocateId: req.saleAdvocateId });
    };

    const dashRes = await asAdvocate(getDashboardStats, {});
    expect(dashRes.statusCode).toBe(200);
    expect(dashRes.payload.deals.active).toBe(1); // only ownDeal, not otherDeal
    const dealNumbers = dashRes.payload.recentDeals.map((d) => d.dealNumber);
    expect(dealNumbers).toContain(ownDeal.dealNumber);
    expect(dealNumbers).not.toContain(otherDeal.dealNumber);

    const overdueRes = await asAdvocate(getOverdueSchedule, {});
    expect(overdueRes.statusCode).toBe(200);
    expect(overdueRes.payload.total).toBe(1);
    expect(String(overdueRes.payload.data[0].deal?._id || overdueRes.payload.data[0].deal)).toBe(String(ownDeal._id));
  });
});

describe("orthogonality — commission tier release is unaffected by collectionMethod", () => {
  it("a staged commission tier fires correctly off cumulative %paid whether payments are direct or advocate_trust", async () => {
    const { business, call, makeDeal } = await setup();

    await call(updateCommissionReleaseSchedule, {
      body: { enabled: true, ownerCommissionTiers: [], brokerCommissionTiers: [{ thresholdPct: 50, releasePct: 100 }] },
    });

    const deal = await makeDeal();
    // Half direct, half advocate_trust — the tier should still fire once cumulative %paid crosses 50%
    await call(createPayment, { body: { deal: String(deal._id), amount: 300_000, paymentType: "installment", collectionMethod: "direct" } });
    const res = await call(createPayment, { body: { deal: String(deal._id), amount: 200_000, paymentType: "installment", collectionMethod: "advocate_trust" } });
    expect(res.statusCode).toBe(201);

    const commission = await SaleCommission.findOne({ business, deal: deal._id }).lean();
    expect(commission.releasedAmount).toBe(20000); // 100% of the 2% commission on 1,000,000
    expect(commission.tierReleases).toMatchObject([{ thresholdPct: 50, releasePct: 100, amount: 20000 }]);
  });
});
