// Bank statement import + auto-matching + reopen/undo — the "best in class" additions on top of
// the original tick-to-clear workflow. Covers: unambiguous lines auto-match and claim their entry
// (so a later line in the same import can't double-claim it), ambiguous lines are left for manual
// confirmation with suggestions attached, manual match/unmatch both keep clearedEntries in sync,
// creating a transaction from an unmatched line posts a real, balanced journal and clears it, and
// a finalised reconciliation can be reopened only with a reason, leaving a permanent audit trail.
import { describe, it, expect } from "vitest";
import {
  createReconciliation,
  finalizeReconciliation,
  reopenReconciliation,
  importStatementLines,
  listStatementLines,
  matchStatementLine,
  unmatchStatementLine,
  createTransactionFromStatementLine,
  updateReconciliation,
} from "./bankReconciliation.js";
import { postEntry } from "../../services/ledgerPostingService.js";
import { callController } from "../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../test/factories.js";
import { getAccountByCode } from "../../test/factories.financial.js";

const period = () => {
  const now = new Date();
  return {
    periodStart: new Date(now.getFullYear(), now.getMonth(), 1),
    periodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
    now,
  };
};

const setup = async () => {
  const company = await createTestCompany();
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const cash = await getAccountByCode(company._id, "1100");
  const income = await getAccountByCode(company._id, "4100");
  const { periodStart, periodEnd, now } = period();

  const createResult = await callController(createReconciliation, {
    user,
    body: { account: String(cash._id), periodStart, periodEnd, statementOpeningBalance: 0, statementClosingBalance: 0 },
  });
  return { company, user, cash, income, reconId: createResult.payload._id, now, periodStart, periodEnd };
};

// postEntry requires an explicit statement period on every call — every fixture below shares this.
const post = (overrides, { periodStart, periodEnd }) =>
  postEntry({ allowUnscoped: true, statementPeriodStart: periodStart, statementPeriodEnd: periodEnd, ...overrides });

describe("bankReconciliation — statement import auto-matching", () => {
  it("auto-matches an unambiguous line and leaves an ambiguous one for manual confirmation", async () => {
    const { user, cash, income, reconId, now, periodStart, periodEnd } = await setup();
    const p = { periodStart, periodEnd };

    // One unique 5,000 debit entry (unambiguous) and two identical 2,000 debit entries (ambiguous).
    const unique = await post({
      business: user.company,
      accountId: cash._id, direction: "debit", amount: 5000,
      sourceTransactionType: "rent_payment", sourceTransactionId: "stmt-import-unique",
      transactionDate: now, category: "RENT_RECEIPT_MANAGER",
    }, p);
    await post({
      business: user.company,
      accountId: income._id, direction: "credit", amount: 5000,
      sourceTransactionType: "rent_payment", sourceTransactionId: "stmt-import-unique",
      transactionDate: now, category: "RENT_RECEIPT_MANAGER",
    }, p);
    const dupA = await post({
      business: user.company,
      accountId: cash._id, direction: "debit", amount: 2000,
      sourceTransactionType: "rent_payment", sourceTransactionId: "stmt-import-dup-a",
      transactionDate: now, category: "RENT_RECEIPT_MANAGER",
    }, p);
    const dupB = await post({
      business: user.company,
      accountId: cash._id, direction: "debit", amount: 2000,
      sourceTransactionType: "rent_payment", sourceTransactionId: "stmt-import-dup-b",
      transactionDate: now, category: "RENT_RECEIPT_MANAGER",
    }, p);

    const importResult = await callController(importStatementLines, {
      user, params: { id: reconId },
      body: { lines: [
        { date: now, amount: 5000, direction: "debit", description: "Unique deposit" },
        { date: now, amount: 2000, direction: "debit", description: "Ambiguous deposit" },
      ] },
    });

    expect(importResult.statusCode).toBe(201);
    expect(importResult.payload.imported).toBe(2);
    expect(importResult.payload.autoMatched).toBe(1);

    const uniqueLine = importResult.payload.lines.find((l) => l.description === "Unique deposit");
    expect(uniqueLine.status).toBe("matched");
    expect(String(uniqueLine.matchedEntry)).toBe(String(unique._id));

    const ambiguousLine = importResult.payload.lines.find((l) => l.description === "Ambiguous deposit");
    expect(ambiguousLine.status).toBe("unmatched");
    const suggestedIds = ambiguousLine.suggestions.map((s) => String(s._id)).sort();
    expect(suggestedIds).toEqual([String(dupA._id), String(dupB._id)].sort());
  });

  it("manual match adds the entry to clearedEntries; unmatch removes it again", async () => {
    const { user, cash, reconId, now, periodStart, periodEnd } = await setup();
    const entry = await post({
      business: user.company,
      accountId: cash._id, direction: "credit", amount: 750,
      sourceTransactionType: "expense", sourceTransactionId: "stmt-import-manual",
      transactionDate: now, category: "PETTY_CASH_EXPENSE",
    }, { periodStart, periodEnd });

    const importResult = await callController(importStatementLines, {
      user, params: { id: reconId },
      body: { lines: [{ date: now, amount: 999999, direction: "credit", description: "No match in books" }] },
    });
    const line = importResult.payload.lines[0];
    expect(line.status).toBe("unmatched");

    const matchResult = await callController(matchStatementLine, {
      user, params: { id: reconId, lineId: line._id },
      body: { entryId: String(entry._id) },
    });
    expect(matchResult.statusCode).toBe(200);
    expect(matchResult.payload.reconciliation.clearedEntries.map(String)).toContain(String(entry._id));

    const unmatchResult = await callController(unmatchStatementLine, {
      user, params: { id: reconId, lineId: line._id },
    });
    expect(unmatchResult.statusCode).toBe(200);
    expect(unmatchResult.payload.reconciliation.clearedEntries.map(String)).not.toContain(String(entry._id));
  });

  it("creating a transaction from an unmatched line posts a real balanced journal and clears it", async () => {
    const { user, cash, income, reconId, now } = await setup();

    const importResult = await callController(importStatementLines, {
      user, params: { id: reconId },
      body: { lines: [{ date: now, amount: 1234, direction: "credit", description: "Bank charge never recorded" }] },
    });
    const line = importResult.payload.lines[0];

    const createTxResult = await callController(createTransactionFromStatementLine, {
      user, params: { id: reconId, lineId: line._id },
      body: { offsetAccount: String(income._id) },
    });
    expect(createTxResult.statusCode).toBe(201);
    expect(createTxResult.payload.journal.status).toBe("posted");
    expect(createTxResult.payload.line.status).toBe("created");
    expect(createTxResult.payload.reconciliation.clearedEntries.map(String)).toContain(String(createTxResult.payload.line.matchedEntry));

    const linesAfter = await callController(listStatementLines, { user, params: { id: reconId } });
    expect(linesAfter.payload.find((l) => String(l._id) === String(line._id)).status).toBe("created");
  });
});

describe("bankReconciliation — reopen (undo a finalised reconciliation)", () => {
  it("requires a reason, reverts status to draft, and records a permanent audit trail", async () => {
    const { user, reconId } = await setup();

    await callController(updateReconciliation, { user, params: { id: reconId }, body: { difference: 0 } });
    await callController(finalizeReconciliation, { user, params: { id: reconId } });

    await expect(callController(reopenReconciliation, { user, params: { id: reconId }, body: {} }))
      .rejects.toThrow(/reason is required/i);

    const reopenResult = await callController(reopenReconciliation, {
      user, params: { id: reconId }, body: { reason: "Statement had an error, need to re-clear one item" },
    });
    expect(reopenResult.statusCode).toBe(200);
    expect(reopenResult.payload.status).toBe("draft");
    expect(reopenResult.payload.reconciledAt).toBeFalsy();
    expect(reopenResult.payload.reopenHistory.length).toBe(1);
    expect(reopenResult.payload.reopenHistory[0].reason).toMatch(/statement had an error/i);

    // Can't reopen something that's already a draft.
    await expect(callController(reopenReconciliation, { user, params: { id: reconId }, body: { reason: "again" } }))
      .rejects.toThrow(/only a finalised/i);
  });
});
