// Tests the single most valuable invariant in this codebase's accounting engine:
// every posted transaction's debits must equal its credits, and a reversal must
// exactly negate the entry it reverses. postEntry/postReversal live in
// services/ledgerPostingService.js and are the low-level primitive every higher
// controller (journal entries, payment vouchers, receipts, invoices) posts through.
import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { postEntry, postReversal } from "./ledgerPostingService.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import { createTestCompany, createTestChartOfAccounts } from "../test/factories.js";
import { getAccountByCode } from "../test/factories.financial.js";

const buildStatementPeriod = (date = new Date()) => ({
  start: new Date(date.getFullYear(), date.getMonth(), 1),
  end: new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999),
});

describe("ledgerPostingService", () => {
  it("posts a balanced journal entry whose FinancialLedgerEntry rows net to zero for the shared journalGroupId", async () => {
    const company = await createTestCompany();
    await createTestChartOfAccounts(company._id);

    const cash = await getAccountByCode(company._id, "1100"); // asset
    const income = await getAccountByCode(company._id, "4100"); // income

    const now = new Date();
    const { start, end } = buildStatementPeriod(now);
    const journalGroupId = new mongoose.Types.ObjectId();

    const commonPayload = {
      business: company._id,
      allowUnscoped: true,
      sourceTransactionType: "manual_adjustment",
      sourceTransactionId: "ledger-posting-test-1",
      transactionDate: now,
      statementPeriodStart: start,
      statementPeriodEnd: end,
      category: "ADJUSTMENT",
      journalGroupId,
      amount: 12000,
      payer: "manager",
      receiver: "system",
      notes: "Balanced test journal",
    };

    const debitLeg = await postEntry({ ...commonPayload, accountId: cash._id, direction: "debit" });
    const creditLeg = await postEntry({ ...commonPayload, accountId: income._id, direction: "credit" });

    expect(String(debitLeg.journalGroupId)).toBe(String(journalGroupId));
    expect(String(creditLeg.journalGroupId)).toBe(String(journalGroupId));

    const entries = await FinancialLedgerEntry.find({ journalGroupId }).lean();
    expect(entries).toHaveLength(2);

    // The core invariant: debits - credits == 0 for a balanced posting group.
    const netDebit = entries.reduce((sum, e) => sum + Number(e.debit || 0), 0);
    const netCredit = entries.reduce((sum, e) => sum + Number(e.credit || 0), 0);
    expect(netDebit).toBe(12000);
    expect(netCredit).toBe(12000);
    expect(netDebit - netCredit).toBe(0);

    // Each row stores its own direction consistently with the debit/credit split.
    const debitRow = entries.find((e) => String(e._id) === String(debitLeg._id));
    const creditRow = entries.find((e) => String(e._id) === String(creditLeg._id));
    expect(debitRow.direction).toBe("debit");
    expect(debitRow.debit).toBe(12000);
    expect(debitRow.credit).toBe(0);
    expect(creditRow.direction).toBe("credit");
    expect(creditRow.credit).toBe(12000);
    expect(creditRow.debit).toBe(0);
  });

  it("postReversal exactly negates the original entry (original + reversal net to zero)", async () => {
    const company = await createTestCompany();
    await createTestChartOfAccounts(company._id);
    const cash = await getAccountByCode(company._id, "1100");

    const now = new Date();
    const { start, end } = buildStatementPeriod(now);

    const original = await postEntry({
      business: company._id,
      allowUnscoped: true,
      accountId: cash._id,
      sourceTransactionType: "manual_adjustment",
      sourceTransactionId: "ledger-posting-test-2",
      transactionDate: now,
      statementPeriodStart: start,
      statementPeriodEnd: end,
      category: "ADJUSTMENT",
      amount: 750,
      direction: "debit",
      payer: "manager",
      receiver: "system",
      notes: "Entry to be reversed",
    });

    const { originalEntry, reversalEntry } = await postReversal({
      entryId: original._id,
      reason: "Test reversal",
      userId: null,
    });

    // Original is marked reversed and links forward to the reversal entry.
    expect(originalEntry.status).toBe("reversed");
    expect(String(originalEntry.reversedByEntry)).toBe(String(reversalEntry._id));
    expect(reversalEntry.direction).toBe("credit"); // flipped from the original debit
    expect(String(reversalEntry.reversalOf)).toBe(String(originalEntry._id));

    // Both rows share a journalGroupId (postReversal backfills one if the original lacked it).
    expect(originalEntry.journalGroupId).toBeTruthy();
    expect(String(reversalEntry.journalGroupId)).toBe(String(originalEntry.journalGroupId));

    // Net effect of original + reversal is exactly zero.
    const netDebit = Number(originalEntry.debit || 0) + Number(reversalEntry.debit || 0);
    const netCredit = Number(originalEntry.credit || 0) + Number(reversalEntry.credit || 0);
    expect(netDebit).toBe(netCredit);
    expect(netDebit - netCredit).toBe(0);

    // Reversing an already-reversed entry must be rejected — guards against double-reversal.
    await expect(
      postReversal({ entryId: original._id, reason: "double reversal", userId: null })
    ).rejects.toThrow(/already reversed/i);
  });
});
