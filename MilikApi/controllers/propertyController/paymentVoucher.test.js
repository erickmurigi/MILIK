// Integration test for Payment Vouchers: creating a voucher that goes straight
// to "paid" status must post BOTH the accrual leg (Dr Expense / Cr Liability)
// and the settlement leg (Dr Liability / Cr Cashbook) to the GL, and the
// combined set of ledger rows for that voucher must balance to zero.
import { describe, it, expect } from "vitest";
import { createPaymentVoucher, updatePaymentVoucher, getPaymentVoucher, getPaymentVouchers } from "./paymentVoucher.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import ServiceProvider from "../../models/ServiceProvider.js";
import { callController } from "../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../test/factories.js";
import { getAccountByCode } from "../../test/factories.financial.js";

describe("paymentVoucher controller", () => {
  it("creating a company_operational voucher with status=paid posts balanced accrual + settlement GL legs", async () => {
    const company = await createTestCompany();
    await createTestChartOfAccounts(company._id);
    const user = await createTestUser({ company });

    // company_operational requires no property/landlord — simplest voucher category.
    const debitAccount = await getAccountByCode(company._id, "5200"); // Management Expense (expense)
    const liabilityAccount = await getAccountByCode(company._id, "2120"); // Accrued Expenses (liability)
    const settlementAccount = await getAccountByCode(company._id, "1100"); // Cash on Hand (asset/cashbook)

    const result = await callController(createPaymentVoucher, {
      user,
      body: {
        category: "company_operational",
        debitAccount: String(debitAccount._id),
        liabilityAccount: String(liabilityAccount._id),
        settlementAccount: String(settlementAccount._id),
        amount: 6000,
        dueDate: new Date(),
        paidDate: new Date(),
        reference: "TEST-VOUCHER",
        narration: "Test operational expense voucher",
        status: "paid",
      },
    });

    expect(result.statusCode).toBe(201);
    expect(result.payload.status).toBe("paid");
    const voucherId = result.payload._id;

    const entries = await FinancialLedgerEntry.find({
      business: company._id,
      sourceTransactionType: "payment_voucher",
      sourceTransactionId: String(voucherId),
    }).lean();

    // Accrual (Dr Expense / Cr Liability) + Settlement (Dr Liability / Cr Cashbook) = 4 legs.
    expect(entries).toHaveLength(4);

    const totalDebit = entries.reduce((sum, e) => sum + Number(e.debit || 0), 0);
    const totalCredit = entries.reduce((sum, e) => sum + Number(e.credit || 0), 0);
    expect(totalDebit).toBe(12000); // 6000 accrual debit + 6000 settlement debit
    expect(totalCredit).toBe(12000); // 6000 accrual credit + 6000 settlement credit
    expect(totalDebit - totalCredit).toBe(0);

    // The liability account is debited on settlement exactly what it was credited on
    // accrual — its net movement across this voucher's lifecycle must be zero
    // (the accrued liability is fully cleared once paid).
    const liabilityEntries = entries.filter((e) => String(e.accountId) === String(liabilityAccount._id));
    const liabilityNet =
      liabilityEntries.reduce((sum, e) => sum + Number(e.debit || 0), 0) -
      liabilityEntries.reduce((sum, e) => sum + Number(e.credit || 0), 0);
    expect(liabilityNet).toBe(0);

    // Every leg is approved and carries a journalGroupId.
    entries.forEach((e) => {
      expect(e.status).toBe("approved");
      expect(e.journalGroupId).toBeTruthy();
    });
  });
});

// Regression coverage for the Payee field — previously the create/update controllers
// never accepted a free-text payee, populateVoucherQuery never populated the existing
// `serviceProvider` link, and the list/detail Payee column only ever read `landlordName`
// (always blank for non-landlord categories). See paymentVoucher.js's payload/allowedFields
// and normalizeVoucher()'s payeeDisplay in PaymentVouchers.jsx.
describe("paymentVoucher payee handling", () => {
  const draftVoucherBody = async (company) => {
    const debitAccount = await getAccountByCode(company._id, "5200");
    const liabilityAccount = await getAccountByCode(company._id, "2120");
    return {
      category: "company_operational",
      debitAccount: String(debitAccount._id),
      liabilityAccount: String(liabilityAccount._id),
      amount: 1000,
      dueDate: new Date(),
      reference: "TEST-PAYEE",
      narration: "Test payee handling",
      status: "draft",
    };
  };

  it("saves a free-text payeeName when no service provider is linked", async () => {
    const company = await createTestCompany();
    await createTestChartOfAccounts(company._id);
    const user = await createTestUser({ company });

    const result = await callController(createPaymentVoucher, {
      user,
      body: { ...(await draftVoucherBody(company)), payeeName: "Jane Wanjiru (one-off)" },
    });

    expect(result.statusCode).toBe(201);
    expect(result.payload.payeeName).toBe("Jane Wanjiru (one-off)");
    expect(result.payload.serviceProvider).toBeFalsy();
  });

  it("clears payeeName and populates the service provider's name when serviceProvider is linked", async () => {
    const company = await createTestCompany();
    await createTestChartOfAccounts(company._id);
    const user = await createTestUser({ company });
    const provider = await ServiceProvider.create({ business: company._id, providerCode: "SP-ACME", name: "Acme Plumbing Ltd", subjectToWht: true, whtRate: 5 });

    const created = await callController(createPaymentVoucher, {
      user,
      body: {
        ...(await draftVoucherBody(company)),
        serviceProvider: String(provider._id),
        payeeName: "This should be ignored", // serviceProvider wins — see createPaymentVoucher
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.payload.payeeName).toBe("");

    const fetched = await callController(getPaymentVoucher, { user, params: { id: created.payload._id } });
    expect(fetched.payload.serviceProvider?.name).toBe("Acme Plumbing Ltd");

    const listed = await callController(getPaymentVouchers, { user, query: { search: "TEST-PAYEE" } });
    expect(listed.payload.data[0].serviceProvider?.name).toBe("Acme Plumbing Ltd");
  });

  it("lets a draft voucher's payee be updated, enforcing the same mutual-exclusivity rule", async () => {
    const company = await createTestCompany();
    await createTestChartOfAccounts(company._id);
    const user = await createTestUser({ company });
    const provider = await ServiceProvider.create({ business: company._id, providerCode: "SP-BETA", name: "Beta Electricals" });

    const created = await callController(createPaymentVoucher, {
      user,
      body: { ...(await draftVoucherBody(company)), payeeName: "Original ad-hoc payee" },
    });
    expect(created.payload.payeeName).toBe("Original ad-hoc payee");

    // Switch to a registered provider — payeeName must clear.
    const updated = await callController(updatePaymentVoucher, {
      user,
      params: { id: created.payload._id },
      body: { serviceProvider: String(provider._id) },
    });
    expect(updated.statusCode).toBe(200);
    // updatePaymentVoucher runs the result through populateVoucherQuery, same as
    // create/get/list, so serviceProvider comes back populated, not a raw id.
    expect(String(updated.payload.serviceProvider?._id)).toBe(String(provider._id));
    expect(updated.payload.serviceProvider?.name).toBe("Beta Electricals");
    expect(updated.payload.payeeName).toBe("");
  });
});
