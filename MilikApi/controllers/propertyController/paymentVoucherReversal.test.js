// Reversing, deleting and re-reading payment vouchers: the ledger must return to zero and the voucher must stay readable.
import { describe, it, expect } from "vitest";
import { createPaymentVoucher, deletePaymentVoucher, getPaymentVoucher, updatePaymentVoucherStatus } from "./paymentVoucher.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import PaymentVoucher from "../../models/PaymentVoucher.js";
import AccountingPeriod from "../../models/AccountingPeriod.js";
import { callController } from "../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../test/factories.js";
import { getAccountByCode } from "../../test/factories.financial.js";

const setup = async () => {
  const company = await createTestCompany({ modules: { accounts: true } });
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const debit = await getAccountByCode(company._id, "5200");
  const liability = await getAccountByCode(company._id, "2120");
  const cash = await getAccountByCode(company._id, "1100");
  const call = (fn, opts = {}) => callController(fn, { user, ...opts });
  const create = (extra = {}) => call(createPaymentVoucher, {
    body: {
      category: "company_operational", debitAccount: String(debit._id), liabilityAccount: String(liability._id), settlementAccount: String(cash._id),
      amount: 2433, dueDate: new Date(), paidDate: new Date(), reference: "UIIBC7DPWP", narration: "Kamiti bush clearance", status: "paid", ...extra,
    },
  });
  const net = async (voucherId) => {
    const rows = await FinancialLedgerEntry.find({ business: company._id, sourceTransactionType: "payment_voucher", sourceTransactionId: String(voucherId) }).lean();
    return { rows, debit: rows.reduce((s, e) => s + Number(e.debit || 0), 0), credit: rows.reduce((s, e) => s + Number(e.credit || 0), 0) };
  };
  return { company, user, call, create, net, debit, liability, cash };
};

describe("payment voucher reversal", () => {
  it("reverses a paid voucher: every leg is offset, the voucher is reversed and can still be read", async () => {
    const { call, create, net } = await setup();
    const voucher = (await create()).payload;
    expect(voucher.status).toBe("paid");

    const reversed = await call(updatePaymentVoucherStatus, { params: { id: String(voucher._id) }, body: { status: "reversed", reason: "Posted twice" } });
    expect(reversed.statusCode).toBe(200);
    expect(reversed.payload.status).toBe("reversed");

    const { rows, debit, credit } = await net(voucher._id);
    expect(rows.length).toBe(8); // 4 original legs + 4 reversing legs
    expect(debit).toBe(credit);
    expect(rows.filter((r) => r.category === "REVERSAL").length).toBe(4);

    const read = await call(getPaymentVoucher, { params: { id: String(voucher._id) } });
    expect(read.statusCode).toBe(200);
    expect(read.payload.status).toBe("reversed");
  });

  it("removing a paid voucher from the list reverses it and keeps the row", async () => {
    const { call, create, net } = await setup();
    const voucher = (await create()).payload;
    const res = await call(deletePaymentVoucher, { params: { id: String(voucher._id) } });
    expect(res.statusCode).toBe(200);
    const read = await call(getPaymentVoucher, { params: { id: String(voucher._id) } });
    expect(read.payload.status).toBe("reversed");
    const { debit, credit } = await net(voucher._id);
    expect(debit).toBe(credit);
  });

  it("refuses a second reversal, and moving a reversed voucher back to paid or approved", async () => {
    const { call, create } = await setup();
    const voucher = (await create()).payload;
    const id = { params: { id: String(voucher._id) } };
    await call(updatePaymentVoucherStatus, { ...id, body: { status: "reversed" } });
    await expect(call(updatePaymentVoucherStatus, { ...id, body: { status: "reversed" } })).rejects.toThrow(/already reversed/i);
    await expect(call(updatePaymentVoucherStatus, { ...id, body: { status: "paid" } })).rejects.toThrow(/cannot be marked as paid/i);
    await expect(call(updatePaymentVoucherStatus, { ...id, body: { status: "approved" } })).rejects.toThrow(/cannot be approved/i);
  });

  it("an approved (not yet paid) voucher reverses only its accrual", async () => {
    const { call, create, net } = await setup();
    const voucher = (await create({ status: "approved" })).payload;
    expect(voucher.status).toBe("approved");
    expect((await net(voucher._id)).rows.length).toBe(2);
    const res = await call(updatePaymentVoucherStatus, { params: { id: String(voucher._id) }, body: { status: "reversed" } });
    expect(res.payload.status).toBe("reversed");
    const { debit, credit, rows } = await net(voucher._id);
    expect(rows.length).toBe(4);
    expect(debit).toBe(credit);
  });

  it("still reverses a voucher after its accounts have been switched off", async () => {
    const { company, call, create, net, liability, cash } = await setup();
    const voucher = (await create()).payload;
    await ChartOfAccount.updateMany({ _id: { $in: [liability._id, cash._id] } }, { $set: { isActive: false } });

    const res = await call(updatePaymentVoucherStatus, { params: { id: String(voucher._id) }, body: { status: "reversed" } });
    expect(res.payload.status).toBe("reversed");
    const { debit, credit } = await net(voucher._id);
    expect(debit).toBe(credit);
    expect(await FinancialLedgerEntry.countDocuments({ business: company._id, sourceTransactionId: String(voucher._id), status: "approved", reversalOf: null })).toBe(0);
  });

  it("refuses to pay into an inactive account, says why, and leaves no voucher or entries behind", async () => {
    const { company, create, cash } = await setup();
    await ChartOfAccount.updateOne({ _id: cash._id }, { $set: { isActive: false } });
    const err = await create().then(() => null, (e) => e);
    expect(err?.status).toBe(400);
    expect(err?.message).toMatch(/inactive/i);
    expect(await PaymentVoucher.countDocuments({ business: company._id })).toBe(0);
    expect(await FinancialLedgerEntry.countDocuments({ business: company._id, sourceTransactionType: "payment_voucher" })).toBe(0);
  });

  it("a payment blocked by a locked period leaves an approved voucher approved, with only its accrual", async () => {
    const { company, call, create, net } = await setup();
    const voucher = (await create({ status: "approved" })).payload;
    const past = new Date(); past.setMonth(past.getMonth() - 3);
    await AccountingPeriod.create({
      business: company._id, name: "Locked quarter", status: "locked",
      startDate: new Date(past.getFullYear(), past.getMonth(), 1), endDate: new Date(past.getFullYear(), past.getMonth() + 1, 0, 23, 59, 59),
    });
    await expect(call(updatePaymentVoucherStatus, { params: { id: String(voucher._id) }, body: { status: "paid", paidDate: past } })).rejects.toThrow(/locked period/);
    const read = (await call(getPaymentVoucher, { params: { id: String(voucher._id) } })).payload;
    expect(read.status).toBe("approved");
    expect((await net(voucher._id)).rows.length).toBe(2);
  });

  it("a draft voucher whose payment is blocked is left as a draft with nothing posted", async () => {
    const { company, call, create, net } = await setup();
    const voucher = (await create({ status: "draft" })).payload;
    const past = new Date(); past.setMonth(past.getMonth() - 3);
    await AccountingPeriod.create({
      business: company._id, name: "Locked quarter", status: "locked",
      startDate: new Date(past.getFullYear(), past.getMonth(), 1), endDate: new Date(past.getFullYear(), past.getMonth() + 1, 0, 23, 59, 59),
    });
    await expect(call(updatePaymentVoucherStatus, { params: { id: String(voucher._id) }, body: { status: "paid", paidDate: past } })).rejects.toThrow(/locked period/);
    expect((await call(getPaymentVoucher, { params: { id: String(voucher._id) } })).payload.status).toBe("draft");
    const { rows } = await net(voucher._id);
    expect(rows.filter((r) => r.status === "approved" && !r.reversalOf).length).toBe(0);
  });
});
