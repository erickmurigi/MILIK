// Input rules, unique references, withholding tax and double-click safety for payment vouchers.
import { describe, it, expect } from "vitest";
import { createPaymentVoucher, getPaymentVoucher, getPaymentVouchers, updatePaymentVoucher, updatePaymentVoucherStatus } from "./paymentVoucher.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import PaymentVoucher from "../../models/PaymentVoucher.js";
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
  const body = (extra = {}) => ({
    category: "company_operational", debitAccount: String(debit._id), liabilityAccount: String(liability._id), settlementAccount: String(cash._id),
    amount: 1000, dueDate: new Date(), reference: "", narration: "Test", status: "draft", ...extra,
  });
  const create = (extra = {}) => call(createPaymentVoucher, { body: body(extra) });
  const failure = (promise) => promise.then(() => null, (error) => error);
  const live = (voucherId) => FinancialLedgerEntry.find({ business: company._id, sourceTransactionId: String(voucherId), status: "approved", reversalOf: null }).lean();
  return { company, user, call, create, failure, live, debit, liability, cash };
};

describe("payment voucher references", () => {
  it("refuses a reference already used by another voucher, ignoring case and spaces, and saves nothing", async () => {
    const { company, create, failure } = await setup();
    await create({ reference: "UIIBC7DPWP" });

    for (const again of ["UIIBC7DPWP", "uiibc7dpwp", "  UIIBC7DPWP ", "UIIBC7 DPWP".replace(" ", "")]) {
      const error = await failure(create({ reference: again }));
      expect(error?.status).toBe(409);
      expect(error?.message).toMatch(/already used by payment voucher PM\d+/);
    }
    expect(await PaymentVoucher.countDocuments({ business: company._id })).toBe(1);

    expect((await create({ reference: "UIIBC7DPWQ" })).statusCode).toBe(201);
  });

  it("does not mind several vouchers with no reference", async () => {
    const { company, create } = await setup();
    await create({ reference: "" });
    await create({ reference: "   " });
    await create({});
    expect(await PaymentVoucher.countDocuments({ business: company._id })).toBe(3);
  });

  it("lets go of the reference when a voucher is reversed, so it can be entered again", async () => {
    const { call, create, failure } = await setup();
    const first = (await create({ reference: "CHQ-0042", status: "approved" })).payload;
    expect((await failure(create({ reference: "chq-0042" })))?.status).toBe(409);

    await call(updatePaymentVoucherStatus, { params: { id: String(first._id) }, body: { status: "reversed" } });
    expect((await create({ reference: "CHQ-0042" })).statusCode).toBe(201);
  });

  it("holds a reference in an edit too: another voucher's reference is refused, its own is fine", async () => {
    const { call, create, failure } = await setup();
    await create({ reference: "REF-A" });
    const second = (await create({ reference: "REF-B" })).payload;
    const params = { id: String(second._id) };

    const error = await failure(call(updatePaymentVoucher, { params, body: { reference: "ref-a" } }));
    expect(error?.status).toBe(409);

    const same = await call(updatePaymentVoucher, { params, body: { reference: "REF-B", narration: "changed" } });
    expect(same.statusCode).toBe(200);
    expect(same.payload.narration).toBe("changed");

    const moved = await call(updatePaymentVoucher, { params, body: { reference: "REF-C" } });
    expect(moved.payload.reference).toBe("REF-C");
    expect((await create({ reference: "REF-B" })).statusCode).toBe(201); // REF-B was released by the edit
  });

  it("catches a duplicate that slips through at the same moment (unique index)", async () => {
    const { company, create } = await setup();
    await PaymentVoucher.init();
    const results = await Promise.allSettled([create({ reference: "SAME-1" }), create({ reference: "SAME-1" })]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected.reason.status).toBe(409);
    expect(await PaymentVoucher.countDocuments({ business: company._id, reference: "SAME-1" })).toBe(1);
  });

  it("gives simultaneous saves different voucher numbers", async () => {
    const { company, create } = await setup();
    await PaymentVoucher.init();
    const results = await Promise.allSettled([create({}), create({}), create({}), create({})]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const numbers = (await PaymentVoucher.find({ business: company._id }).lean()).map((v) => v.voucherNo);
    expect(new Set(numbers).size).toBe(4);
  });
});

describe("payment voucher input rules", () => {
  it("rejects bad input with a 400 and a reason instead of a server error", async () => {
    const { create, failure, company } = await setup();
    const cases = [
      [{ category: "nonsense" }, /category/i],
      [{ amount: -5 }, /amount/i],
      [{ amount: "abc" }, /amount/i],
      [{ amount: 0 }, /amount/i],
      [{ amount: 1e15 }, /amount/i],
      [{ dueDate: "not a date" }, /date/i],
      [{ dueDate: undefined }, /due date/i],
      [{ status: "reversed" }, /draft, approved or paid/i],
      [{ status: "banana" }, /draft, approved or paid/i],
      [{ liabilityAccount: "12345" }, /invalid/i],
      [{ debitAccount: { $ne: null } }, /invalid/i],
      [{ whtAmount: 1000 }, /less than the voucher amount/i],
      [{ whtAmount: -1 }, /withholding/i],
      [{ reference: "x".repeat(101) }, /too long/i],
      [{ narration: "x".repeat(1001) }, /too long/i],
      [{ status: "paid", paidDate: new Date(Date.now() + 10 * 86400000) }, /future/i],
    ];
    for (const [extra, message] of cases) {
      const error = await failure(create(extra));
      expect(error?.status, JSON.stringify(extra)).toBe(400);
      expect(error?.message).toMatch(message);
    }
    expect(await PaymentVoucher.countDocuments({ business: company._id })).toBe(0);
  });

  it("requires a settlement account to save a voucher as paid, and leaves nothing behind", async () => {
    const { create, failure, company } = await setup();
    const error = await failure(create({ status: "paid", settlementAccount: null }));
    expect(error?.status).toBe(400);
    expect(await PaymentVoucher.countDocuments({ business: company._id })).toBe(0);
  });

  it("validates edits the same way, and never lets an edit change the status", async () => {
    const { call, create, failure } = await setup();
    const voucher = (await create()).payload;
    const params = { id: String(voucher._id) };
    expect((await failure(call(updatePaymentVoucher, { params, body: { amount: -1 } })))?.status).toBe(400);
    expect((await failure(call(updatePaymentVoucher, { params, body: { category: "x" } })))?.status).toBe(400);
    expect((await failure(call(updatePaymentVoucher, { params, body: { liabilityAccount: "" } })))?.status).toBe(400);
    expect((await failure(call(updatePaymentVoucher, { params, body: { whtAmount: 5000 } })))?.status).toBe(400);

    const edited = await call(updatePaymentVoucher, { params, body: { status: "paid", amount: "1500.456", whtAmount: 150 } });
    expect(edited.payload.status).toBe("draft");
    expect(edited.payload.amount).toBe(1500.46);
    expect(edited.payload.whtAmount).toBe(150);
    expect(edited.payload.whtNetAmount).toBe(1350.46);
  });

  it("answers a malformed voucher id with 404, and refuses object filters and odd search text safely", async () => {
    const { call, create, failure } = await setup();
    await create({ narration: "Fuel (Kamiti) [urgent]" });
    expect((await failure(call(getPaymentVoucher, { params: { id: "nope" } })))?.status).toBe(404);
    expect((await failure(call(updatePaymentVoucherStatus, { params: { id: "nope" }, body: { status: "paid" } })))?.status).toBe(404);
    expect((await failure(call(getPaymentVouchers, { query: { status: { $ne: "paid" } } })))?.status).toBe(400);
    expect((await failure(call(getPaymentVouchers, { query: { property: "zzz" } })))?.status).toBe(400);

    const found = await call(getPaymentVouchers, { query: { search: "Kamiti) [urg" } });
    expect(found.payload.total).toBe(1);
    const odd = await call(getPaymentVouchers, { query: { search: "(((" } });
    expect(odd.payload.total).toBe(0);
  });
});

describe("payment voucher list", () => {
  it("keeps reversed vouchers out of the working list unless they are asked for", async () => {
    const { call, create } = await setup();
    const keep = (await create({ reference: "KEEP-1" })).payload;
    const gone = (await create({ reference: "GONE-1", status: "approved" })).payload;
    await call(updatePaymentVoucherStatus, { params: { id: String(gone._id) }, body: { status: "reversed" } });

    const numbers = async (query) => (await call(getPaymentVouchers, { query })).payload.data.map((v) => v.voucherNo).sort();
    expect(await numbers({})).toEqual([keep.voucherNo]);                                    // default: working list only
    expect(await numbers({ status: "reversed" })).toEqual([gone.voucherNo]);               // reversed on request
    expect(await numbers({ includeReversed: "true" })).toEqual([keep.voucherNo, gone.voucherNo].sort()); // everything
    expect((await call(getPaymentVouchers, { query: {} })).payload.total).toBe(1);         // and the count agrees
  });
});

describe("payment voucher withholding tax and double clicks", () => {
  it("posts the tax withheld as its own credit leg, balanced", async () => {
    const { create, live } = await setup();
    const voucher = (await create({ status: "paid", paidDate: new Date(), whtAmount: 100 })).payload;
    const rows = await live(voucher._id);
    expect(rows.length).toBe(5); // expense + payable, then payable settled, cash net, tax
    const debit = rows.reduce((s, e) => s + Number(e.debit || 0), 0);
    const credit = rows.reduce((s, e) => s + Number(e.credit || 0), 0);
    expect(debit).toBe(credit);
    expect(rows.find((e) => e.metadata?.postingRole === "wht_payable").credit).toBe(100);
    expect(rows.find((e) => e.metadata?.postingRole === "cashbook_outflow").credit).toBe(900);
  });

  it("refuses to pay with tax withheld when the tax account is switched off, before anything is posted", async () => {
    const { company, create, failure } = await setup();
    await ChartOfAccount.updateOne({ business: company._id, code: "2141" }, { $set: { isActive: false } });
    const error = await failure(create({ status: "paid", paidDate: new Date(), whtAmount: 100 }));
    expect(error?.status).toBe(400);
    expect(error?.message).toMatch(/inactive/i);
    expect(await PaymentVoucher.countDocuments({ business: company._id })).toBe(0);
    expect(await FinancialLedgerEntry.countDocuments({ business: company._id, sourceTransactionType: "payment_voucher", status: "approved", reversalOf: null })).toBe(0);
  });

  it("posts a voucher once even when Mark Paid is pressed twice at the same moment", async () => {
    const { call, create, live } = await setup();
    const voucher = (await create({ status: "approved" })).payload;
    const params = { id: String(voucher._id) };
    const results = await Promise.allSettled([
      call(updatePaymentVoucherStatus, { params, body: { status: "paid" } }),
      call(updatePaymentVoucherStatus, { params, body: { status: "paid" } }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    expect((await live(voucher._id)).length).toBe(4);
    expect((await call(getPaymentVoucher, { params })).payload.status).toBe("paid");
  });

  it("reverses a voucher once even when Reverse is pressed twice at the same moment", async () => {
    const { call, create, live } = await setup();
    const voucher = (await create({ status: "paid", paidDate: new Date() })).payload;
    const params = { id: String(voucher._id) };
    await Promise.allSettled([
      call(updatePaymentVoucherStatus, { params, body: { status: "reversed" } }),
      call(updatePaymentVoucherStatus, { params, body: { status: "reversed" } }),
    ]);
    expect((await live(voucher._id)).length).toBe(0);
    const all = await FinancialLedgerEntry.find({ sourceTransactionId: String(voucher._id) }).lean();
    expect(all.filter((e) => e.category === "REVERSAL").length).toBe(4);
  });
});

describe("payment voucher route permissions", () => {
  // runs the permission middleware of one route (not verifyUser, not the controller) and reports what it decided
  const decide = async (router, method, path, req) => {
    const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
    const chain = layer.route.stack.slice(1, -1).map((l) => l.handle);
    return new Promise((resolve) => {
      let i = 0;
      const next = (err) => {
        if (err) return resolve({ status: err.status, message: err.message });
        const handle = chain[i++];
        if (!handle) return resolve({ status: 200 });
        Promise.resolve(handle(req, {}, next)).catch((e) => resolve({ status: e.status || 500 }));
      };
      next();
    });
  };

  it("lets an administrator through and turns away a user with no accounts access", async () => {
    const { default: router } = await import("../../routes/propertyRoutes/paymentVouchers.js");
    const company = await createTestCompany({ modules: { accounts: true } });
    const admin = await createTestUser({ company });
    const plain = await createTestUser({ company, adminAccess: false });

    for (const [method, path, body] of [
      ["post", "/", {}], ["get", "/", {}], ["put", "/:id", {}], ["put", "/:id/status", { status: "paid" }], ["put", "/:id/status", { status: "reversed" }], ["delete", "/:id", {}],
    ]) {
      expect((await decide(router, method, path, { user: admin, body, params: {}, query: {} })).status, `${method} ${path} admin`).toBe(200);
      expect((await decide(router, method, path, { user: plain, body, params: {}, query: {} })).status, `${method} ${path} plain`).toBe(403);
    }
  }, 60_000);

});
