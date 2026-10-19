// System-wide duplicate-reference guard (paymentReferenceGuard.js), applied to RentPayment.referenceNumber.
// Also proves the guard is genuinely CROSS-MODULE: a reference claimed by a RentPayment blocks reuse by
// a totally unrelated module (PropertySale's SalePayment), and vice versa.
import { describe, it, expect } from "vitest";
import { callController } from "../../test/callController.js";
import { createTestLease, createTestUser, createTestChartOfAccounts } from "../../test/factories.js";
import { createPayment, updatePayment, deletePayment } from "./rentPayment.js";
import RentPayment from "../../models/RentPayment.js";
import PaymentReferenceLock from "../../models/PaymentReferenceLock.js";
import Company from "../../models/Company.js";

const basePayment = (tenant, unit, overrides = {}) => ({
  tenant: String(tenant._id),
  unit: String(unit._id),
  amount: 5000,
  cashbook: "Main Cashbook",
  paymentMethod: "cash",
  paymentDate: new Date(2026, 2, 5),
  month: 3,
  year: 2026,
  isConfirmed: false, // keep unposted so these tests stay fast and GL-free
  ...overrides,
});

describe("createPayment (RentPayment) — duplicate reference rejected", () => {
  it("rejects a second receipt reusing the same reference for the same tenant/unit", async () => {
    const { tenant, unit, company } = await createTestLease({});
    const user = await createTestUser({ company });

    const first = await callController(createPayment, { user, body: basePayment(tenant, unit, { referenceNumber: "RTGS-DUP-01" }) });
    expect(first.statusCode).toBe(200);

    // RentPayment's own schema-level unique index would catch this intra-model too — either way it's rejected.
    await expect(
      callController(createPayment, { user, body: basePayment(tenant, unit, { referenceNumber: "rtgs-dup-01" }) })
    ).rejects.toThrow(/already (used|exists)/i);

    const count = await RentPayment.countDocuments({ business: company._id, referenceNumber: { $regex: /rtgs-dup-01/i } });
    expect(count).toBe(1);
  });
});

describe("updatePayment (RentPayment) — reference swap", () => {
  it("frees the old reference once changed to a new, unused one", async () => {
    const { tenant, unit, company } = await createTestLease({});
    const user = await createTestUser({ company });

    const created = await callController(createPayment, { user, body: basePayment(tenant, unit, { referenceNumber: "OLD-RP-REF" }) });
    expect(created.statusCode).toBe(200);

    const updated = await callController(updatePayment, {
      user,
      params: { id: String(created.payload._id) },
      body: { referenceNumber: "NEW-RP-REF" },
    });
    expect(updated.statusCode).toBe(200);

    const lockOld = await PaymentReferenceLock.findOne({ business: company._id, referenceKey: "old-rp-ref" }).lean();
    expect(lockOld).toBeNull();
    const lockNew = await PaymentReferenceLock.findOne({ business: company._id, referenceKey: "new-rp-ref" }).lean();
    expect(lockNew).not.toBeNull();
  });
});

describe("deletePayment (RentPayment) — reference freed on delete", () => {
  it("frees the reference so a later receipt can reuse it", async () => {
    const { tenant, unit, company } = await createTestLease({});
    const user = await createTestUser({ company });

    const created = await callController(createPayment, { user, body: basePayment(tenant, unit, { referenceNumber: "DELETE-ME-RP" }) });
    expect(created.statusCode).toBe(200);

    const del = await callController(deletePayment, { user, params: { id: String(created.payload._id) } });
    expect(del.statusCode).toBe(200);

    const lock = await PaymentReferenceLock.findOne({ business: company._id, referenceKey: "delete-me-rp" }).lean();
    expect(lock).toBeNull();
  });
});

describe("Cross-module: a reference claimed by RentPayment blocks SalePayment, and vice versa", () => {
  it("rejects a SalePayment reusing a reference already claimed by a RentPayment in the same business", async () => {
    const { tenant, unit, company } = await createTestLease({});
    await Company.updateOne({ _id: company._id }, { $set: { "modules.propertySale": true, "modules.accounts": true } });
    const user = await createTestUser({ company });
    await createTestChartOfAccounts(company._id);

    const rp = await callController(createPayment, { user, body: basePayment(tenant, unit, { referenceNumber: "XMOD-REF-01" }) });
    expect(rp.statusCode).toBe(200);

    const { default: SaleListing } = await import("../../modules/propertySale/models/SaleListing.js");
    const { default: SaleBuyer } = await import("../../modules/propertySale/models/SaleBuyer.js");
    const { createDeal } = await import("../../modules/propertySale/controllers/dealsController.js");
    const { createPayment: createSalePayment } = await import("../../modules/propertySale/controllers/paymentsController.js");

    const listing = await SaleListing.create({ business: company._id, listingNumber: "XL-1", title: "Plot X", askingPrice: 1_000_000 });
    const buyer = await SaleBuyer.create({ business: company._id, buyerNumber: "XB-1", fullName: "X Buyer", phone: "0700999999", email: "xbuyer@example.com" });
    const dealRes = await callController(createDeal, { user, body: { listing: String(listing._id), buyer: String(buyer._id), agreedPrice: 1_000_000 } });

    await expect(
      callController(createSalePayment, { user, body: { deal: String(dealRes.payload._id), amount: 100_000, paymentType: "installment", reference: "xmod-ref-01" } })
    ).rejects.toThrow(/already used/i);
  });
});
