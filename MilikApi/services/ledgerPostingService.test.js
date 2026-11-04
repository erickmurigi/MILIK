// Tests the single most valuable invariant in this codebase's accounting engine:
// every posted transaction's debits must equal its credits, and a reversal must
// exactly negate the entry it reverses. postEntry/postReversal live in
// services/ledgerPostingService.js and are the low-level primitive every higher
// controller (journal entries, payment vouchers, receipts, invoices) posts through.
import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { postEntry, postEntries, postReversal, postCorrection } from "./ledgerPostingService.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
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

  // Regression test for a real production bug found while removing duplicate invoices live: 10
  // entries had dimensions.costCentre stored as the literal string "" instead of null (an
  // ObjectId-typed field) — valid at document CONSTRUCTION time since Mongoose doesn't cast-validate
  // eagerly, but fatal the moment anything tries to save that same shape again, which is exactly
  // what postReversal does (it copies `dimensions` straight off the original). Every
  // deleteTenantInvoice call on one of these invoices failed with a Cast-to-ObjectId error and left
  // the duplicate stuck. The fix sanitizes dimensions inside postEntry itself — the one chokepoint
  // every entry (original or reversal) is posted through — so "" can never be persisted again, and
  // a reversal of an already-corrupted entry no longer fails.
  it("sanitizes an empty-string ObjectId dimension so it is never persisted, and so a reversal of an already-corrupted entry still succeeds", async () => {
    const company = await createTestCompany();
    await createTestChartOfAccounts(company._id);
    const cash = await getAccountByCode(company._id, "1100");

    const now = new Date();
    const { start, end } = buildStatementPeriod(now);

    // A fresh entry explicitly passing "" for an ObjectId dimension must come back sanitized to null.
    const fresh = await postEntry({
      business: company._id,
      allowUnscoped: true,
      accountId: cash._id,
      sourceTransactionType: "manual_adjustment",
      sourceTransactionId: "ledger-posting-test-3",
      transactionDate: now,
      statementPeriodStart: start,
      statementPeriodEnd: end,
      category: "ADJUSTMENT",
      amount: 500,
      direction: "debit",
      payer: "manager",
      receiver: "system",
      notes: "Entry with a stray empty-string dimension",
      dimensions: { costCentre: "" },
    });
    expect(fresh.dimensions?.costCentre ?? null).toBeNull();

    // Simulate the real-world corrupted state directly (bypassing Mongoose validators, the same
    // way the live bad data got there) — an entry already saved with costCentre: "".
    await FinancialLedgerEntry.collection.updateOne(
      { _id: fresh._id },
      { $set: { "dimensions.costCentre": "" } }
    );

    const { reversalEntry } = await postReversal({
      entryId: fresh._id,
      reason: "Test reversal of a corrupted entry",
      userId: null,
    });
    expect(reversalEntry.dimensions?.costCentre ?? null).toBeNull();
  });

  // Regression test for a real production bug found via the GL integrity report: GLR was out of
  // balance by KES 77,000 across 13 journal groups, every one showing the SAME original debit leg
  // reversed TWICE (two reversal credit entries) while its sibling credit leg was only reversed
  // once. Root cause: postReversal read the original entry, checked "already reversed" in app
  // code, and only wrote status:"reversed" back at the very end — two overlapping calls for the
  // same entryId (two overlapping deleteTenantInvoice requests for the same invoice, e.g. a
  // double-submitted removal script) could both read "not yet reversed" before either had written,
  // so both posted a reversal. Fixed by claiming the entry atomically (a single conditional
  // updateOne) before anything else runs, so only one concurrent caller can ever win.
  it("never reverses the same entry twice when two callers race, even though both see it as not-yet-reversed", async () => {
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
      sourceTransactionId: "ledger-posting-test-race",
      transactionDate: now,
      statementPeriodStart: start,
      statementPeriodEnd: end,
      category: "ADJUSTMENT",
      amount: 13000,
      direction: "debit",
      payer: "manager",
      receiver: "system",
      notes: "Entry two concurrent reversals will race against",
    });

    const results = await Promise.allSettled([
      postReversal({ entryId: original._id, reason: "racer A", userId: null }),
      postReversal({ entryId: original._id, reason: "racer B", userId: null }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected").reason.message).toMatch(/already reversed/i);

    const allEntries = await FinancialLedgerEntry.find({
      business: company._id, sourceTransactionType: "manual_adjustment", sourceTransactionId: "ledger-posting-test-race",
    }).lean();
    // Exactly 2: the original (now reversed) plus ONE reversal entry — not two.
    expect(allEntries).toHaveLength(2);
    const reversalRows = allEntries.filter((e) => e.category === "REVERSAL");
    expect(reversalRows).toHaveLength(1);

    const netDebit = allEntries.reduce((sum, e) => sum + Number(e.debit || 0), 0);
    const netCredit = allEntries.reduce((sum, e) => sum + Number(e.credit || 0), 0);
    expect(netDebit).toBe(netCredit);
  });

  // Regression test for a real production bug found via the GL integrity report: a landlord
  // advancement's bank account was reclassified (chart-of-accounts "reclassify" endpoint, which
  // calls postCorrection without ever passing its own journalGroupId), and the corrected entry
  // came out with journalGroupId: null — invisible to the integrity report's per-group balance
  // check, which only examines entries that have one. The money was never wrong, but the
  // correction's own two legs (the reversal and its replacement) ended up split across two
  // different "groups" (one real, one none) instead of staying together as a single journal.
  it("posts the corrected entry into the SAME journal group as the reversal it follows", async () => {
    const company = await createTestCompany();
    await createTestChartOfAccounts(company._id);
    const cash = await getAccountByCode(company._id, "1100");
    const bank2 = await getAccountByCode(company._id, "4100");

    const now = new Date();
    const { start, end } = buildStatementPeriod(now);

    const original = await postEntry({
      business: company._id,
      allowUnscoped: true,
      accountId: cash._id,
      sourceTransactionType: "manual_adjustment",
      sourceTransactionId: "ledger-posting-test-correction",
      transactionDate: now,
      statementPeriodStart: start,
      statementPeriodEnd: end,
      category: "ADJUSTMENT",
      amount: 20000,
      direction: "credit",
      payer: "manager",
      receiver: "system",
      notes: "Entry to be reclassified to a different account",
    });

    const { reversalEntry, correctedEntry } = await postCorrection({
      entryId: original._id,
      reason: "Reclassified to a different bank account",
      userId: new mongoose.Types.ObjectId(),
      correctedPayload: {
        accountId: bank2._id,
        category: original.category,
        amount: original.amount,
        direction: original.direction,
        notes: "Reclassified",
      },
    });

    expect(correctedEntry.journalGroupId).toBeTruthy();
    expect(String(correctedEntry.journalGroupId)).toBe(String(reversalEntry.journalGroupId));
  });

  // Regression test for postEntries' own ghost-write vulnerability: the old implementation posted each
  // leg sequentially and, on failure, tried to reverse whatever had already been pushed onto its local
  // `posted` array — but a leg that ghost-writes (the insert commits on the server while the driver's
  // write-acknowledgment is lost, so the `await postEntry(...)` call itself still throws) never gets
  // pushed onto `posted`, so that catch block could never see it. postEntries now wraps the whole loop
  // in one Mongo transaction instead, so MongoDB rolls back every write made inside it — this proves the
  // first (successfully-written) leg does not survive when a later leg in the same batch fails.
  it("postEntries leaves no leg behind when a later payload in the batch fails", async () => {
    const company = await createTestCompany();
    await createTestChartOfAccounts(company._id);
    const cash = await getAccountByCode(company._id, "1100");
    const income = await getAccountByCode(company._id, "4100");

    const now = new Date();
    const { start, end } = buildStatementPeriod(now);
    const sourceTransactionId = "ledger-posting-test-postEntries-atomic";

    const base = {
      business: company._id,
      allowUnscoped: true,
      sourceTransactionType: "manual_adjustment",
      sourceTransactionId,
      transactionDate: now,
      statementPeriodStart: start,
      statementPeriodEnd: end,
      category: "ADJUSTMENT",
      amount: 4000,
      payer: "manager",
      receiver: "system",
    };

    // The first payload's account is real and would, under the old sequential-with-manual-reversal
    // code, be inserted and left behind the moment the second payload's account is invalid. The second
    // payload's accountId is a fresh, never-created ObjectId, so validatePostingAccount deterministically
    // rejects it ("posting account was not found") on every run.
    await expect(
      postEntries([
        { ...base, accountId: cash._id, direction: "debit", notes: "First leg — would ghost-write under the old code" },
        { ...base, accountId: income._id, direction: "credit", notes: "irrelevant" },
        { ...base, accountId: new mongoose.Types.ObjectId(), direction: "credit", notes: "Forces the batch to fail" },
      ])
    ).rejects.toThrow(/posting account/i);

    const entries = await FinancialLedgerEntry.find({
      business: company._id,
      sourceTransactionType: "manual_adjustment",
      sourceTransactionId,
    }).lean();
    expect(entries).toHaveLength(0);
  });

  // postEntries must also be usable as a participant in a caller's OWN transaction (passing `session`)
  // rather than always opening its own — otherwise a caller that needs to .save() a parent record
  // alongside these legs in the same atomic unit (as journalEntries.js's postJournalToLedger does
  // around postEntry directly) would have no way to fold postEntries' legs into that same transaction.
  it("postEntries joins an externally-supplied session instead of opening a nested transaction", async () => {
    const company = await createTestCompany();
    await createTestChartOfAccounts(company._id);
    const cash = await getAccountByCode(company._id, "1100");
    const income = await getAccountByCode(company._id, "4100");

    const now = new Date();
    const { start, end } = buildStatementPeriod(now);
    const sourceTransactionId = "ledger-posting-test-postEntries-external-session";

    const base = {
      business: company._id,
      allowUnscoped: true,
      sourceTransactionType: "manual_adjustment",
      sourceTransactionId,
      transactionDate: now,
      statementPeriodStart: start,
      statementPeriodEnd: end,
      category: "ADJUSTMENT",
      amount: 2500,
      payer: "manager",
      receiver: "system",
    };

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await postEntries(
          [
            { ...base, accountId: cash._id, direction: "debit", notes: "Debit leg" },
            { ...base, accountId: income._id, direction: "credit", notes: "Credit leg" },
          ],
          { session }
        );
      });
    } finally {
      await session.endSession();
    }

    const entries = await FinancialLedgerEntry.find({
      business: company._id,
      sourceTransactionType: "manual_adjustment",
      sourceTransactionId,
    }).lean();
    expect(entries).toHaveLength(2);
  });
});
