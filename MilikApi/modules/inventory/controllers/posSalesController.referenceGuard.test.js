// System-wide duplicate-reference guard (paymentReferenceGuard.js), applied to POSSale.payments[].ref.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestUser } from "../../../test/factories.js";
import InvLocation from "../models/InvLocation.js";
import InvProduct from "../models/InvProduct.js";
import POSSession from "../models/POSSession.js";
import POSSale from "../models/POSSale.js";
import { createSale, voidSale } from "./posSalesController.js";
import PaymentReferenceLock from "../../../models/PaymentReferenceLock.js";

let seq = 0;

const setup = async () => {
  const company = await createTestCompany({ modules: { inventory: true } });
  const user = await createTestUser({ company });
  const business = company._id;
  const call = (fn, opts = {}) => callController(fn, { user, ...opts });

  const shop = await InvLocation.create({ business, name: "Shop Floor", code: `SHOP-${++seq}`, type: "retail" });
  const product = await InvProduct.create({ business, name: `Product ${seq}`, sku: `SKU${seq}`, sellingPrice: 100, costPrice: 60, vatRate: 0, trackStock: false });
  const session = await POSSession.create({ business, location: shop._id, sessionNumber: `S-${seq}`, status: "open", openedBy: user._id });

  const sell = (payments, overrides = {}) =>
    call(createSale, { body: { location: String(shop._id), session: String(session._id), lines: [{ product: String(product._id), qty: 1, unitPrice: 100 }], payments, ...overrides } });

  return { company, call, sell };
};

describe("createSale — duplicate payment reference rejected", () => {
  it("rejects a second sale reusing the same payment reference", async () => {
    const { sell } = await setup();

    const first = await sell([{ method: "mpesa", amount: 100, ref: "MPESA-DUP-01" }]);
    expect(first.statusCode).toBe(201);

    await expect(
      sell([{ method: "mpesa", amount: 100, ref: "mpesa-dup-01" }])
    ).rejects.toThrow(/already used/i);
  });

  it("allows unlimited cash sales with no reference", async () => {
    const { sell } = await setup();
    const a = await sell([{ method: "cash", amount: 100 }]);
    const b = await sell([{ method: "cash", amount: 100 }]);
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
  });

  it("frees the reference on void, allowing it to be reused", async () => {
    const { company, call, sell } = await setup();

    const first = await sell([{ method: "card", amount: 100, ref: "CARD-VOID-ME" }]);
    expect(first.statusCode).toBe(201);

    const voided = await call(voidSale, { params: { id: String(first.payload.data._id) }, body: { voidReason: "test void" } });
    expect(voided.statusCode).toBe(200);

    const lock = await PaymentReferenceLock.findOne({ business: company._id, referenceKey: "card-void-me" }).lean();
    expect(lock).toBeNull();

    const second = await sell([{ method: "card", amount: 100, ref: "CARD-VOID-ME" }]);
    expect(second.statusCode).toBe(201);
  });
});
