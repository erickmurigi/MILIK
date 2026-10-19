// System-wide duplicate-reference guard (paymentReferenceGuard.js): no two payment records in the same
// business may share the same external reference. Covers create/update/void on SalePayment — the first
// module wired to the guard.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleListing from "../models/SaleListing.js";
import SaleDeal from "../models/SaleDeal.js";
import SalePayment from "../models/SalePayment.js";
import PaymentReferenceLock from "../../../models/PaymentReferenceLock.js";
import { createDeal } from "./dealsController.js";
import { createPayment, updatePayment, voidPayment, deletePayment } from "./paymentsController.js";

let seq = 0;

const setup = async () => {
  const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const business = company._id;
  const call = (fn, opts = {}) => callController(fn, { user, ...opts });

  const n = ++seq;
  const listing = await SaleListing.create({ business, listingNumber: `L-${n}`, title: `Plot ${n}`, askingPrice: 5_000_000 });
  const buyer = await SaleBuyer.create({ business, buyerNumber: `B-${n}`, fullName: `Buyer ${n}`, phone: `0700${n}`, email: `b${n}@example.com` });
  const dealRes1 = await call(createDeal, { body: { listing: String(listing._id), buyer: String(buyer._id), agreedPrice: 5_000_000 } });
  const listing2 = await SaleListing.create({ business, listingNumber: `L2-${n}`, title: `Plot 2-${n}`, askingPrice: 5_000_000 });
  const buyer2 = await SaleBuyer.create({ business, buyerNumber: `B2-${n}`, fullName: `Buyer2 ${n}`, phone: `0711${n}`, email: `b2-${n}@example.com` });
  const dealRes2 = await call(createDeal, { body: { listing: String(listing2._id), buyer: String(buyer2._id), agreedPrice: 5_000_000 } });

  return { business, call, deal: dealRes1.payload, deal2: dealRes2.payload };
};

describe("createPayment — duplicate reference rejected", () => {
  it("rejects a second payment reusing the same reference, even on a different deal", async () => {
    const { call, deal, deal2 } = await setup();
    const first = await call(createPayment, { body: { deal: String(deal._id), amount: 100_000, paymentType: "installment", paymentMethod: "mpesa", reference: "QJ1X23ABC4D" } });
    expect(first.statusCode).toBe(201);

    await expect(
      call(createPayment, { body: { deal: String(deal2._id), amount: 50_000, paymentType: "installment", paymentMethod: "mpesa", reference: "qj1x23abc4d" } })
    ).rejects.toThrow(/already used/i);

    // Rejected attempt must not leave a stray payment or lock behind
    const count = await SalePayment.countDocuments({ business: deal.business, reference: { $regex: /qj1x23abc4d/i } });
    expect(count).toBe(1);
  });

  it("allows unlimited payments with a blank reference (cash)", async () => {
    const { call, deal } = await setup();
    const a = await call(createPayment, { body: { deal: String(deal._id), amount: 10_000, paymentType: "installment", paymentMethod: "cash" } });
    const b = await call(createPayment, { body: { deal: String(deal._id), amount: 10_000, paymentType: "installment", paymentMethod: "cash" } });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
  });

  it("frees the reference again after the duplicate attempt is rolled back (GL untouched)", async () => {
    const { call, deal, deal2 } = await setup();
    await call(createPayment, { body: { deal: String(deal._id), amount: 100_000, paymentType: "installment", reference: "RTGS-001" } });
    await expect(
      call(createPayment, { body: { deal: String(deal2._id), amount: 100_000, paymentType: "installment", reference: "RTGS-001" } })
    ).rejects.toThrow(/already used/i);

    const locks = await PaymentReferenceLock.find({ business: deal.business, referenceKey: "rtgs-001" }).lean();
    expect(locks).toHaveLength(1); // only the original claim remains
  });
});

describe("updatePayment — duplicate reference rejected, old reference freed on change", () => {
  it("rejects changing a payment's reference to one already used elsewhere", async () => {
    const { call, deal, deal2 } = await setup();
    await call(createPayment, { body: { deal: String(deal._id), amount: 100_000, paymentType: "installment", reference: "REF-A" } });
    const second = await call(createPayment, { body: { deal: String(deal2._id), amount: 100_000, paymentType: "installment", reference: "REF-B" } });

    await expect(
      call(updatePayment, { params: { id: String(second.payload._id) }, body: { reference: "REF-A" } })
    ).rejects.toThrow(/already used/i);
  });

  it("frees the old reference once changed to a new, unused one", async () => {
    const { call, deal } = await setup();
    const payRes = await call(createPayment, { body: { deal: String(deal._id), amount: 100_000, paymentType: "installment", reference: "OLD-REF" } });

    const updated = await call(updatePayment, { params: { id: String(payRes.payload._id) }, body: { reference: "NEW-REF" } });
    expect(updated.payload.reference).toBe("NEW-REF");

    // OLD-REF should now be free for reuse elsewhere
    const lockOld = await PaymentReferenceLock.findOne({ business: deal.business, referenceKey: "old-ref" }).lean();
    expect(lockOld).toBeNull();
    const lockNew = await PaymentReferenceLock.findOne({ business: deal.business, referenceKey: "new-ref" }).lean();
    expect(lockNew).not.toBeNull();
  });
});

describe("voidPayment / deletePayment — reference freed for reuse", () => {
  it("frees the reference on void, allowing a later payment to reuse it", async () => {
    const { call, deal, deal2 } = await setup();
    const payRes = await call(createPayment, { body: { deal: String(deal._id), amount: 100_000, paymentType: "installment", reference: "VOID-ME" } });
    await call(voidPayment, { params: { id: String(payRes.payload._id) } });

    const reused = await call(createPayment, { body: { deal: String(deal2._id), amount: 100_000, paymentType: "installment", reference: "VOID-ME" } });
    expect(reused.statusCode).toBe(201);
  });

  it("delete is a no-op on an already-released lock (void already freed it)", async () => {
    const { call, deal } = await setup();
    const payRes = await call(createPayment, { body: { deal: String(deal._id), amount: 100_000, paymentType: "installment", reference: "DEL-ME" } });
    await call(voidPayment, { params: { id: String(payRes.payload._id) } });
    await expect(call(deletePayment, { params: { id: String(payRes.payload._id) } })).resolves.toBeTruthy();
  });
});
