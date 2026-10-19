// A deal's payment plan (cash/installment/mortgage/off_plan) drives whether the form even collects an
// Expected Closing Date — a cash deal closes fast and has no drawn-out timeline to project.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import SaleAgent from "../models/SaleAgent.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleListing from "../models/SaleListing.js";
import SaleDeal from "../models/SaleDeal.js";
import { createDeal, updateDeal } from "./dealsController.js";

let seq = 0;

const setup = async () => {
  const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const business = company._id;
  const call = (fn, opts = {}) => callController(fn, { user, ...opts });

  const n = ++seq;
  const agent = await SaleAgent.create({ business, agentNumber: `AG-${n}`, fullName: "Jane Agent", phone: `0711${n}`, commissionRate: 2 });
  const listing = await SaleListing.create({ business, listingNumber: `L-${n}`, title: `Plot ${n}`, askingPrice: 1_000_000, unitNumber: `U${n}` });
  const buyer = await SaleBuyer.create({ business, buyerNumber: `B-${n}`, fullName: `Buyer ${n}`, phone: `0700${n}`, email: `b${n}@example.com` });

  return { business, call, agent, listing, buyer };
};

describe("deal payment plan", () => {
  it("defaults to 'installment' when not specified — unchanged default behavior for existing callers", async () => {
    const { call, listing, buyer } = await setup();
    const res = await call(createDeal, { body: { listing: String(listing._id), buyer: String(buyer._id), agreedPrice: 1_000_000 } });
    expect(res.payload.paymentPlan).toBe("installment");
  });

  it("accepts an explicit payment plan and expected closing date on create", async () => {
    const { call, listing, buyer } = await setup();
    const res = await call(createDeal, {
      body: { listing: String(listing._id), buyer: String(buyer._id), agreedPrice: 1_000_000, paymentPlan: "mortgage", expectedClosingDate: "2026-12-31" },
    });
    expect(res.payload.paymentPlan).toBe("mortgage");
    expect(new Date(res.payload.expectedClosingDate).toISOString().slice(0, 10)).toBe("2026-12-31");
  });

  it("switching a deal to 'cash' clears any expected closing date it was carrying, even if the request still sends one", async () => {
    const { business, call, listing, buyer } = await setup();
    const created = await call(createDeal, {
      body: { listing: String(listing._id), buyer: String(buyer._id), agreedPrice: 1_000_000, paymentPlan: "installment", expectedClosingDate: "2026-12-31" },
    });
    expect(created.payload.expectedClosingDate).not.toBeNull();

    await call(updateDeal, { params: { id: String(created.payload._id) }, body: { paymentPlan: "cash", expectedClosingDate: "2027-01-15" } });

    const reloaded = await SaleDeal.findById(created.payload._id).lean();
    expect(reloaded.paymentPlan).toBe("cash");
    expect(reloaded.expectedClosingDate).toBeNull();
  });
});
