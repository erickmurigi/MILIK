// System-wide duplicate-reference guard (paymentReferenceGuard.js), applied to LandlordReceipt.referenceNumber.
import { describe, it, expect } from "vitest";
import { callController } from "../../test/callController.js";
import { createTestProperty, createTestUser } from "../../test/factories.js";
import { createLandlordReceipt, updateLandlordReceipt, deleteLandlordReceipt } from "./landlordReceipts.js";
import PaymentReferenceLock from "../../models/PaymentReferenceLock.js";

const baseReceipt = (landlord, property, overrides = {}) => ({
  landlord: String(landlord._id),
  property: String(property._id),
  amount: 10000,
  receiptDate: new Date(2026, 2, 5),
  paymentMethod: "bank_transfer",
  cashbook: "Main Cashbook",
  category: "owner_float",
  ...overrides,
});

describe("createLandlordReceipt — duplicate reference rejected", () => {
  it("rejects a second receipt reusing the same reference", async () => {
    const { property, landlord, company } = await createTestProperty({});
    const user = await createTestUser({ company });

    const first = await callController(createLandlordReceipt, { user, body: baseReceipt(landlord, property, { referenceNumber: "LR-DUP-01" }) });
    expect(first.statusCode).toBe(200);

    await expect(
      callController(createLandlordReceipt, { user, body: baseReceipt(landlord, property, { referenceNumber: "lr-dup-01" }) })
    ).rejects.toThrow(/already (exists|used)/i);
  });
});

describe("updateLandlordReceipt — reference swap", () => {
  it("frees the old reference once changed to a new, unused one", async () => {
    const { property, landlord, company } = await createTestProperty({});
    const user = await createTestUser({ company });

    const created = await callController(createLandlordReceipt, { user, body: baseReceipt(landlord, property, { referenceNumber: "LR-OLD" }) });
    expect(created.statusCode).toBe(200);

    const updated = await callController(updateLandlordReceipt, {
      user,
      params: { id: String(created.payload.data._id) },
      body: { referenceNumber: "LR-NEW" },
    });
    expect(updated.statusCode).toBe(200);

    const lockOld = await PaymentReferenceLock.findOne({ business: company._id, referenceKey: "lr-old" }).lean();
    expect(lockOld).toBeNull();
    const lockNew = await PaymentReferenceLock.findOne({ business: company._id, referenceKey: "lr-new" }).lean();
    expect(lockNew).not.toBeNull();
  });
});

describe("deleteLandlordReceipt — reference freed on delete", () => {
  it("frees the reference so a later receipt can reuse it", async () => {
    const { property, landlord, company } = await createTestProperty({});
    const user = await createTestUser({ company });

    const created = await callController(createLandlordReceipt, { user, body: baseReceipt(landlord, property, { referenceNumber: "LR-DELETE-ME" }) });
    expect(created.statusCode).toBe(200);

    const del = await callController(deleteLandlordReceipt, { user, params: { id: String(created.payload.data._id) } });
    expect(del.statusCode).toBe(200);

    const lock = await PaymentReferenceLock.findOne({ business: company._id, referenceKey: "lr-delete-me" }).lean();
    expect(lock).toBeNull();
  });
});
