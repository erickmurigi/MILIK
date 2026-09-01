// Integration test for Payment Vouchers: creating a voucher that goes straight
// to "paid" status must post BOTH the accrual leg (Dr Expense / Cr Liability)
// and the settlement leg (Dr Liability / Cr Cashbook) to the GL, and the
// combined set of ledger rows for that voucher must balance to zero.
import { describe, it, expect } from "vitest";
import { createPaymentVoucher } from "./paymentVoucher.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
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
