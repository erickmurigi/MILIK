// Basic create -> update (clear entries) -> finalize lifecycle test for Bank
// Reconciliation. Not GL-posting logic itself, but guards the reconciliation
// workflow that sits on top of FinancialLedgerEntry rows for a cashbook account.
import { describe, it, expect } from "vitest";
import {
  createReconciliation,
  updateReconciliation,
  finalizeReconciliation,
} from "./bankReconciliation.js";
import { postEntry } from "../../services/ledgerPostingService.js";
import { callController } from "../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../test/factories.js";
import { getAccountByCode } from "../../test/factories.financial.js";

describe("bankReconciliation controller", () => {
  it("creates a reconciliation, clears an entry, and finalizes it (locking further edits)", async () => {
    const company = await createTestCompany();
    await createTestChartOfAccounts(company._id);
    const user = await createTestUser({ company });

    const cash = await getAccountByCode(company._id, "1100");
    const income = await getAccountByCode(company._id, "4100");

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const cashEntry = await postEntry({
      business: company._id, allowUnscoped: true,
      accountId: cash._id, direction: "debit", amount: 3000,
      sourceTransactionType: "rent_payment", sourceTransactionId: "bank-recon-entry-1",
      transactionDate: now, statementPeriodStart: periodStart, statementPeriodEnd: periodEnd,
      category: "RENT_RECEIPT_MANAGER",
    });
    await postEntry({
      business: company._id, allowUnscoped: true,
      accountId: income._id, direction: "credit", amount: 3000,
      sourceTransactionType: "rent_payment", sourceTransactionId: "bank-recon-entry-1",
      transactionDate: now, statementPeriodStart: periodStart, statementPeriodEnd: periodEnd,
      category: "RENT_RECEIPT_MANAGER",
    });

    const createResult = await callController(createReconciliation, {
      user,
      body: {
        account: String(cash._id),
        periodStart,
        periodEnd,
        statementOpeningBalance: 0,
        statementClosingBalance: 3000,
      },
    });

    expect(createResult.statusCode).toBe(201);
    expect(createResult.payload.status).toBe("draft");
    const reconId = createResult.payload._id;

    const updateResult = await callController(updateReconciliation, {
      user,
      params: { id: reconId },
      body: {
        clearedEntries: [String(cashEntry._id)],
        difference: 0,
      },
    });

    expect(updateResult.statusCode).toBe(200);
    expect(updateResult.payload.clearedEntries.map(String)).toContain(String(cashEntry._id));
    expect(updateResult.payload.difference).toBe(0);

    const finalizeResult = await callController(finalizeReconciliation, {
      user,
      params: { id: reconId },
    });

    expect(finalizeResult.statusCode).toBe(200);
    expect(finalizeResult.payload.status).toBe("reconciled");
    expect(finalizeResult.payload.reconciledAt).toBeTruthy();

    // Once reconciled, further edits must be rejected.
    await expect(
      callController(updateReconciliation, {
        user,
        params: { id: reconId },
        body: { notes: "should be rejected" },
      })
    ).rejects.toThrow(/finalised/i);
  });
});
