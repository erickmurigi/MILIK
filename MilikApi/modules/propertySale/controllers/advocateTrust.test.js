// Advocate trust accounting: conveyancing advocates physically collect buyer payments into their own
// trust account before remitting to the company. This is orthogonal to the owner-commission/staged-release
// feature — tier-crossing keys off the buyer's SalePayment record regardless of collectionMethod, so
// nothing about commissions changes. See modules/propertySale/services/propertySaleAccountingService.js
// (1314 Advocate Trust Receivable, postSaleAdvocateRemittance) and middleware/advocateScope.js.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import { getAccountByCode } from "../../../test/factories.financial.js";
import SaleAgent from "../models/SaleAgent.js";
import SaleAdvocate from "../models/SaleAdvocate.js";
import SaleProject from "../models/SaleProject.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleListing from "../models/SaleListing.js";
import SaleCommission from "../models/SaleCommission.js";
import Company from "../../../models/Company.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import { createDeal, getDeal, listDeals } from "./dealsController.js";
import { createPayment } from "./paymentsController.js";
import { createRemittance, getAdvocateTrustBalance, getRemittance, listRemittances } from "./advocateRemittancesController.js";
import { getAdvocate, listAdvocates } from "./advocatesController.js";
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

describe("advocate trust remittance", () => {
  it("posts Dr cashbook / Cr 1314 and reduces the outstanding trust balance", async () => {
    const { business, call, advocate, cashbook, makeDeal } = await setup();
    const deal = await makeDeal();

    const payRes = await call(createPayment, {
      body: { deal: String(deal._id), amount: 300_000, paymentType: "installment", collectionMethod: "advocate_trust" },
    });
    expect(payRes.statusCode).toBe(201);

    const before = await call(getAdvocateTrustBalance, { params: { advocateId: String(advocate._id) } });
    expect(before.payload).toMatchObject({ collected: 300000, remitted: 0, outstanding: 300000 });

    const remitRes = await call(createRemittance, {
      body: { advocate: String(advocate._id), amount: 120_000, cashbook: String(cashbook._id), reference: "EFT-001" },
    });
    expect(remitRes.statusCode).toBe(201);

    const trustAcc = await getAccountByCode(business, "1314");
    const entries = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_advocate_remittance", sourceTransactionId: String(remitRes.payload._id) }).lean();
    expect(entries).toHaveLength(2);

    const debit = entries.find((e) => e.direction === "debit");
    expect(String(debit.accountId)).toBe(String(cashbook._id));
    expect(debit.debit).toBe(120000);

    const credit = entries.find((e) => e.direction === "credit");
    expect(String(credit.accountId)).toBe(String(trustAcc._id));
    expect(credit.credit).toBe(120000);

    const after = await call(getAdvocateTrustBalance, { params: { advocateId: String(advocate._id) } });
    expect(after.payload).toMatchObject({ collected: 300000, remitted: 120000, outstanding: 180000 });
  });
});

describe("advocate scoping — visibility and commission hiding", () => {
  it("an advocate-scoped user sees deals under their own assigned project, not another project's, and never sees commission fields", async () => {
    const { business, call, advocate, project, makeDeal } = await setup();
    const ownDeal = await makeDeal(project);

    // A second, unrelated project with no advocate assigned
    const otherProject = await SaleProject.create({ business, projectNumber: "PRJ-2", name: "Other Estate" });
    const otherDeal = await makeDeal(otherProject);

    // Link a company user to the advocate record (what SaleAdvocate.userId means). adminAccess:false and
    // no explicit permission grants, so hasCompanyActionPermission below reflects a real narrow account.
    const advocateUser = await createTestUser({ company: { _id: business }, adminAccess: false });
    await SaleAdvocate.updateOne({ _id: advocate._id }, { userId: advocateUser._id });

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

describe("advocate scoping — the advocates directory and remittances ledger", () => {
  it("an advocate-scoped user sees only their own record and remittances, never another advocate's", async () => {
    const { business, call, advocate, cashbook } = await setup();

    // A second, unrelated advocate with their own remittance history.
    const otherAdvocate = await SaleAdvocate.create({ business, advocateNumber: "ADV-2", fullName: "Other Advocate", phone: "0733000444" });
    await call(createRemittance, { body: { advocate: String(otherAdvocate._id), amount: 1, cashbook: String(cashbook._id), reference: "OTHER-1" } });

    const ownRemit = await call(createRemittance, { body: { advocate: String(advocate._id), amount: 1, cashbook: String(cashbook._id), reference: "OWN-1" } });
    expect(ownRemit.statusCode).toBe(201);

    const advocateUser = await createTestUser({ company: { _id: business }, adminAccess: false });
    await SaleAdvocate.updateOne({ _id: advocate._id }, { userId: advocateUser._id });

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

    // Remittances: own ledger only, even when the query string explicitly asks for another advocate.
    const listRemitRes = await asAdvocate(listRemittances, { query: { advocate: String(otherAdvocate._id) } });
    const remitAdvocateIds = listRemitRes.payload.data.map((r) => String(r.advocate?._id || r.advocate));
    expect(remitAdvocateIds.every((id) => id === String(advocate._id))).toBe(true);
    expect(remitAdvocateIds.length).toBeGreaterThan(0);

    const getOwnRemitRes = await asAdvocate(getRemittance, { params: { id: String(ownRemit.payload._id) } });
    expect(getOwnRemitRes.statusCode).toBe(200);

    const otherRemit = await call(createRemittance, { body: { advocate: String(otherAdvocate._id), amount: 1, cashbook: String(cashbook._id), reference: "OTHER-2" } });
    await expect(asAdvocate(getRemittance, { params: { id: String(otherRemit.payload._id) } })).rejects.toThrow();

    // Trust balance: own id works, another advocate's id is scoped out as 404.
    const ownBalance = await asAdvocate(getAdvocateTrustBalance, { params: { advocateId: String(advocate._id) } });
    expect(ownBalance.statusCode).toBe(200);
    await expect(asAdvocate(getAdvocateTrustBalance, { params: { advocateId: String(otherAdvocate._id) } })).rejects.toThrow();
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
