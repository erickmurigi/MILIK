// Refund tracking on void (§8.5): voiding an "advocate_trust" payment represents a real refund the
// advocate must have made to the buyer, so it requires explicit confirmation + a reference. A "direct"
// payment's void is completely unaffected — today's exact behavior.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleListing from "../models/SaleListing.js";
import SalePayment from "../models/SalePayment.js";
import { createDeal } from "./dealsController.js";
import { createPayment, voidPayment } from "./paymentsController.js";

let seq = 0;

const setup = async () => {
  const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const business = company._id;
  const call = (fn, opts = {}) => callController(fn, { user, ...opts });

  const n = ++seq;
  const listing = await SaleListing.create({ business, listingNumber: `L-${n}`, title: `Plot ${n}`, askingPrice: 1_000_000 });
  const buyer = await SaleBuyer.create({ business, buyerNumber: `B-${n}`, fullName: `Buyer ${n}`, phone: `0700${n}`, email: `b${n}@example.com` });
  const dealRes = await call(createDeal, { body: { listing: String(listing._id), buyer: String(buyer._id), agreedPrice: 1_000_000 } });
  const deal = dealRes.payload;

  return { business, call, deal };
};

describe("voidPayment — advocate_trust requires refund confirmation", () => {
  it("rejects without refundConfirmed/refundReference, leaving the payment paid", async () => {
    const { call, deal } = await setup();
    const payRes = await call(createPayment, { body: { deal: String(deal._id), amount: 100_000, paymentType: "installment", collectionMethod: "advocate_trust" } });

    await expect(call(voidPayment, { params: { id: String(payRes.payload._id) } })).rejects.toThrow(/real refund/i);
    expect((await SalePayment.findById(payRes.payload._id).lean()).status).toBe("paid");
  });

  it("rejects with refundConfirmed but no reference", async () => {
    const { call, deal } = await setup();
    const payRes = await call(createPayment, { body: { deal: String(deal._id), amount: 100_000, paymentType: "installment", collectionMethod: "advocate_trust" } });
    await expect(
      call(voidPayment, { params: { id: String(payRes.payload._id) }, body: { refundConfirmed: true } })
    ).rejects.toThrow(/real refund/i);
  });

  it("succeeds with both refundConfirmed and a reference, and stores the reference", async () => {
    const { call, deal } = await setup();
    const payRes = await call(createPayment, { body: { deal: String(deal._id), amount: 100_000, paymentType: "installment", collectionMethod: "advocate_trust" } });

    const res = await call(voidPayment, {
      params: { id: String(payRes.payload._id) },
      body: { refundConfirmed: true, refundReference: "MPESA-REFUND-001" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload.status).toBe("cancelled");

    const stored = await SalePayment.findById(payRes.payload._id).lean();
    expect(stored.status).toBe("cancelled");
    expect(stored.refundReference).toBe("MPESA-REFUND-001");
  });
});

describe("voidPayment — direct payments are completely unaffected", () => {
  it("voids without any refund fields, exactly as before", async () => {
    const { call, deal } = await setup();
    const payRes = await call(createPayment, { body: { deal: String(deal._id), amount: 100_000, paymentType: "installment" } });
    expect(payRes.payload.collectionMethod).toBe("direct");

    const res = await call(voidPayment, { params: { id: String(payRes.payload._id) } });
    expect(res.statusCode).toBe(200);
    expect(res.payload.status).toBe("cancelled");
  });
});
