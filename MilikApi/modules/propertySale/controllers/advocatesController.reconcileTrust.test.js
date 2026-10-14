// Trust reconciliation log (§8.6): a read-only audit/control record comparing an advocate's
// self-reported trust balance against the system's computed one — no GL posting happens here.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import SaleAdvocate from "../models/SaleAdvocate.js";
import SaleProject from "../models/SaleProject.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleListing from "../models/SaleListing.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import { createDeal } from "./dealsController.js";
import { createPayment } from "./paymentsController.js";
import { createRemittance } from "./advocateRemittancesController.js";
import { reconcileTrust } from "./advocatesController.js";

let seq = 0;

const setup = async () => {
  const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const business = company._id;
  const call = (fn, opts = {}) => callController(fn, { user, ...opts });

  const advocate = await SaleAdvocate.create({ business, advocateNumber: "ADV-1", fullName: "John Advocate", phone: "0733000333" });
  const project = await SaleProject.create({ business, projectNumber: "PRJ-1", name: "Sunset Gardens", assignedAdvocate: advocate._id });
  const n = ++seq;
  const listing = await SaleListing.create({ business, listingNumber: `L-${n}`, title: `Plot ${n}`, askingPrice: 1_000_000, project: project._id, unitNumber: `U${n}` });
  const buyer = await SaleBuyer.create({ business, buyerNumber: `B-${n}`, fullName: `Buyer ${n}`, phone: `0700${n}`, email: `b${n}@example.com` });
  const dealRes = await call(createDeal, { body: { listing: String(listing._id), buyer: String(buyer._id), agreedPrice: 1_000_000 } });
  const deal = dealRes.payload;

  return { business, call, advocate, deal };
};

describe("advocate trust reconciliation", () => {
  it("logs a variance entry against the system-computed balance, with no GL posting", async () => {
    const { business, call, advocate, deal } = await setup();
    await call(createPayment, { body: { deal: String(deal._id), amount: 500_000, paymentType: "installment", collectionMethod: "advocate_trust" } });
    await call(createRemittance, { body: { advocate: String(advocate._id), amount: 100_000 } });
    // system balance = 500,000 collected - 100,000 remitted = 400,000

    const glBefore = await FinancialLedgerEntry.countDocuments({ business });

    const res = await call(reconcileTrust, { params: { id: String(advocate._id) }, body: { statedBalance: 395_000, notes: "Per bank statement" } });
    expect(res.statusCode).toBe(201);
    expect(res.payload).toMatchObject({ statedBalance: 395_000, systemBalance: 400_000, variance: -5_000, notes: "Per bank statement" });

    const stored = await SaleAdvocate.findById(advocate._id).lean();
    expect(stored.trustReconciliation).toHaveLength(1);
    expect(stored.trustReconciliation[0]).toMatchObject({ statedBalance: 395_000, systemBalance: 400_000, variance: -5_000 });

    // No new ledger entries were posted by reconciling — read-only against the GL.
    expect(await FinancialLedgerEntry.countDocuments({ business })).toBe(glBefore);
  });

  it("rejects a non-numeric statedBalance", async () => {
    const { call, advocate } = await setup();
    await expect(
      call(reconcileTrust, { params: { id: String(advocate._id) }, body: { statedBalance: "not-a-number" } })
    ).rejects.toThrow(/statedBalance/i);
  });

  it("404s for an advocate that doesn't belong to this business", async () => {
    const { call } = await setup();
    const otherCompany = await createTestCompany();
    const otherAdvocate = await SaleAdvocate.create({ business: otherCompany._id, advocateNumber: "ADV-X", fullName: "Other Advocate" });
    await expect(
      call(reconcileTrust, { params: { id: String(otherAdvocate._id) }, body: { statedBalance: 0 } })
    ).rejects.toThrow(/not found/i);
  });
});
