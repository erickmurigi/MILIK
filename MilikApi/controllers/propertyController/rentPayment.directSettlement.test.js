// Regression test for two real production bugs on the same code path, fixed in two passes:
//
// Pass 1: a genuine non-cash "paid direct to landlord" rent receipt (tenant pays the landlord
// directly, bypassing the company entirely — NOT a deposit_applied reclassification) was debiting
// the Landlord Remittance Payable account (2110) by the FULL receipt amount, even though nothing
// was ever credited to that account for it — the landlord statement correctly excludes this amount
// from managerCollections/netAmountDue (see services/landlordStatementService.test.js), so the
// company never owes it in cash and 2110 should never be touched by this receipt at all. Debiting
// it anyway drove the account into a large, permanent abnormal (over-cleared) balance in real
// company data.
//
// Pass 2: the pass-1 fix removed the 2110 debit but didn't replace it with anything, leaving the
// journal group permanently one-sided (a credit with no debit at all) — a real double-entry
// violation this test didn't catch, because it only asserted 2110 wasn't touched, never that the
// group was still balanced. Found live on GLR: 37 such groups, KES 314,000, in a single morning.
// Fixed by debiting a dedicated memo/clearing account (2199 — Direct-to-Landlord Receipts (Memo))
// instead, which exists only to keep the group balanced and carries no real position of the
// company's own — excluded from the Balance Sheet and the abnormal-balance integrity check.
// See rentPayment.js's confirmNonCashDirectToLandlordReceipt for the fix and full reasoning.
import { describe, it, expect } from "vitest";
import { callController } from "../../test/callController.js";
import { createTestLease, createTestUser, createTestChartOfAccounts } from "../../test/factories.js";
import { createTestTenantInvoice } from "../../test/factories.payments.js";
import { createPayment } from "./rentPayment.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import RentPayment from "../../models/RentPayment.js";

describe("direct-to-landlord rent receipt — Landlord Remittance Payable settlement", () => {
  it("does not debit 2110 for a genuine non-cash direct rent receipt (nothing was ever credited to it)", async () => {
    const { tenant, unit, property, company, landlord } = await createTestLease({});
    const user = await createTestUser({ company });
    const accounts = await createTestChartOfAccounts(company._id);
    const chartAccount = accounts.find((a) => a.code === "1200") || accounts[0];
    const invoiceAuthor = await createTestUser({ company });

    const rentInvoice = await createTestTenantInvoice({
      company, property, landlord, tenant, unit, chartAccount, createdBy: invoiceAuthor,
      category: "RENT_CHARGE", amount: 15000, invoiceDate: new Date(2026, 1, 1), dueDate: new Date(2026, 1, 5),
    });

    const { statusCode, payload } = await callController(createPayment, {
      user,
      body: {
        tenant: String(tenant._id), unit: String(unit._id), amount: 15000,
        referenceNumber: `DIRECT-REF-${Date.now()}`,
        paidDirectToLandlord: true,
        paymentMethod: "mobile_money",
        paymentDate: new Date(2026, 1, 3), month: 2, year: 2026, isConfirmed: true,
      },
    });

    expect(statusCode).toBe(200);
    expect(payload.paidDirectToLandlord).toBe(true);

    const remittanceAccount = await ChartOfAccount.findOne({
      business: company._id,
      name: { $regex: "landlord remittance", $options: "i" },
    }).lean();
    expect(remittanceAccount).toBeTruthy();

    const saved = await RentPayment.findById(payload._id).lean();
    expect(saved.postingStatus).toBe("posted");

    const entries = await FinancialLedgerEntry.find({ journalGroupId: saved.journalGroupId }).lean();
    const remittanceLeg = entries.find((e) => String(e.accountId) === String(remittanceAccount._id));
    expect(remittanceLeg).toBeFalsy();

    // The tenant's receivable still cleared correctly — only the 2110 settlement was skipped.
    const creditTotal = entries.reduce((sum, e) => sum + Number(e.credit || 0), 0);
    expect(creditTotal).toBe(15000);

    // The group must still be fully balanced — the missing debit must land somewhere, not nowhere.
    const debitTotal = entries.reduce((sum, e) => sum + Number(e.debit || 0), 0);
    expect(debitTotal).toBe(15000);

    const memoAccount = await ChartOfAccount.findOne({ business: company._id, code: "2199" }).lean();
    expect(memoAccount).toBeTruthy();
    const memoLeg = entries.find((e) => String(e.accountId) === String(memoAccount._id));
    expect(memoLeg).toBeTruthy();
    expect(memoLeg.debit).toBe(15000);
  });
});
