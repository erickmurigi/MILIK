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
import { createOwnerPayout, getOwnerPayout, listOwnerPayouts } from "./ownerPayoutsController.js";

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

  return { business, call, advocate, owner, project, deal };
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
