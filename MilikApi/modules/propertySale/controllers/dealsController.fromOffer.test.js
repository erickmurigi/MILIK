// Convert-offer-to-deal path — previously had zero test coverage at all. Two real gaps found and fixed
// while bringing it up to parity with the plain "New Deal" form: the convert modal's own Agent dropdown
// was collected but silently never sent to the backend (always used the offer's own agent instead), and
// paymentPlan/expectedClosingDate weren't wired through sanitizeDealBody's coercion at all.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import SaleAgent from "../models/SaleAgent.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleListing from "../models/SaleListing.js";
import SaleOffer from "../models/SaleOffer.js";
import SaleCommission from "../models/SaleCommission.js";
import { createDealFromOffer } from "./dealsController.js";

let seq = 0;

const setup = async () => {
  const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const business = company._id;
  const call = (fn, opts = {}) => callController(fn, { user, ...opts });

  const n = ++seq;
  const offerAgent = await SaleAgent.create({ business, agentNumber: `AG-OFFER-${n}`, fullName: "Offer Agent", phone: `0711${n}`, commissionRate: 2 });
  const listing = await SaleListing.create({ business, listingNumber: `L-${n}`, title: `Plot ${n}`, askingPrice: 1_000_000, unitNumber: `U${n}` });
  const buyer = await SaleBuyer.create({ business, buyerNumber: `B-${n}`, fullName: `Buyer ${n}`, phone: `0700${n}`, email: `b${n}@example.com` });
  const offer = await SaleOffer.create({ business, offerNumber: `OFR-${n}`, listing: listing._id, buyer: buyer._id, agent: offerAgent._id, offerAmount: 1_000_000, status: "accepted" });

  return { business, call, offerAgent, listing, buyer, offer };
};

describe("createDealFromOffer", () => {
  it("omitting agent in the request keeps today's behavior — uses the offer's own agent", async () => {
    const { business, call, offerAgent, offer } = await setup();
    const res = await call(createDealFromOffer, { params: { offerId: String(offer._id) }, body: { agreedPrice: 1_000_000 } });
    expect(res.statusCode).toBe(201);
    expect(String(res.payload.agent?._id || res.payload.agent)).toBe(String(offerAgent._id));

    const commission = await SaleCommission.findOne({ business, deal: res.payload._id }).lean();
    expect(String(commission.agent)).toBe(String(offerAgent._id));
  });

  it("an explicit agent in the request overrides the offer's own agent — the convert modal's Agent dropdown actually takes effect now", async () => {
    const { business, call, offer } = await setup();
    const otherAgent = await SaleAgent.create({ business, agentNumber: "AG-OTHER", fullName: "Other Agent", phone: "0799999999", commissionRate: 4 });

    const res = await call(createDealFromOffer, { params: { offerId: String(offer._id) }, body: { agreedPrice: 1_000_000, agent: String(otherAgent._id) } });
    expect(res.statusCode).toBe(201);
    expect(String(res.payload.agent?._id || res.payload.agent)).toBe(String(otherAgent._id));

    // Commission must follow the OVERRIDE agent's own rate (4%), not the offer's original agent's (2%).
    const commission = await SaleCommission.findOne({ business, deal: res.payload._id }).lean();
    expect(String(commission.agent)).toBe(String(otherAgent._id));
    expect(commission.commissionAmount).toBe(40_000);
  });

  it("rejects an agent id that doesn't belong to this business", async () => {
    const { call, offer } = await setup();
    await expect(
      call(createDealFromOffer, { params: { offerId: String(offer._id) }, body: { agreedPrice: 1_000_000, agent: "507f1f77bcf86cd799439011" } })
    ).rejects.toThrow(/agent not found/i);
  });

  it("defaults paymentPlan to 'installment' when not specified", async () => {
    const { call, offer } = await setup();
    const res = await call(createDealFromOffer, { params: { offerId: String(offer._id) }, body: { agreedPrice: 1_000_000 } });
    expect(res.payload.paymentPlan).toBe("installment");
  });

  it("accepts an explicit payment plan and expected closing date", async () => {
    const { call, offer } = await setup();
    const res = await call(createDealFromOffer, { params: { offerId: String(offer._id) }, body: { agreedPrice: 1_000_000, paymentPlan: "mortgage", expectedClosingDate: "2026-12-31" } });
    expect(res.payload.paymentPlan).toBe("mortgage");
    expect(new Date(res.payload.expectedClosingDate).toISOString().slice(0, 10)).toBe("2026-12-31");
  });

  it("a 'cash' payment plan clears expectedClosingDate even if the request still sends one", async () => {
    const { call, offer } = await setup();
    const res = await call(createDealFromOffer, {
      params: { offerId: String(offer._id) },
      body: { agreedPrice: 1_000_000, paymentPlan: "cash", expectedClosingDate: "2026-12-31" },
    });
    expect(res.payload.paymentPlan).toBe("cash");
    expect(res.payload.expectedClosingDate).toBeNull();
  });
});
