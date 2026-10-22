// Owner payouts (§8.3c): create/list/get, over-payment rejection against the owner's outstanding
// balance, GL posting via postSaleOwnerPayout, and advocate_trust vs company_cashbook paths.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import { getAccountByCode } from "../../../test/factories.financial.js";
import SaleOwner from "../models/SaleOwner.js";
import SaleProject from "../models/SaleProject.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleListing from "../models/SaleListing.js";
import SaleAdvocate from "../models/SaleAdvocate.js";
import SaleOwnerPayout from "../models/SaleOwnerPayout.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import { createDeal } from "./dealsController.js";
import { createPayment } from "./paymentsController.js";
import {
  createOwnerPayout, getAdvocateOwnerTrustSummary, getOwnerOutstandingBalance, getOwnerPayout, listOwnerPayouts,
} from "./ownerPayoutsController.js";

let seq = 0;

const setup = async () => {
  const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const business = company._id;
  const call = (fn, opts = {}) => callController(fn, { user, ...opts });

  const advocate = await SaleAdvocate.create({ business, advocateNumber: "ADV-1", fullName: "John Advocate", phone: "0733000333" });
  const owner = await SaleOwner.create({ business, ownerNumber: "OWN-1", fullName: "Jane Owner", phone: "0722000222" });
  const project = await SaleProject.create({ business, projectNumber: "PRJ-1", name: "Sunset Gardens", owner: owner._id, assignedAdvocate: advocate._id });

  const n = ++seq;
  const listing = await SaleListing.create({ business, listingNumber: `L-${n}`, title: `Plot ${n}`, askingPrice: 1_000_000, project: project._id, unitNumber: `U${n}` });
  const buyer = await SaleBuyer.create({ business, buyerNumber: `B-${n}`, fullName: `Buyer ${n}`, phone: `0700${n}`, email: `b${n}@example.com` });
  const dealRes = await call(createDeal, { body: { listing: String(listing._id), buyer: String(buyer._id), agreedPrice: 1_000_000 } });
  const deal = dealRes.payload;
  // deal has no agent/broker and the project's owner default commission (3%) auto-recognizes 30,000 —
  // owner's outstanding net balance after the full price is paid: 1,000,000 - 30,000 = 970,000.

  // A second unit/deal under the SAME project+owner — used by the combined multi-deal payout tests
  // below, so the advocate ends up holding trust across two separate deals of the same owner.
  const makeSecondDeal = async () => {
    const n2 = ++seq;
    const listing2 = await SaleListing.create({ business, listingNumber: `L-${n2}`, title: `Plot ${n2}`, askingPrice: 500_000, project: project._id, unitNumber: `U${n2}` });
    const buyer2 = await SaleBuyer.create({ business, buyerNumber: `B-${n2}`, fullName: `Buyer ${n2}`, phone: `0700${n2}`, email: `b${n2}@example.com` });
    const dealRes2 = await call(createDeal, { body: { listing: String(listing2._id), buyer: String(buyer2._id), agreedPrice: 500_000 } });
    return dealRes2.payload;
  };

  const advocateUser = await createTestUser({ company: { _id: business }, adminAccess: false });
  await SaleAdvocate.updateOne({ _id: advocate._id }, { userIds: [advocateUser._id] });
  const asAdvocate = (fn, opts = {}) => callController(fn, { user: advocateUser, saleAdvocateId: String(advocate._id), ...opts });

  return { business, call, asAdvocate, advocate, owner, project, deal, makeSecondDeal };
};

describe("owner payouts — create / list / get", () => {
  it("creates a company_cashbook payout, lists it, and fetches it by id", async () => {
    const { business, call, owner, deal } = await setup();
    await call(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment" } });
    const bank = await getAccountByCode(business, "1100");

    const created = await call(createOwnerPayout, { body: { owner: String(owner._id), amount: 500_000, cashbook: String(bank._id), reference: "EFT-1" } });
    expect(created.statusCode).toBe(201);
    expect(created.payload.source).toBe("company_cashbook");
    expect(created.payload.payoutNumber).toMatch(/^OPY/);

    const list = await call(listOwnerPayouts, { query: { owner: String(owner._id) } });
    expect(list.payload.total).toBe(1);

    const got = await call(getOwnerPayout, { params: { id: String(created.payload._id) } });
    expect(got.statusCode).toBe(200);
    expect(String(got.payload.owner._id || got.payload.owner)).toBe(String(owner._id));
  });

  it("rejects a payout exceeding the owner's outstanding net balance", async () => {
    const { call, owner, deal } = await setup();
    await call(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment" } });
    // outstanding = 970,000; ask for more
    await expect(
      call(createOwnerPayout, { body: { owner: String(owner._id), amount: 980_000, reference: "EFT-2" } })
    ).rejects.toThrow(/outstanding balance/i);
  });

  it("rejects with no activity at all for the owner (outstanding balance is 0)", async () => {
    const { call, owner } = await setup();
    await expect(
      call(createOwnerPayout, { body: { owner: String(owner._id), amount: 1, reference: "EFT-3" } })
    ).rejects.toThrow(/outstanding balance/i);
  });

  it("rejects a blank reference", async () => {
    const { call, owner, deal } = await setup();
    await call(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment" } });
    await expect(
      call(createOwnerPayout, { body: { owner: String(owner._id), amount: 100_000 } })
    ).rejects.toThrow(/reference number is required/i);
    await expect(
      call(createOwnerPayout, { body: { owner: String(owner._id), amount: 100_000, reference: "   " } })
    ).rejects.toThrow(/reference number is required/i);
  });
});

describe("owner payouts — GL posting", () => {
  it("company_cashbook: Dr 2185 Owner Clearing / Cr cashbook, balanced", async () => {
    const { business, call, owner, deal } = await setup();
    await call(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment" } });
    const bank = await getAccountByCode(business, "1100");

    const created = await call(createOwnerPayout, { body: { owner: String(owner._id), amount: 400_000, cashbook: String(bank._id), reference: "EFT-4" } });
    const legs = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_owner_payout", sourceTransactionId: String(created.payload._id) }).lean();
    expect(legs).toHaveLength(2);
    const clearingAcc = await getAccountByCode(business, "2185");
    expect(legs.find((l) => l.direction === "debit")).toMatchObject({ accountId: clearingAcc._id, debit: 400_000 });
    expect(legs.find((l) => l.direction === "credit")).toMatchObject({ accountId: bank._id, credit: 400_000 });
  });

  it("advocate_trust: requires a deal, checks the deal's trust balance, and credits 1314 instead of a cashbook", async () => {
    const { business, call, owner, advocate, deal } = await setup();
    await call(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment", collectionMethod: "advocate_trust" } });

    const created = await call(createOwnerPayout, {
      body: { owner: String(owner._id), deal: String(deal._id), amount: 400_000, source: "advocate_trust", advocate: String(advocate._id), reference: "TR-1" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.payload.source).toBe("advocate_trust");

    const legs = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_owner_payout", sourceTransactionId: String(created.payload._id) }).lean();
    const trustAcc = await getAccountByCode(business, "1314");
    expect(legs.find((l) => l.direction === "credit")).toMatchObject({ accountId: trustAcc._id, credit: 400_000 });
  });

  it("advocate_trust without a deal is rejected", async () => {
    const { call, owner } = await setup();
    await expect(
      call(createOwnerPayout, { body: { owner: String(owner._id), amount: 1, source: "advocate_trust", reference: "TR-2" } })
    ).rejects.toThrow(/deal is required/i);
  });

  it("advocate_trust exceeding the deal's trust balance is rejected even though the owner's overall balance would cover it", async () => {
    const { call, owner, deal } = await setup();
    // Paid directly, not into trust — deal's advocate trust balance is 0.
    await call(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment" } });
    await expect(
      call(createOwnerPayout, { body: { owner: String(owner._id), deal: String(deal._id), amount: 400_000, source: "advocate_trust", reference: "TR-3" } })
    ).rejects.toThrow(/trust balance/i);
  });

  it("CGT withheld: the full claim (amount + cgtAmount) posts to the GL and is checked against both balances, but only `amount` is owed as cash", async () => {
    const { business, call, owner, advocate, deal } = await setup();
    await call(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment", collectionMethod: "advocate_trust" } });

    // Owner's outstanding is 970,000; paying 900,000 cash + 70,000 CGT = 970,000 total claim, exactly at the limit.
    const created = await call(createOwnerPayout, {
      body: { owner: String(owner._id), deal: String(deal._id), amount: 900_000, cgtAmount: 70_000, cgtReference: "KRA-CGT-001", source: "advocate_trust", advocate: String(advocate._id), reference: "TR-4" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.payload.cgtAmount).toBe(70_000);
    expect(created.payload.cgtReference).toBe("KRA-CGT-001");

    const legs = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_owner_payout", sourceTransactionId: String(created.payload._id) }).lean();
    const clearingAcc = await getAccountByCode(business, "2185");
    const trustAcc = await getAccountByCode(business, "1314");
    expect(legs.find((l) => l.direction === "debit")).toMatchObject({ accountId: clearingAcc._id, debit: 970_000 });
    expect(legs.find((l) => l.direction === "credit")).toMatchObject({ accountId: trustAcc._id, credit: 970_000 });
  });

  it("CGT pushes the total claim over the owner's outstanding balance even though `amount` alone would fit", async () => {
    const { call, owner, deal } = await setup();
    await call(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment" } });
    // outstanding = 970,000; amount alone (900,000) fits, but +80,000 CGT does not.
    await expect(
      call(createOwnerPayout, { body: { owner: String(owner._id), amount: 900_000, cgtAmount: 80_000, reference: "EFT-5" } })
    ).rejects.toThrow(/outstanding balance/i);
  });

  it("CGT pushes the total claim over the deal's trust balance even though `amount` alone would fit (and the owner's wider outstanding balance would too)", async () => {
    const { call, owner, advocate, deal } = await setup();
    // Only 400,000 of the 1,000,000 price came in via advocate trust (the rest direct) — outstanding
    // (970,000) comfortably covers 430,000, but this deal's own trust only holds 400,000.
    await call(createPayment, { body: { deal: String(deal._id), amount: 400_000, paymentType: "installment", collectionMethod: "advocate_trust" } });
    await call(createPayment, { body: { deal: String(deal._id), amount: 600_000, paymentType: "installment" } });
    await expect(
      call(createOwnerPayout, { body: { owner: String(owner._id), deal: String(deal._id), amount: 350_000, cgtAmount: 80_000, source: "advocate_trust", advocate: String(advocate._id), reference: "TR-5" } })
    ).rejects.toThrow(/trust balance/i);
  });

  it("rejects a negative cgtAmount", async () => {
    const { call, owner, deal } = await setup();
    await call(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment" } });
    await expect(
      call(createOwnerPayout, { body: { owner: String(owner._id), amount: 100_000, cgtAmount: -5, reference: "EFT-6" } })
    ).rejects.toThrow(/cgt amount/i);
  });

  it("GL failure rolls back the payout record (DB and ledger stay in sync)", async () => {
    const { business, call, owner, deal } = await setup();
    await call(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment" } });
    // An invalid cashbook id string would fail resolveCashbook silently (falls back to null -> 1311
    // fallback), so instead force a GL failure by disabling 2185 after it's been created once.
    const { resolvePSAccount } = await import("../services/propertySaleAccountingService.js");
    const ChartOfAccount = (await import("../../../models/ChartOfAccount.js")).default;
    await resolvePSAccount(business, "2185");
    await ChartOfAccount.updateOne({ business, code: "2185" }, { $set: { isPosting: false } });

    await expect(
      call(createOwnerPayout, { body: { owner: String(owner._id), amount: 100_000, reference: "EFT-7" } })
    ).rejects.toThrow();
    expect(await SaleOwnerPayout.countDocuments({ business })).toBe(0);
  });
});

describe("owner payouts — combined multi-deal advocate_trust payout (allocations)", () => {
  it("pays the owner from trust held across two deals in one action, posts one GL entry for the full total", async () => {
    const { business, call, owner, advocate, deal, makeSecondDeal } = await setup();
    await call(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment", collectionMethod: "advocate_trust" } });
    const deal2 = await makeSecondDeal();
    await call(createPayment, { body: { deal: String(deal2._id), amount: 500_000, paymentType: "installment", collectionMethod: "advocate_trust" } });

    const created = await call(createOwnerPayout, {
      body: {
        owner: String(owner._id), amount: 500_000, source: "advocate_trust", advocate: String(advocate._id),
        allocations: [{ deal: String(deal._id), amount: 300_000 }, { deal: String(deal2._id), amount: 200_000 }],
        reference: "TR-COMBO-1",
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.payload.deal).toBeFalsy();
    expect(created.payload.allocations).toHaveLength(2);

    const legs = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_owner_payout", sourceTransactionId: String(created.payload._id) }).lean();
    expect(legs).toHaveLength(2);
    const trustAcc = await getAccountByCode(business, "1314");
    expect(legs.find((l) => l.direction === "credit")).toMatchObject({ accountId: trustAcc._id, credit: 500_000 });
  });

  it("rejects providing both a single deal and an allocation list", async () => {
    const { call, owner, advocate, deal, makeSecondDeal } = await setup();
    await call(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment", collectionMethod: "advocate_trust" } });
    const deal2 = await makeSecondDeal();
    await expect(call(createOwnerPayout, {
      body: { owner: String(owner._id), deal: String(deal._id), amount: 100_000, source: "advocate_trust", advocate: String(advocate._id), allocations: [{ deal: String(deal2._id), amount: 100_000 }], reference: "TR-BOTH" },
    })).rejects.toThrow(/not both/);
  });

  it("rejects when allocations don't sum to the total being paid out", async () => {
    const { call, owner, advocate, deal, makeSecondDeal } = await setup();
    await call(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment", collectionMethod: "advocate_trust" } });
    const deal2 = await makeSecondDeal();
    await call(createPayment, { body: { deal: String(deal2._id), amount: 500_000, paymentType: "installment", collectionMethod: "advocate_trust" } });
    await expect(call(createOwnerPayout, {
      body: {
        owner: String(owner._id), amount: 500_000, source: "advocate_trust", advocate: String(advocate._id),
        allocations: [{ deal: String(deal._id), amount: 300_000 }, { deal: String(deal2._id), amount: 100_000 }], // sums to 400,000, not 500,000
        reference: "TR-MISMATCH",
      },
    })).rejects.toThrow(/must match exactly/);
  });

  it("rejects an allocation exceeding that specific deal's own trust balance, even though the other deal's spare capacity would cover the shortfall if wrongly pooled", async () => {
    const { call, owner, advocate, deal, makeSecondDeal } = await setup();
    await call(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment", collectionMethod: "advocate_trust" } });
    const deal2 = await makeSecondDeal();
    await call(createPayment, { body: { deal: String(deal2._id), amount: 500_000, paymentType: "installment", collectionMethod: "advocate_trust" } });
    // deal2's own trust is only 500,000 — asking 600,000 from it must fail even though deal's spare
    // 900,000 would easily cover the 700,000 grand total if the check were (wrongly) done in aggregate.
    await expect(call(createOwnerPayout, {
      body: {
        owner: String(owner._id), amount: 700_000, source: "advocate_trust", advocate: String(advocate._id),
        allocations: [{ deal: String(deal._id), amount: 100_000 }, { deal: String(deal2._id), amount: 600_000 }],
        reference: "TR-OVER",
      },
    })).rejects.toThrow(/trust balance is only/);
  });

  it("rejects duplicate deals in the allocation list", async () => {
    const { call, owner, advocate, deal } = await setup();
    await call(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment", collectionMethod: "advocate_trust" } });
    await expect(call(createOwnerPayout, {
      body: {
        owner: String(owner._id), amount: 100_000, source: "advocate_trust", advocate: String(advocate._id),
        allocations: [{ deal: String(deal._id), amount: 50_000 }, { deal: String(deal._id), amount: 50_000 }],
        reference: "TR-DUPE",
      },
    })).rejects.toThrow(/allocated twice/);
  });

  it("after a combined payout, each deal's own trust balance is reduced by exactly its own slice — never double-counted or missed", async () => {
    const { business, call, owner, advocate, deal, makeSecondDeal } = await setup();
    await call(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment", collectionMethod: "advocate_trust" } });
    const deal2 = await makeSecondDeal();
    await call(createPayment, { body: { deal: String(deal2._id), amount: 500_000, paymentType: "installment", collectionMethod: "advocate_trust" } });

    await call(createOwnerPayout, {
      body: {
        owner: String(owner._id), amount: 400_000, source: "advocate_trust", advocate: String(advocate._id),
        allocations: [{ deal: String(deal._id), amount: 300_000 }, { deal: String(deal2._id), amount: 100_000 }],
        reference: "TR-SLICE",
      },
    });

    const { dealAdvocateTrustBalance } = await import("../services/dealProgress.js");
    const balance1 = await dealAdvocateTrustBalance(business, deal._id);
    const balance2 = await dealAdvocateTrustBalance(business, deal2._id);
    expect(balance1.available).toBe(1_000_000 - 300_000);
    expect(balance2.available).toBe(500_000 - 100_000);
  });
});

describe("owner payouts — advocate-owner trust summary", () => {
  it("lists every deal of the owner the advocate holds trust for, with its own available balance, totalled — a deal with no trust is left out entirely", async () => {
    const { business, call, owner, project, deal, makeSecondDeal } = await setup();
    await call(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment", collectionMethod: "advocate_trust" } });
    const deal2 = await makeSecondDeal();
    await call(createPayment, { body: { deal: String(deal2._id), amount: 500_000, paymentType: "installment", collectionMethod: "advocate_trust" } });
    // A third deal under the same owner, paid DIRECT (not advocate_trust) — zero trust balance, must
    // not appear in the summary at all.
    const n3 = ++seq;
    const listing3 = await SaleListing.create({ business, listingNumber: `L-${n3}`, title: `Plot ${n3}`, askingPrice: 200_000, project: project._id, unitNumber: `U${n3}` });
    const buyer3 = await SaleBuyer.create({ business, buyerNumber: `B-${n3}`, fullName: `Buyer ${n3}`, phone: `0700${n3}`, email: `b${n3}@example.com` });
    const dealRes3 = await call(createDeal, { body: { listing: String(listing3._id), buyer: String(buyer3._id), agreedPrice: 200_000 } });
    await call(createPayment, { body: { deal: String(dealRes3.payload._id), amount: 200_000, paymentType: "installment" } });

    const res = await call(getAdvocateOwnerTrustSummary, { params: { ownerId: String(owner._id) } });
    expect(res.statusCode).toBe(200);
    expect(res.payload.data).toHaveLength(2);
    expect(res.payload.totalAvailable).toBe(1_500_000);
    expect(res.payload.data.map((d) => String(d.dealId))).not.toContain(String(dealRes3.payload._id));
  });

  it("an advocate-scoped caller only sees deals they themselves hold trust for", async () => {
    const { business, asAdvocate, owner, deal, makeSecondDeal } = await setup();
    await asAdvocate(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment", collectionMethod: "advocate_trust" } });
    const deal2 = await makeSecondDeal();
    await asAdvocate(createPayment, { body: { deal: String(deal2._id), amount: 500_000, paymentType: "installment", collectionMethod: "advocate_trust" } });

    const res = await asAdvocate(getAdvocateOwnerTrustSummary, { params: { ownerId: String(owner._id) } });
    expect(res.payload.data).toHaveLength(2);
    expect(res.payload.totalAvailable).toBe(1_500_000);
  });

  it("404s for an owner the advocate has no relationship with", async () => {
    const { business, asAdvocate } = await setup();
    const otherOwner = await SaleOwner.create({ business, ownerNumber: `OWN-FOREIGN-${++seq}`, fullName: "Foreign Owner", phone: `0799${seq}` });
    await expect(asAdvocate(getAdvocateOwnerTrustSummary, { params: { ownerId: String(otherOwner._id) } })).rejects.toThrow(/not found/i);
  });
});

describe("owner payouts — advocate-scoped visibility includes combined payouts", () => {
  it("an advocate who creates a combined payout can see it afterward in their own list and get-by-id", async () => {
    const { asAdvocate, owner, advocate, deal, makeSecondDeal } = await setup();
    await asAdvocate(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment", collectionMethod: "advocate_trust" } });
    const deal2 = await makeSecondDeal();
    await asAdvocate(createPayment, { body: { deal: String(deal2._id), amount: 500_000, paymentType: "installment", collectionMethod: "advocate_trust" } });

    const created = await asAdvocate(createOwnerPayout, {
      body: {
        owner: String(owner._id), amount: 400_000, source: "advocate_trust",
        allocations: [{ deal: String(deal._id), amount: 300_000 }, { deal: String(deal2._id), amount: 100_000 }],
        reference: "TR-VISIBLE",
      },
    });
    expect(created.statusCode).toBe(201);

    const list = await asAdvocate(listOwnerPayouts, {});
    expect(list.payload.data.map((p) => String(p._id))).toContain(String(created.payload._id));

    const got = await asAdvocate(getOwnerPayout, { params: { id: String(created.payload._id) } });
    expect(got.statusCode).toBe(200);
  });
});

describe("owner payouts — outstanding balance scoping", () => {
  it("404s an advocate querying an owner they have no relationship with", async () => {
    const { business, asAdvocate } = await setup();
    const otherOwner = await SaleOwner.create({ business, ownerNumber: `OWN-OB-${++seq}`, fullName: "Other Owner", phone: `0788${seq}` });
    await expect(asAdvocate(getOwnerOutstandingBalance, { params: { ownerId: String(otherOwner._id) } })).rejects.toThrow(/not found/i);
  });

  it("an advocate CAN query their own owner's outstanding balance", async () => {
    const { call, asAdvocate, owner, deal } = await setup();
    await call(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment" } });
    const res = await asAdvocate(getOwnerOutstandingBalance, { params: { ownerId: String(owner._id) } });
    expect(res.statusCode).toBe(200);
    expect(res.payload.outstanding).toBe(970_000);
  });
});
