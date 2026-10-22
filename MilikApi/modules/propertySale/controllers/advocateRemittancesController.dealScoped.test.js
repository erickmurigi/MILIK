// Deal-scoped advocate remittance (§8.3b): createRemittance's auto-allocation against an owner's
// outstanding recoverable expenses (oldest-due-first), and the trust-balance guard — plus the legacy
// (deal: null) path staying byte-identical.
import { describe, it, expect } from "vitest";
import { callController } from "../../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../../test/factories.js";
import { getAccountByCode } from "../../../test/factories.financial.js";
import SaleOwner from "../models/SaleOwner.js";
import SaleProject from "../models/SaleProject.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleListing from "../models/SaleListing.js";
import SaleAdvocate from "../models/SaleAdvocate.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import { createDeal } from "./dealsController.js";
import { createPayment } from "./paymentsController.js";
import { createRemittance } from "./advocateRemittancesController.js";
import { createPaymentVoucher } from "../../../controllers/propertyController/paymentVoucher.js";

let seq = 0;

const setup = async () => {
  const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const business = company._id;
  const call = (fn, opts = {}) => callController(fn, { user, ...opts });

  const advocate = await SaleAdvocate.create({ business, advocateNumber: "ADV-1", fullName: "John Advocate", phone: "0733000333" });
  const owner = await SaleOwner.create({ business, ownerNumber: "OWN-1", fullName: "Jane Owner", phone: "0722000222" });
  const project = await SaleProject.create({ business, projectNumber: "PRJ-1", name: "Sunset Gardens", owner: owner._id, assignedAdvocate: advocate._id });

  const n = ++seq;
  const listing = await SaleListing.create({ business, listingNumber: `L-${n}`, title: `Plot ${n}`, askingPrice: 1_000_000, project: project._id, unitNumber: `U${n}` });
  const buyer = await SaleBuyer.create({ business, buyerNumber: `B-${n}`, fullName: `Buyer ${n}`, phone: `0700${n}`, email: `b${n}@example.com` });
  const dealRes = await call(createDeal, { body: { listing: String(listing._id), buyer: String(buyer._id), agreedPrice: 1_000_000 } });
  const deal = dealRes.payload;

  await call(createPayment, { body: { deal: String(deal._id), amount: 1_000_000, paymentType: "installment", collectionMethod: "advocate_trust" } });

  const makeRecoverableVoucher = async (amount, dueDate) => {
    const liabilityAccount = await getAccountByCode(business, "2120");
    const res = await call(createPaymentVoucher, {
      body: {
        category: "sale_owner_expense", saleOwner: String(owner._id), saleProject: String(project._id),
        liabilityAccount: String(liabilityAccount._id), amount, dueDate, status: "approved",
      },
    });
    return res.payload;
  };

  return { business, call, advocate, owner, deal, makeRecoverableVoucher };
};

describe("advocate remittance — deal-scoped trust-balance guard", () => {
  it("rejects a remittance exceeding this deal's advocate trust balance", async () => {
    const { call, advocate, deal } = await setup();
    await expect(
      call(createRemittance, { body: { advocate: String(advocate._id), deal: String(deal._id), amount: 2_000_000 } })
    ).rejects.toThrow(/trust balance/i);
  });
});

describe("advocate remittance — deal remittances never touch recoverable expenses (explicit recharge flow only)", () => {
  it("a deal remittance posts pure trust-clearing cash and leaves outstanding recoverable vouchers completely untouched, even when they'd otherwise be fully coverable", async () => {
    const { business, call, advocate, owner, deal, makeRecoverableVoucher } = await setup();
    const older = await makeRecoverableVoucher(5_000, "2026-01-01");
    const newer = await makeRecoverableVoucher(8_000, "2026-02-01");

    const res = await call(createRemittance, { body: { advocate: String(advocate._id), deal: String(deal._id), amount: 10_000 } });
    expect(res.statusCode).toBe(201);
    expect(res.payload.appliedTo).toEqual([]);

    // GL: only the remittance's own cash leg (full 10,000 to 1314) — no recoverable-expense settlement
    // entries at all, regardless of what's outstanding for this owner.
    const remittanceLegs = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_advocate_remittance", sourceTransactionId: String(res.payload._id) }).lean();
    expect(remittanceLegs).toHaveLength(2);
    const trustAcc = await getAccountByCode(business, "1314");
    expect(remittanceLegs.find((l) => l.direction === "credit")).toMatchObject({ accountId: trustAcc._id, credit: 10_000 });

    const settlementRows = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_recoverable_expense_settlement" }).lean();
    expect(settlementRows.length).toBe(0);

    const recoverableAcc = await getAccountByCode(business, "1313");
    const recoverableRows = await FinancialLedgerEntry.find({ business, accountId: recoverableAcc._id }).lean();
    // The two vouchers' own 13,000 accrual is the ONLY activity on 1313 — nothing recovered by this remittance.
    const net = recoverableRows.reduce((s, r) => s + Number(r.debit || 0) - Number(r.credit || 0), 0);
    expect(net).toBe(13_000);
    expect(String(older._id)).toBeTruthy();
    expect(String(newer._id)).toBeTruthy();
  });

  it("legacy call with deal omitted entirely still has no deal/appliedTo split, but IS now checked against the advocate's whole-book trust balance", async () => {
    const { call, advocate } = await setup();
    // setup() already collected 1,000,000 advocate_trust for this advocate (across its one deal) —
    // an ad-hoc remittance within that whole-book balance succeeds with no deal/appliedTo split, same
    // as the legacy behavior this test always asserted.
    const res = await call(createRemittance, { body: { advocate: String(advocate._id), amount: 500_000 } });
    expect(res.statusCode).toBe(201);
    expect(res.payload.deal).toBeFalsy();
    expect(res.payload.appliedTo).toEqual([]);
  });

  it("rejects an ad-hoc (no-deal) remittance exceeding the advocate's whole-book outstanding trust balance", async () => {
    const { call, advocate } = await setup();
    // Only 1,000,000 was ever collected into this advocate's trust (setup()'s one deal) — asking for
    // far more than that, with no deal to scope it to, must be rejected. This is exactly the gap that
    // used to let an advocate with nothing in trust get an arbitrary ad-hoc remittance posted against
    // them (amount > 0 was the only check).
    await expect(
      call(createRemittance, { body: { advocate: String(advocate._id), amount: 999_999_999 } })
    ).rejects.toThrow(/outstanding trust balance/i);
  });
});
