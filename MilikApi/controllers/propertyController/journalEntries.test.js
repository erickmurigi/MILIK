// Integration tests for manual Journal Entries: creation -> posting -> reversal,
// asserting the fundamental accounting invariant (debits == credits) at every
// step, using the real controllers and real ledgerPostingService posting path.
import { describe, it, expect } from "vitest";
import {
  createJournalEntry,
  postJournalEntry,
  reverseJournalEntry,
} from "./journalEntries.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import JournalEntry from "../../models/JournalEntry.js";
import { callController } from "../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../test/factories.js";
import { getAccountByCode } from "../../test/factories.financial.js";

const netBalance = (entries) => {
  const debit = entries.reduce((sum, e) => sum + Number(e.debit || 0), 0);
  const credit = entries.reduce((sum, e) => sum + Number(e.credit || 0), 0);
  return { debit, credit, net: debit - credit };
};

describe("journalEntries controller", () => {
  it("creates a draft journal, posts it to the GL with balanced debit/credit legs sharing one journalGroupId", async () => {
    const company = await createTestCompany();
    await createTestChartOfAccounts(company._id);
    const user = await createTestUser({ company });

    const debitAccount = await getAccountByCode(company._id, "5100"); // Maintenance Expense
    const creditAccount = await getAccountByCode(company._id, "1100"); // Cash on Hand

    // company_journal never needs a landlord/property context — simplest path.
    const createResult = await callController(createJournalEntry, {
      user,
      body: {
        journalType: "company_journal",
        debitAccount: String(debitAccount._id),
        creditAccount: String(creditAccount._id),
        amount: 8000,
        date: new Date(),
        narration: "Test company journal",
      },
    });

    expect(createResult.statusCode).toBe(201);
    expect(createResult.payload.status).toBe("draft");
    const journalId = createResult.payload._id;

    const postResult = await callController(postJournalEntry, {
      user,
      params: { id: journalId },
    });

    expect(postResult.statusCode).toBe(200);
    expect(postResult.payload.status).toBe("posted");
    expect(postResult.payload.journalGroupId).toBeTruthy();

    const entries = await FinancialLedgerEntry.find({
      journalGroupId: postResult.payload.journalGroupId,
    }).lean();

    expect(entries).toHaveLength(2);
    const { debit, credit, net } = netBalance(entries);
    expect(debit).toBe(8000);
    expect(credit).toBe(8000);
    expect(net).toBe(0);
  });

  it("reversing a posted journal leaves the combined original+reversal ledger rows net to zero", async () => {
    const company = await createTestCompany();
    await createTestChartOfAccounts(company._id);
    const user = await createTestUser({ company });

    const debitAccount = await getAccountByCode(company._id, "5101"); // Repairs Expense
    const creditAccount = await getAccountByCode(company._id, "1110"); // Bank Accounts

    const createResult = await callController(createJournalEntry, {
      user,
      body: {
        journalType: "company_journal",
        debitAccount: String(debitAccount._id),
        creditAccount: String(creditAccount._id),
        amount: 4500,
        date: new Date(),
        narration: "Journal to be reversed",
      },
    });
    const journalId = createResult.payload._id;

    await callController(postJournalEntry, { user, params: { id: journalId } });

    const reverseResult = await callController(reverseJournalEntry, {
      user,
      params: { id: journalId },
      body: { reason: "Testing reversal" },
    });

    expect(reverseResult.statusCode).toBe(200);
    expect(reverseResult.payload.status).toBe("reversed");

    const journalDoc = await JournalEntry.findById(journalId).lean();
    expect(journalDoc.status).toBe("reversed");
    expect(journalDoc.reversedAt).toBeTruthy();

    // All ledger rows tied to this journal (2 original + 2 reversal legs) must net to zero.
    const entries = await FinancialLedgerEntry.find({
      business: company._id,
      sourceTransactionType: "manual_adjustment",
      sourceTransactionId: String(journalId),
    }).lean();

    expect(entries).toHaveLength(4);
    const { net } = netBalance(entries);
    expect(net).toBe(0);

    // The two original legs are now marked reversed; the two reversal legs are approved.
    const reversedCount = entries.filter((e) => e.status === "reversed").length;
    const approvedCount = entries.filter((e) => e.status === "approved").length;
    expect(reversedCount).toBe(2);
    expect(approvedCount).toBe(2);
  });
});
