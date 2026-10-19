// System-wide duplicate-reference guard (paymentReferenceGuard.js), applied to InvSupplierPayment.reference.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import InvSupplier from "../models/InvSupplier.js";
import "../models/InvPurchaseOrder.js"; // registers the schema the controller's populate() needs
import { createSupplierPayment, voidSupplierPayment } from "./supplierPaymentsController.js";
import PaymentReferenceLock from "../../../models/PaymentReferenceLock.js";

const setup = async () => {
  const company = await createTestCompany({ modules: { inventory: true } });
  const accounts = await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const supplier = await InvSupplier.create({ business: company._id, name: "Test Supplier" });
  const cashbook = accounts.find((a) => a.code === "1110") || accounts.find((a) => a.isPosting);
  const call = (fn, opts = {}) => callController(fn, { user, ...opts });
  return { company, call, supplier, cashbookAccountId: String(cashbook._id) };
};

describe("createSupplierPayment — duplicate reference rejected", () => {
  it("rejects a second payment reusing the same reference", async () => {
    const { call, supplier, cashbookAccountId } = await setup();

    const first = await call(createSupplierPayment, { body: { supplier: String(supplier._id), amount: 1000, cashbookAccountId, paymentDate: "2026-03-01", reference: "SP-DUP-01" } });
    expect(first.statusCode).toBe(201);

    await expect(
      call(createSupplierPayment, { body: { supplier: String(supplier._id), amount: 500, cashbookAccountId, paymentDate: "2026-03-02", reference: "sp-dup-01" } })
    ).rejects.toThrow(/already used/i);
  });

  it("frees the reference on void, allowing it to be reused", async () => {
    const { company, call, supplier, cashbookAccountId } = await setup();

    const first = await call(createSupplierPayment, { body: { supplier: String(supplier._id), amount: 1000, cashbookAccountId, paymentDate: "2026-03-01", reference: "SP-VOID-ME" } });
    expect(first.statusCode).toBe(201);

    const voided = await call(voidSupplierPayment, { params: { id: String(first.payload.data._id) } });
    expect(voided.statusCode).toBe(200);

    const lock = await PaymentReferenceLock.findOne({ business: company._id, referenceKey: "sp-void-me" }).lean();
    expect(lock).toBeNull();

    const second = await call(createSupplierPayment, { body: { supplier: String(supplier._id), amount: 500, cashbookAccountId, paymentDate: "2026-03-05", reference: "SP-VOID-ME" } });
    expect(second.statusCode).toBe(201);
  });
});
