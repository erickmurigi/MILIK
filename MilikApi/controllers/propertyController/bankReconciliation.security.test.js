// Two things that were silently broken before this fix:
// 1. Cross-tenant BOLA — getReconciliation/updateReconciliation/finalizeReconciliation/
//    deleteReconciliation all did BankReconciliation.findById(id) with no business filter,
//    so any user with ordinary bank-reconciliation permission in their OWN company could
//    act on another company's reconciliation by id alone.
// 2. finalizeReconciliation trusted the client-saved `difference` instead of recomputing
//    it from the real ledger, so a stale/tampered figure could lock an out-of-balance
//    reconciliation as "reconciled".
import { describe, it, expect } from "vitest";
import {
  createReconciliation,
  updateReconciliation,
  getReconciliation,
  finalizeReconciliation,
  deleteReconciliation,
} from "./bankReconciliation.js";
import { postEntry } from "../../services/ledgerPostingService.js";
import { callController } from "../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../test/factories.js";
import { getAccountByCode } from "../../test/factories.financial.js";

const setupReconciliation = async () => {
  const company = await createTestCompany();
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const cash = await getAccountByCode(company._id, "1100");

  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const cashEntry = await postEntry({
    business: company._id, allowUnscoped: true,
    accountId: cash._id, direction: "debit", amount: 3000,
    sourceTransactionType: "rent_payment", sourceTransactionId: "bank-recon-sec-1",
    transactionDate: now, statementPeriodStart: periodStart, statementPeriodEnd: periodEnd,
    category: "RENT_RECEIPT_MANAGER",
  });

  const createResult = await callController(createReconciliation, {
    user,
    body: { account: String(cash._id), periodStart, periodEnd, statementOpeningBalance: 0, statementClosingBalance: 3000 },
  });
  return { company, user, cash, cashEntry, reconId: createResult.payload._id };
};

describe("bankReconciliation — cross-tenant isolation", () => {
  it("getReconciliation/updateReconciliation/finalizeReconciliation/deleteReconciliation all 404 for a different company's user", async () => {
    const { reconId } = await setupReconciliation();
    const otherCompany = await createTestCompany();
    const otherUser = await createTestUser({ company: otherCompany });

    await expect(callController(getReconciliation, { user: otherUser, params: { id: reconId } }))
      .rejects.toThrow(/not found/i);
    await expect(callController(updateReconciliation, { user: otherUser, params: { id: reconId }, body: { notes: "hijacked" } }))
      .rejects.toThrow(/not found/i);
    await expect(callController(finalizeReconciliation, { user: otherUser, params: { id: reconId } }))
      .rejects.toThrow(/not found/i);
    await expect(callController(deleteReconciliation, { user: otherUser, params: { id: reconId } }))
      .rejects.toThrow(/not found/i);
  });
});

describe("bankReconciliation — finalize recomputes the difference server-side", () => {
  it("rejects finalize when the saved difference no longer matches the actual cleared ledger entries", async () => {
    const { user, cashEntry, reconId } = await setupReconciliation();

    // Clear the entry (real cleared total: debit 3000) but claim a statement closing balance of
    // 3500 and lie that difference is already 0 (stale UI state or a direct API call) — the true,
    // recomputed difference is 500, which finalize must catch regardless of what was saved.
    await callController(updateReconciliation, {
      user, params: { id: reconId },
      body: { clearedEntries: [String(cashEntry._id)], statementClosingBalance: 3500, difference: 0 },
    });

    await expect(callController(finalizeReconciliation, { user, params: { id: reconId } }))
      .rejects.toThrow(/recomputed difference/i);
  });

  it("still finalizes correctly when the saved difference matches reality (regression)", async () => {
    const { user, cashEntry, reconId } = await setupReconciliation();
    await callController(updateReconciliation, {
      user, params: { id: reconId },
      body: { clearedEntries: [String(cashEntry._id)], difference: 0 },
    });
    const res = await callController(finalizeReconciliation, { user, params: { id: reconId } });
    expect(res.statusCode).toBe(200);
    expect(res.payload.status).toBe("reconciled");
    expect(res.payload.difference).toBe(0);
  });
});
