// Deposit refunds made by the move-out deposit settlement. A refund is tenant-linked and paid on the spot,
// and who holds the deposit decides the posting:
//   manager-held  -> Dr Tenant Deposit Payable (2100) / Cr cash — the landlord is never touched
//   landlord-held -> Dr property control / Cr cash + an expense record, so it lands on the landlord
//                    statement as a deduction (the landlord already has the deposit)
// Before this, every refund debited Landlord Payable (2110), charging the landlord for manager-held money.
import { describe, it, expect } from "vitest";
import { callController } from "../../test/callController.js";
import { createTestLease, createTestUser, createTestChartOfAccounts } from "../../test/factories.js";
import { createTestTenantInvoice } from "../../test/factories.payments.js";
import { createPayment } from "./rentPayment.js";
import { createPaymentVoucher, updatePaymentVoucherStatus } from "./paymentVoucher.js";
import { computeTenantDepositPosition } from "../../services/tenantDepositService.js";
import Tenant from "../../models/Tenant.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import ExpenseProperty from "../../models/ExpenseProperty.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";

const setup = async ({ holder = "Management Company", deposit = 15000 } = {}) => {
  const lease = await createTestLease({});
  const { tenant, unit, property, company, landlord } = lease;
  await Tenant.findByIdAndUpdate(tenant._id, { depositHeldBy: holder });
  const user = await createTestUser({ company });
  const accounts = await createTestChartOfAccounts(company._id);
  const chartAccount = accounts.find((a) => a.code === "1200") || accounts[0];
  const invoiceAuthor = await createTestUser({ company });

  await createTestTenantInvoice({
    company, property, landlord, tenant, unit, chartAccount, createdBy: invoiceAuthor,
    category: "DEPOSIT_CHARGE", amount: deposit, invoiceDate: new Date(2026, 0, 1), dueDate: new Date(2026, 0, 5),
  });
  const receipt = await callController(createPayment, {
    user,
    body: {
      tenant: String(tenant._id), unit: String(unit._id), amount: deposit,
      referenceNumber: `DEP-REF-${Date.now()}-${Math.random()}`,
      cashbook: "Main Cashbook", paymentMethod: "mobile_money",
      paymentDate: new Date(2026, 0, 2), month: 1, year: 2026, isConfirmed: true,
    },
  });
  expect(receipt.statusCode).toBe(200);

  const cash = await ChartOfAccount.findOne({ business: company._id, code: "1100" }).lean();
  return { ...lease, user, cash };
};

const refundBody = ({ tenant, cash, amount, ...rest }) => ({
  category: "deposit_refund",
  tenant: String(tenant._id),
  amount,
  status: "paid",
  dueDate: new Date(2026, 5, 1),
  paidDate: new Date(2026, 5, 1),
  settlementAccount: String(cash._id),
  paymentMethod: "mobile_money",
  ...rest,
});

const debitCodesFor = async (voucherId, business) => {
  const entries = await FinancialLedgerEntry.find({ sourceTransactionType: "payment_voucher", sourceTransactionId: String(voucherId), debit: { $gt: 0 } }).lean();
  const accounts = await ChartOfAccount.find({ business, _id: { $in: entries.map((e) => e.accountId) } }).lean();
  return { entries, codes: accounts.map((a) => a.code) };
};

describe("deposit refund vouchers", () => {
  it("manager-held: releases 2100, never debits 2110, and closes the tenant's deposit", async () => {
    const { tenant, company, user, cash } = await setup({ holder: "Management Company", deposit: 15000 });

    const result = await callController(createPaymentVoucher, { user, body: refundBody({ tenant, cash, amount: 15000 }) });
    expect(result.statusCode).toBe(201);
    expect(result.payload.depositHeldBy).toBe("Management Company");

    const { entries, codes } = await debitCodesFor(result.payload._id, company._id);
    expect(codes).toEqual(["2100"]);
    expect(entries[0].debit).toBe(15000);
    expect(await ExpenseProperty.countDocuments({ business: company._id })).toBe(0);

    const position = await computeTenantDepositPosition(tenant._id, company._id);
    expect(position).toMatchObject({ collected: 15000, refunded: 15000, available: 0 });
    const refreshed = await Tenant.findById(tenant._id).lean();
    expect(refreshed.depositRefundStatus).toBe("paid");
    expect(refreshed.depositRefundAmount).toBe(15000);
  });

  it("refuses to refund more than is still held", async () => {
    const { tenant, user, cash } = await setup({ deposit: 10000 });

    const first = await callController(createPaymentVoucher, { user, body: refundBody({ tenant, cash, amount: 6000 }) });
    expect(first.statusCode).toBe(201);

    await expect(callController(createPaymentVoucher, { user, body: refundBody({ tenant, cash, amount: 5000 }) }))
      .rejects.toMatchObject({ status: 400, message: expect.stringMatching(/4,000/) });
  });

  it("landlord-held paid by the manager: posts as a landlord deduction with an expense record", async () => {
    const { tenant, company, user, cash } = await setup({ holder: "Landlord", deposit: 8000 });

    const result = await callController(createPaymentVoucher, { user, body: refundBody({ tenant, cash, amount: 8000 }) });
    expect(result.statusCode).toBe(201);

    const { codes } = await debitCodesFor(result.payload._id, company._id);
    expect(codes).not.toContain("2100");
    expect(codes).not.toContain("2110");
    expect(await ExpenseProperty.countDocuments({ business: company._id, amount: 8000 })).toBe(1);
  });

  it("requires a tenant and an on-the-spot payment", async () => {
    const { tenant, user, cash } = await setup();

    await expect(callController(createPaymentVoucher, { user, body: { ...refundBody({ tenant, cash, amount: 1000 }), tenant: undefined } }))
      .rejects.toMatchObject({ status: 400, message: expect.stringMatching(/for a tenant/) });

    await expect(callController(createPaymentVoucher, { user, body: refundBody({ tenant, cash, amount: 1000, status: "draft" }) }))
      .rejects.toMatchObject({ status: 400, message: expect.stringMatching(/paid on the spot/) });
  });

  it("reversing a refund puts the deposit back as held", async () => {
    const { tenant, company, user, cash } = await setup({ deposit: 5000 });
    const created = await callController(createPaymentVoucher, { user, body: refundBody({ tenant, cash, amount: 5000 }) });
    expect(created.statusCode).toBe(201);

    const reversed = await callController(updatePaymentVoucherStatus, {
      user,
      params: { id: String(created.payload._id) },
      body: { status: "reversed", reason: "Paid to the wrong number" },
    });
    expect(reversed.statusCode).toBe(200);

    const position = await computeTenantDepositPosition(tenant._id, company._id);
    expect(position.available).toBe(5000);
    expect((await Tenant.findById(tenant._id).lean()).depositRefundStatus).toBe("pending");
  });
});
