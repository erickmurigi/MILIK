// hrPayrollGLService — verifies the payroll accrual posts exactly the period's own totals to each
// statutory/net-pay payable account (2170-2175), and that it is genuinely idempotent (a second call
// never double-credits). Audited alongside the Landlord Remittance Payable (2110) bug fix in
// rentPayment.js: unlike that account, this module has NO automated "remittance/clearing" posting at
// all for these payables (confirmed by code search — only postPayrollGLJournals accrues them, and
// reversePayrollGLJournals, which mirrors actual posted entries so cannot itself drift). Any debit
// clearing them today can only come from a manually-entered Payment Voucher/Journal Entry, which is a
// data-entry concern, not a code-level amount-mismatch bug — so there is nothing of the 2110 class to
// fix here. This test exists to pin down that the accrual side itself is exactly correct.
import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { createTestCompany, createTestChartOfAccounts } from "../../../test/factories.js";
import { postPayrollGLJournals, resolvePayrollAccounts } from "./hrPayrollGLService.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";

describe("postPayrollGLJournals", () => {
  it("credits each statutory/net-pay payable with exactly the period's own total, and never double-posts on retry", async () => {
    const company = await createTestCompany({ modules: { hr: true } });
    await createTestChartOfAccounts(company._id);
    const accounts = await resolvePayrollAccounts(company._id);

    const period = {
      _id: new mongoose.Types.ObjectId(),
      label: "October 2026",
      month: 10,
      year: 2026,
      totalPAYE: 15000,
      totalNHIF: 1700,
      totalNSSF: 2160,
      totalAHL: 750,
      totalOtherDeductions: 500,
      totalNet: 60000,
    };

    const first = await postPayrollGLJournals(period, company._id, null);
    expect(first.alreadyPosted).toBe(false);
    expect(first.entryCount).toBe(12); // 6 components x (debit expense + credit payable)

    const byAccount = async (accountId) => {
      const entries = await FinancialLedgerEntry.find({
        business: company._id, accountId, sourceTransactionType: "payroll_period", sourceTransactionId: String(period._id),
      }).lean();
      return entries.reduce((sum, e) => sum + Number(e.credit || 0) - Number(e.debit || 0), 0);
    };

    expect(await byAccount(accounts.payePayable._id)).toBe(15000);
    expect(await byAccount(accounts.nhifPayable._id)).toBe(1700);
    expect(await byAccount(accounts.nssfPayable._id)).toBe(2160);
    expect(await byAccount(accounts.ahlPayable._id)).toBe(750);
    expect(await byAccount(accounts.otherDeductionsPayable._id)).toBe(500);
    expect(await byAccount(accounts.netPayable._id)).toBe(60000);

    // Idempotency: posting the same period again must not create a second set of entries.
    const second = await postPayrollGLJournals(period, company._id, null);
    expect(second.alreadyPosted).toBe(true);
    expect(await byAccount(accounts.netPayable._id)).toBe(60000);
  });
});
