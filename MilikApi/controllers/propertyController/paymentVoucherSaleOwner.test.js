// Payment Vouchers — "sale_owner_expense" category: costs the company pays on a property-sale
// owner's behalf must post to the recoverable asset account (1313 Owner Expense Recoverable)
// instead of a plain company expense account, mirroring how landlord_maintenance debits a
// property control account instead of a plain expense account. See paymentVoucher.js's
// resolveVoucherDebitAccount() and propertySaleAccountingService.js's resolvePSAccount().
import { describe, it, expect } from "vitest";
import { createPaymentVoucher, updatePaymentVoucherStatus } from "./paymentVoucher.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import SaleOwner from "../../modules/propertySale/models/SaleOwner.js";
import SaleProject from "../../modules/propertySale/models/SaleProject.js";
import { callController } from "../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser, createTestLandlord, createTestProperty } from "../../test/factories.js";
import { getAccountByCode } from "../../test/factories.financial.js";

const setup = async () => {
  const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const owner = await SaleOwner.create({ business: company._id, ownerNumber: "OWN-1", fullName: "John Mwangi", phone: "0722000222" });
  const settlementAccount = await getAccountByCode(company._id, "1100"); // Cash on Hand (asset/cashbook)
  return { company, user, owner, settlementAccount };
};

describe("paymentVoucher — sale_owner_expense category", () => {
  it("rejects a sale_owner_expense voucher with no saleOwner", async () => {
    const { user, settlementAccount } = await setup();

    await expect(callController(createPaymentVoucher, {
      user,
      body: {
        category: "sale_owner_expense",
        settlementAccount: String(settlementAccount._id),
        amount: 5000,
        dueDate: new Date(),
        narration: "Marketing cost paid on owner's behalf",
        status: "draft",
      },
    })).rejects.toThrow(/Sale owner is required/i);
  });

  it("rejects a sale_owner_expense voucher whose saleOwner does not belong to this business", async () => {
    const { company, user, settlementAccount } = await setup();
    const liabilityAccount = await getAccountByCode(company._id, "2120");
    const otherCompany = await createTestCompany();
    const foreignOwner = await SaleOwner.create({ business: otherCompany._id, ownerNumber: "OWN-X", fullName: "Foreign Owner" });

    await expect(callController(createPaymentVoucher, {
      user,
      body: {
        category: "sale_owner_expense",
        saleOwner: String(foreignOwner._id),
        liabilityAccount: String(liabilityAccount._id),
        settlementAccount: String(settlementAccount._id),
        amount: 5000,
        dueDate: new Date(),
        status: "draft",
      },
    })).rejects.toThrow(/sale owner was not found/i);
  });

  it("creating a sale_owner_expense voucher with status=paid debits 1313 Owner Expense Recoverable and credits the settlement cashbook, balanced", async () => {
    const { company, user, owner, settlementAccount } = await setup();
    const liabilityAccount = await getAccountByCode(company._id, "2120"); // Accrued Expenses (liability) — the accrual/settlement hop

    const created = await callController(createPaymentVoucher, {
      user,
      body: {
        category: "sale_owner_expense",
        saleOwner: String(owner._id),
        liabilityAccount: String(liabilityAccount._id),
        settlementAccount: String(settlementAccount._id),
        amount: 7500,
        dueDate: new Date(),
        paidDate: new Date(),
        narration: "Survey fee paid on owner's behalf",
        status: "paid",
      },
    });

    expect(created.statusCode).toBe(201);
    expect(created.payload.status).toBe("paid");
    expect(String(created.payload.saleOwner?._id || created.payload.saleOwner)).toBe(String(owner._id));
    const voucherId = created.payload._id;

    const recoverableAccount = await ChartOfAccount.findOne({ business: company._id, code: "1313" }).lean();
    expect(recoverableAccount).toBeTruthy();
    expect(recoverableAccount.name).toBe("Owner Expense Recoverable");
    expect(recoverableAccount.type).toBe("asset");

    const entries = await FinancialLedgerEntry.find({
      business: company._id,
      sourceTransactionType: "payment_voucher",
      sourceTransactionId: String(voucherId),
    }).lean();

    // sale_owner_expense is a control-account category (like landlord_maintenance), so even a
    // same-step "paid" voucher runs through both legs: Dr 1313 / Cr Liability (accrual), then
    // Dr Liability / Cr Cashbook (settlement) — 4 legs, not the 2-leg "direct payment" shortcut
    // that plain expense categories (e.g. company_operational) get.
    expect(entries).toHaveLength(4);

    const recoverableDebit = entries.find((e) => e.direction === "debit" && String(e.accountId) === String(recoverableAccount._id));
    expect(recoverableDebit?.debit).toBe(7500);

    const cashbookCredit = entries.find((e) => e.direction === "credit" && String(e.accountId) === String(settlementAccount._id));
    expect(cashbookCredit?.credit).toBe(7500);

    const totalDebit = entries.reduce((sum, e) => sum + Number(e.debit || 0), 0);
    const totalCredit = entries.reduce((sum, e) => sum + Number(e.credit || 0), 0);
    expect(totalDebit).toBe(totalCredit);

    entries.forEach((e) => expect(e.status).toBe("approved"));
  });

  it("creates a draft sale_owner_expense voucher, then approve+pay posts the same 1313 debit", async () => {
    const { company, user, owner, settlementAccount } = await setup();
    const liabilityAccount = await getAccountByCode(company._id, "2120"); // Accrued Expenses (liability)

    const created = await callController(createPaymentVoucher, {
      user,
      body: {
        category: "sale_owner_expense",
        saleOwner: String(owner._id),
        liabilityAccount: String(liabilityAccount._id),
        amount: 3000,
        dueDate: new Date(),
        narration: "Legal fee paid on owner's behalf",
        status: "draft",
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.payload.status).toBe("draft");

    const approved = await callController(updatePaymentVoucherStatus, {
      user,
      params: { id: created.payload._id },
      body: { status: "approved" },
    });
    expect(approved.statusCode).toBe(200);

    const recoverableAccount = await ChartOfAccount.findOne({ business: company._id, code: "1313" }).lean();
    const accrualEntries = await FinancialLedgerEntry.find({
      business: company._id,
      sourceTransactionType: "payment_voucher",
      sourceTransactionId: String(created.payload._id),
    }).lean();
    expect(accrualEntries).toHaveLength(2);
    const debitLeg = accrualEntries.find((e) => e.direction === "debit");
    expect(String(debitLeg.accountId)).toBe(String(recoverableAccount._id));
    expect(debitLeg.debit).toBe(3000);

    const paid = await callController(updatePaymentVoucherStatus, {
      user,
      params: { id: created.payload._id },
      body: { status: "paid", settlementAccount: String(settlementAccount._id) },
    });
    expect(paid.statusCode).toBe(200);
    expect(paid.payload.status).toBe("paid");

    const allEntries = await FinancialLedgerEntry.find({
      business: company._id,
      sourceTransactionType: "payment_voucher",
      sourceTransactionId: String(created.payload._id),
      status: "approved",
    }).lean();
    const totalDebit = allEntries.reduce((sum, e) => sum + Number(e.debit || 0), 0);
    const totalCredit = allEntries.reduce((sum, e) => sum + Number(e.credit || 0), 0);
    expect(totalDebit).toBe(totalCredit);
  });

  it("saves saleProject alongside saleOwner when both are supplied and belong to the business", async () => {
    const { company, user, owner, settlementAccount } = await setup();
    const liabilityAccount = await getAccountByCode(company._id, "2120");
    const project = await SaleProject.create({ business: company._id, projectNumber: "PRJ-1", name: "Sunset Gardens", owner: owner._id });

    const created = await callController(createPaymentVoucher, {
      user,
      body: {
        category: "sale_owner_expense",
        saleOwner: String(owner._id),
        saleProject: String(project._id),
        liabilityAccount: String(liabilityAccount._id),
        settlementAccount: String(settlementAccount._id),
        amount: 2000,
        dueDate: new Date(),
        status: "paid",
      },
    });

    expect(created.statusCode).toBe(201);
    expect(String(created.payload.saleProject?._id || created.payload.saleProject)).toBe(String(project._id));
  });
});

// Regression: an existing landlord_maintenance voucher's posting is unaffected by the
// sale_owner_expense additions (CONTROL_ACCOUNT_CATEGORIES, resolveVoucherDebitAccount, etc.
// are shared code paths that now also handle sale_owner_expense).
describe("paymentVoucher — landlord_maintenance regression", () => {
  it("still debits the property control account and credits the settlement cashbook, unaffected", async () => {
    const company = await createTestCompany({ modules: { propertyManagement: true, accounts: true } });
    await createTestChartOfAccounts(company._id);
    const user = await createTestUser({ company });
    const { landlord } = await createTestLandlord({ company });
    const { property } = await createTestProperty({ company, landlord });
    const settlementAccount = await getAccountByCode(company._id, "1100");
    const liabilityAccount = await getAccountByCode(company._id, "2120");

    const created = await callController(createPaymentVoucher, {
      user,
      body: {
        category: "landlord_maintenance",
        property: String(property._id),
        liabilityAccount: String(liabilityAccount._id),
        settlementAccount: String(settlementAccount._id),
        amount: 4000,
        dueDate: new Date(),
        paidDate: new Date(),
        narration: "Plumbing repair",
        status: "paid",
      },
    });

    expect(created.statusCode).toBe(201);
    expect(created.payload.status).toBe("paid");

    const entries = await FinancialLedgerEntry.find({
      business: company._id,
      sourceTransactionType: "payment_voucher",
      sourceTransactionId: String(created.payload._id),
    }).lean();
    // Control-account category: accrual (Dr property control / Cr liability) + settlement
    // (Dr liability / Cr cashbook) — 4 legs, same shape as before the sale_owner_expense change.
    expect(entries).toHaveLength(4);

    const totalDebit = entries.reduce((sum, e) => sum + Number(e.debit || 0), 0);
    const totalCredit = entries.reduce((sum, e) => sum + Number(e.credit || 0), 0);
    expect(totalDebit).toBe(totalCredit);

    const cashbookCredit = entries.find((e) => e.direction === "credit" && String(e.accountId) === String(settlementAccount._id));
    expect(cashbookCredit?.credit).toBe(4000);

    // The debit must NOT have gone to 1313 — landlord_maintenance has nothing to do with property sales.
    const ownerRecoverableAccount = await ChartOfAccount.findOne({ business: company._id, code: "1313" }).lean();
    if (ownerRecoverableAccount) {
      const debitToRecoverable = entries.find((e) => e.direction === "debit" && String(e.accountId) === String(ownerRecoverableAccount._id));
      expect(debitToRecoverable).toBeUndefined();
    }
  });
});
