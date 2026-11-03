// Regression test for a real production false-positive, reproducing the exact shape of the live
// incident: a landlord advance disbursement (debit Landlord Remittance Payable / credit Bank
// Accounts — two legs, one journalGroupId) had its Bank leg reclassified to a different bank
// account via the chart-of-accounts "reclassify" endpoint, which calls postCorrection WITHOUT ever
// passing its own journalGroupId. runIntegrityReport computed its overall GL debit/credit total
// from "approved"-status entries only, while its own per-group balance check (correctly) counted
// both "approved" and "reversed" together — those two filters only agree when a transaction has
// exactly one layer of reversal, which a reclassify breaks (the corrected entry's generation is one
// layer deeper than the untouched sibling leg). That real incident flagged a company "critical" with
// a false KES 5,727 imbalance (summed across several such reclassifications) while the per-group
// check found nothing wrong — the money was never actually out of balance.
import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { runIntegrityReport } from "./ledgerDiagnostics.js";
import { postEntry, postCorrection } from "../../services/ledgerPostingService.js";
import { callController } from "../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts } from "../../test/factories.js";
import { getAccountByCode } from "../../test/factories.financial.js";

describe("runIntegrityReport", () => {
  it("reports clean (not a false imbalance) when one leg of a balanced pair is reclassified to a different account", async () => {
    const company = await createTestCompany();
    await createTestChartOfAccounts(company._id);
    const payable = await getAccountByCode(company._id, "2110"); // Landlord Remittance Payable
    const bank1 = await getAccountByCode(company._id, "1110"); // Bank Accounts
    const bank2 = await getAccountByCode(company._id, "1100"); // Cash on Hand — reclassify target

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const journalGroupId = new mongoose.Types.ObjectId();

    const commonPayload = {
      business: company._id,
      allowUnscoped: true,
      sourceTransactionType: "advance",
      sourceTransactionId: "integrity-report-test",
      transactionDate: now,
      statementPeriodStart: start,
      statementPeriodEnd: end,
      category: "ADVANCE_TO_LANDLORD",
      journalGroupId,
      amount: 20000,
      payer: "manager",
      receiver: "system",
    };

    // The two-leg original transaction — the payable leg is never touched again.
    await postEntry({ ...commonPayload, accountId: payable._id, direction: "debit", notes: "Advance payable" });
    const bankLeg = await postEntry({ ...commonPayload, accountId: bank1._id, direction: "credit", notes: "Advance paid from bank" });

    // Reclassify just the bank leg to a different account — exactly what the chart-of-accounts
    // "reclassify" endpoint does, without ever passing its own journalGroupId.
    await postCorrection({
      entryId: bankLeg._id,
      reason: "Reclassified to the correct bank account",
      userId: "000000000000000000000001",
      correctedPayload: {
        accountId: bank2._id,
        category: "ADVANCE_TO_LANDLORD",
        amount: 20000,
        direction: "credit",
        notes: "Reclassified",
      },
    });

    const { statusCode, payload } = await callController(runIntegrityReport, {
      user: { company: String(company._id), _id: "000000000000000000000001" },
    });

    expect(statusCode).toBe(200);
    expect(payload.detail.glBalance.balanced).toBe(true);
    expect(payload.detail.glBalance.difference).toBe(0);
    expect(payload.detail.unbalancedGroups).toHaveLength(0);
    expect(payload.overallStatus).not.toBe("critical");
  });
});
