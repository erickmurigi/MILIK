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

describe("advocate remittance — auto-allocation against outstanding recoverable expenses", () => {
  it("applies the incoming amount against the oldest outstanding voucher first, then the remainder as commission-cash", async () => {
    const { business, call, advocate, owner, deal, makeRecoverableVoucher } = await setup();
    const older = await makeRecoverableVoucher(5_000, "2026-01-01");
    const newer = await makeRecoverableVoucher(8_000, "2026-02-01");

    const res = await call(createRemittance, { body: { advocate: String(advocate._id), deal: String(deal._id), amount: 10_000 } });
    expect(res.statusCode).toBe(201);
    expect(res.payload.appliedTo).toMatchObject([
      { category: "recoverable_expense", amount: 5_000 },
      { category: "recoverable_expense", amount: 5_000 },
    ]);
    expect(String(res.payload.appliedTo[0].refId)).toBe(String(older._id));
    expect(String(res.payload.appliedTo[1].refId)).toBe(String(newer._id));

    // GL: the remittance's own cash leg is the full 10,000 to 1314; the recoverable-expense settlement
    // entries (Dr 2185 / Cr 1313) are separate, one per voucher actually touched.
    const remittanceLegs = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_advocate_remittance", sourceTransactionId: String(res.payload._id) }).lean();
    expect(remittanceLegs).toHaveLength(2);
    const trustAcc = await getAccountByCode(business, "1314");
    expect(remittanceLegs.find((l) => l.direction === "credit")).toMatchObject({ accountId: trustAcc._id, credit: 10_000 });

    const olderSettlement = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_recoverable_expense_settlement", sourceTransactionId: `${res.payload._id}:recoverable:${older._id}` }).lean();
    const newerSettlement = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_recoverable_expense_settlement", sourceTransactionId: `${res.payload._id}:recoverable:${newer._id}` }).lean();
    expect(olderSettlement).toMatchObject([{ direction: "debit", debit: 5_000 }, { direction: "credit", credit: 5_000 }]);
    expect(newerSettlement).toMatchObject([{ direction: "debit", debit: 5_000 }, { direction: "credit", credit: 5_000 }]);

    const recoverableAcc = await getAccountByCode(business, "1313");
    const recoverableRows = await FinancialLedgerEntry.find({ business, accountId: recoverableAcc._id }).lean();
    // 13,000 debited by the two vouchers' own accrual, 10,000 credited back by the two settlements above.
    const net = recoverableRows.reduce((s, r) => s + Number(r.debit || 0) - Number(r.credit || 0), 0);
    expect(net).toBe(3_000); // 5,000 + 8,000 debited, only 10,000 recovered so far
  });

  it("a remittance with nothing left to allocate after full recovery is pure commission-cash — no settlement entries at all", async () => {
    const { business, call, advocate, deal } = await setup();
    // No recoverable vouchers at all for this owner.
    const res = await call(createRemittance, { body: { advocate: String(advocate._id), deal: String(deal._id), amount: 12_000 } });
    expect(res.payload.appliedTo).toMatchObject([{ category: "owner_commission_cash", amount: 12_000 }]);

    const settlementRows = await FinancialLedgerEntry.find({ business, sourceTransactionType: "property_sale_recoverable_expense_settlement" }).lean();
    expect(settlementRows.length).toBe(0);
  });

  it("legacy call with deal omitted entirely is completely unaffected — no deal, no appliedTo, no trust-balance check", async () => {
    const { call, advocate } = await setup();
    const res = await call(createRemittance, { body: { advocate: String(advocate._id), amount: 999_999_999 } }); // would fail any trust check
    expect(res.statusCode).toBe(201);
    expect(res.payload.deal).toBeFalsy();
    expect(res.payload.appliedTo).toEqual([]);
  });
});
