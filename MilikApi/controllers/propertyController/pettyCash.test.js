// No test coverage existed for Petty Cash before this file. Added alongside a standards audit
// that surfaced two real gaps: (1) every route only required verifyUser, never
// requireCompanyPermission, despite accessMatrix.js declaring real pettyCash permission tiers —
// fixed in routes/propertyRoutes/pettyCash.js, not exercised here since callController bypasses
// route middleware entirely (consistent with how this codebase tests controllers elsewhere).
// (2) GL postings silently produced zero (or one-sided) entries whenever the petty cash account
// had no glAccountId or a disbursement/replenishment had no expense/bank account — the subledger
// balance still moved, permanently diverging it from the GL. Fixed by making both legs mandatory
// and both account references required up front; these tests cover that specifically.
import { describe, it, expect } from "vitest";
import {
  createPettyCashAccount,
  createDisbursement,
  getPettyCashAccount,
  voidDisbursement,
  requestReplenishment,
  postReplenishment,
  getPettyCashLedger,
  rejectReplenishment,
} from "./pettyCash.js";
import PettyCashAccount from "../../models/PettyCashAccount.js";
import { callController } from "../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../test/factories.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";

const setup = async () => {
  const company = await createTestCompany();
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const [pettyCashAsset, expenseAccount, bankAccount] = await Promise.all([
    ChartOfAccount.create({ business: company._id, code: "1010", name: "Petty Cash", type: "asset", isPosting: true }),
    ChartOfAccount.create({ business: company._id, code: "5800", name: "Office Supplies Expense", type: "expense", isPosting: true }),
    ChartOfAccount.create({ business: company._id, code: "1000", name: "Main Bank", type: "asset", isPosting: true }),
  ]);
  return { company, user, pettyCashAsset, expenseAccount, bankAccount };
};

const createAccount = (ctx, overrides = {}) => callController(createPettyCashAccount, {
  user: ctx.user,
  body: {
    name: "Head Office Petty Cash",
    floatAmount: 10000,
    glAccountId: String(ctx.pettyCashAsset._id),
    ...overrides,
  },
});

// A new account always starts at currentBalance 0 (the float is a target, not an automatic
// opening balance — funding is its own GL transaction via a replenishment). Tests that need a
// funded account to disburse against set the balance directly rather than running the full
// request+approve+post replenishment flow each time; the replenishment tests below exercise
// that real flow on its own.
const fundAccount = (accountId, amount) => PettyCashAccount.updateOne({ _id: accountId }, { $set: { currentBalance: amount } });

describe("pettyCash — account creation requires a GL account", () => {
  it("rejects an account with no glAccountId (regression for silent zero-leg GL posting)", async () => {
    const ctx = await setup();
    await expect(createAccount(ctx, { glAccountId: undefined })).rejects.toThrow(/gl asset account is required/i);
  });

  it("creates an account with a glAccountId and zero starting balance", async () => {
    const ctx = await setup();
    const res = await createAccount(ctx);
    expect(res.statusCode).toBe(201);
    expect(res.payload.data.currentBalance).toBe(0);
  });
});

describe("pettyCash — disbursements require an expense account and post both GL legs", () => {
  it("rejects a disbursement with no expenseAccountId", async () => {
    const ctx = await setup();
    const acct = await createAccount(ctx);
    await expect(callController(createDisbursement, {
      user: ctx.user,
      body: { pettyCashAccountId: acct.payload.data._id, date: "2026-01-10", amount: 500, description: "Stationery", category: "office_supplies" },
    })).rejects.toThrow(/expense account is required/i);
  });

  it("posts a debit (expense) and credit (petty cash asset) leg and deducts the account balance", async () => {
    const ctx = await setup();
    const acct = await createAccount(ctx);
    await fundAccount(acct.payload.data._id, 10000);

    const res = await callController(createDisbursement, {
      user: ctx.user,
      body: {
        pettyCashAccountId: acct.payload.data._id,
        date: "2026-01-10",
        amount: 500,
        description: "Stationery",
        category: "office_supplies",
        expenseAccountId: String(ctx.expenseAccount._id),
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.payload.account.currentBalance).toBe(9500);
    expect(res.payload.data.postedToLedger).toBe(true);

    const entries = await FinancialLedgerEntry.find({ sourceTransactionType: "petty_cash_disbursement", sourceTransactionId: String(res.payload.data._id) }).lean();
    expect(entries).toHaveLength(2);
    const debit = entries.find((e) => e.direction === "debit");
    const credit = entries.find((e) => e.direction === "credit");
    expect(String(debit.accountId)).toBe(String(ctx.expenseAccount._id));
    expect(String(credit.accountId)).toBe(String(ctx.pettyCashAsset._id));
    expect(debit.debit).toBe(500);
    expect(credit.credit).toBe(500);
  });

  it("rejects disbursing more than the account's current balance", async () => {
    const ctx = await setup();
    const acct = await createAccount(ctx, { floatAmount: 100 });
    await fundAccount(acct.payload.data._id, 100);
    await expect(callController(createDisbursement, {
      user: ctx.user,
      body: {
        pettyCashAccountId: acct.payload.data._id,
        date: "2026-01-10",
        amount: 500,
        description: "Too much",
        category: "office_supplies",
        expenseAccountId: String(ctx.expenseAccount._id),
      },
    })).rejects.toThrow(/insufficient petty cash balance/i);
  });
});

describe("pettyCash — voiding reverses the GL and restores the balance", () => {
  it("reverses both legs and restores the account balance", async () => {
    const ctx = await setup();
    const acct = await createAccount(ctx);
    await fundAccount(acct.payload.data._id, 10000);
    const created = await callController(createDisbursement, {
      user: ctx.user,
      body: {
        pettyCashAccountId: acct.payload.data._id,
        date: "2026-01-10",
        amount: 500,
        description: "Stationery",
        category: "office_supplies",
        expenseAccountId: String(ctx.expenseAccount._id),
      },
    });

    const voided = await callController(voidDisbursement, {
      user: ctx.user,
      params: { id: created.payload.data._id },
      body: { voidReason: "Duplicate entry" },
    });
    expect(voided.payload.data.status).toBe("void");

    const afterAccount = await callController(getPettyCashAccount, { user: ctx.user, params: { id: acct.payload.data._id } });
    expect(afterAccount.payload.data.currentBalance).toBe(10000);

    // Original 2 legs flip to "reversed"; 2 new offsetting legs are posted as "approved" — net
    // effect across all 4 is zero, which is what actually matters (not an empty ledger).
    const allEntries = await FinancialLedgerEntry.find({
      sourceTransactionType: "petty_cash_disbursement",
      sourceTransactionId: String(created.payload.data._id),
    }).lean();
    expect(allEntries).toHaveLength(4);
    expect(allEntries.filter((e) => e.status === "reversed")).toHaveLength(2);
    expect(allEntries.filter((e) => e.status === "approved")).toHaveLength(2);
    const netDebit = allEntries.reduce((s, e) => s + (e.debit || 0) - (e.credit || 0), 0);
    expect(netDebit).toBe(0);
  });
});

describe("pettyCash — replenishments require a funding bank account and post both GL legs", () => {
  it("rejects a replenishment request with no bankAccountId", async () => {
    const ctx = await setup();
    const acct = await createAccount(ctx);
    await expect(callController(requestReplenishment, {
      user: ctx.user,
      body: { pettyCashAccountId: acct.payload.data._id, amount: 2000 },
    })).rejects.toThrow(/funding bank account is required/i);
  });

  it("posts a debit (petty cash asset) and credit (bank) leg and restores the balance, capped at the float", async () => {
    const ctx = await setup();
    const acct = await createAccount(ctx, { floatAmount: 10000 });
    await fundAccount(acct.payload.data._id, 10000);
    await callController(createDisbursement, {
      user: ctx.user,
      body: {
        pettyCashAccountId: acct.payload.data._id,
        date: "2026-01-10",
        amount: 7000,
        description: "Big spend",
        category: "office_supplies",
        expenseAccountId: String(ctx.expenseAccount._id),
      },
    }); // balance now 3000

    const requested = await callController(requestReplenishment, {
      user: ctx.user,
      body: { pettyCashAccountId: acct.payload.data._id, amount: 9000, bankAccountId: String(ctx.bankAccount._id) }, // over-requested on purpose
    });

    const posted = await callController(postReplenishment, { user: ctx.user, params: { id: requested.payload.data._id } });
    expect(posted.payload.account.currentBalance).toBe(10000); // capped at float, not 12000

    const entries = await FinancialLedgerEntry.find({ sourceTransactionType: "petty_cash_replenishment", sourceTransactionId: String(requested.payload.data._id) }).lean();
    expect(entries).toHaveLength(2);
    const debit = entries.find((e) => e.direction === "debit");
    const credit = entries.find((e) => e.direction === "credit");
    expect(String(debit.accountId)).toBe(String(ctx.pettyCashAsset._id));
    expect(String(credit.accountId)).toBe(String(ctx.bankAccount._id));
  });
});

describe("pettyCash — unified ledger merges disbursements and replenishments with a running balance", () => {
  it("orders newest-first and only moves the running balance for rows that actually affected it", async () => {
    const ctx = await setup();
    const acct = await createAccount(ctx, { floatAmount: 10000 });
    await fundAccount(acct.payload.data._id, 10000);

    // Active disbursement — affects balance (-500)
    const active = await callController(createDisbursement, {
      user: ctx.user,
      body: { pettyCashAccountId: acct.payload.data._id, date: "2026-01-05", amount: 500, description: "Taxi", category: "transport", expenseAccountId: String(ctx.expenseAccount._id) },
    });
    // Voided disbursement — appears in the ledger but must NOT move the balance
    const voided = await callController(createDisbursement, {
      user: ctx.user,
      body: { pettyCashAccountId: acct.payload.data._id, date: "2026-01-10", amount: 200, description: "Snacks (mistake)", category: "miscellaneous", expenseAccountId: String(ctx.expenseAccount._id) },
    });
    await callController(voidDisbursement, { user: ctx.user, params: { id: voided.payload.data._id }, body: { voidReason: "Wrong account" } });
    // Posted replenishment — affects balance (+1000)
    const repRequested = await callController(requestReplenishment, {
      user: ctx.user,
      body: { pettyCashAccountId: acct.payload.data._id, amount: 1000, bankAccountId: String(ctx.bankAccount._id), requestDate: "2026-01-15" },
    });
    await callController(postReplenishment, { user: ctx.user, params: { id: repRequested.payload.data._id } });
    // Pending replenishment — appears in the ledger but must NOT move the balance
    await callController(requestReplenishment, {
      user: ctx.user,
      body: { pettyCashAccountId: acct.payload.data._id, amount: 2000, bankAccountId: String(ctx.bankAccount._id), requestDate: "2026-01-20" },
    });

    const res = await callController(getPettyCashLedger, { user: ctx.user, params: { id: acct.payload.data._id } });
    expect(res.payload.total).toBe(4);
    // newest-first: pending rep (Jan 20) -> posted rep (Jan 15) -> voided disb (Jan 10) -> active disb (Jan 5)
    const kinds = res.payload.data.map((r) => `${r.kind}:${r.status}`);
    expect(kinds).toEqual(["replenishment:pending", "replenishment:posted", "disbursement:void", "disbursement:active"]);

    // The ledger replays only the rows it can see (the running balance starts at 0, not at the
    // account's real currentBalance, which fundAccount() set directly outside any real
    // transaction) — so expected values here are relative to that replay, not to 10000.
    const byRef = Object.fromEntries(res.payload.data.map((r) => [r.ref, r]));
    expect(byRef[active.payload.data.voucherNumber].balanceAfter).toBe(-500);
    expect(byRef[voided.payload.data.voucherNumber].balanceAfter).toBe(-500); // void: unchanged from prior
    expect(byRef[repRequested.payload.data.replenishmentNumber].balanceAfter).toBe(500); // -500 + 1000
    // pending replenishment leaves the running balance exactly where the posted one left it
    const pendingRow = res.payload.data.find((r) => r.status === "pending");
    expect(pendingRow.balanceAfter).toBe(500);
  });

  it("filters by type and status, and still reflects a rejected replenishment without moving the balance", async () => {
    const ctx = await setup();
    const acct = await createAccount(ctx);
    await fundAccount(acct.payload.data._id, 5000);

    const rep = await callController(requestReplenishment, {
      user: ctx.user,
      body: { pettyCashAccountId: acct.payload.data._id, amount: 1000, bankAccountId: String(ctx.bankAccount._id) },
    });
    await callController(rejectReplenishment, { user: ctx.user, params: { id: rep.payload.data._id }, body: { rejectionReason: "Not needed" } });

    const disbOnly = await callController(getPettyCashLedger, { user: ctx.user, params: { id: acct.payload.data._id }, query: { type: "disbursement" } });
    expect(disbOnly.payload.total).toBe(0);

    const rejectedOnly = await callController(getPettyCashLedger, { user: ctx.user, params: { id: acct.payload.data._id }, query: { status: "rejected" } });
    expect(rejectedOnly.payload.total).toBe(1);
    expect(rejectedOnly.payload.data[0].balanceAfter).toBe(0); // never affected the balance
    expect(rejectedOnly.payload.account.currentBalance).toBe(5000); // real account balance untouched
  });

  it("orders a same-day replenishment before a same-day disbursement by real posting order, not by raw timestamp (regression for a live bug: a disbursement's date is always midnight, a replenishment's defaults to its real request time, so comparing raw timestamps put the disbursement first even when it was actually posted second)", async () => {
    const ctx = await setup();
    const acct = await createAccount(ctx, { floatAmount: 10000 });
    const today = new Date().toISOString().slice(0, 10);

    // Replenish first (real flow: fund the box, then spend from it) — requestDate defaults to now.
    const rep = await callController(requestReplenishment, {
      user: ctx.user,
      body: { pettyCashAccountId: acct.payload.data._id, amount: 10000, bankAccountId: String(ctx.bankAccount._id) },
    });
    await callController(postReplenishment, { user: ctx.user, params: { id: rep.payload.data._id } });

    // Then disburse, same calendar day, but the date field is a plain date picker (midnight).
    const disb = await callController(createDisbursement, {
      user: ctx.user,
      body: { pettyCashAccountId: acct.payload.data._id, date: today, amount: 580, description: "Monday breakfast", category: "office_supplies", expenseAccountId: String(ctx.expenseAccount._id) },
    });

    const res = await callController(getPettyCashLedger, { user: ctx.user, params: { id: acct.payload.data._id } });
    const repRow = res.payload.data.find((r) => r.kind === "replenishment");
    const disbRow = res.payload.data.find((r) => r.kind === "disbursement");
    expect(repRow.balanceAfter).toBe(10000);
    expect(disbRow.balanceAfter).toBe(9420);
  });
});

describe("pettyCash — GL narration carries enough context to audit without the Petty Cash page", () => {
  it("disbursement narration includes the voucher number, category, description and account name", async () => {
    const ctx = await setup();
    const acct = await createAccount(ctx);
    await fundAccount(acct.payload.data._id, 10000);

    const created = await callController(createDisbursement, {
      user: ctx.user,
      body: {
        pettyCashAccountId: acct.payload.data._id,
        date: "2026-01-10",
        amount: 500,
        description: "Monday breakfast",
        category: "office_supplies",
        expenseAccountId: String(ctx.expenseAccount._id),
      },
    });

    const entry = await FinancialLedgerEntry.findOne({ sourceTransactionType: "petty_cash_disbursement", sourceTransactionId: String(created.payload.data._id) }).lean();
    expect(entry.notes).toContain(created.payload.data.voucherNumber);
    expect(entry.notes).toContain("Office Supplies");
    expect(entry.notes).toContain("Monday breakfast");
    expect(entry.notes).toContain(acct.payload.data.name);
  });

  it("void narration includes the voucher number and the reason, never just a bare description", async () => {
    const ctx = await setup();
    const acct = await createAccount(ctx);
    await fundAccount(acct.payload.data._id, 10000);
    const created = await callController(createDisbursement, {
      user: ctx.user,
      body: { pettyCashAccountId: acct.payload.data._id, date: "2026-01-10", amount: 500, description: "Taxi", category: "transport", expenseAccountId: String(ctx.expenseAccount._id) },
    });

    await callController(voidDisbursement, { user: ctx.user, params: { id: created.payload.data._id }, body: { voidReason: "Wrong account charged" } });

    const reversalEntry = await FinancialLedgerEntry.findOne({ sourceTransactionType: "petty_cash_disbursement", sourceTransactionId: String(created.payload.data._id), status: "approved" }).lean();
    expect(reversalEntry.notes).toContain(created.payload.data.voucherNumber);
    expect(reversalEntry.notes).toContain("Wrong account charged");
  });

  it("replenishment narration keeps the ref number even when a note is present (regression: notes used to silently replace it)", async () => {
    const ctx = await setup();
    const acct = await createAccount(ctx);

    const rep = await callController(requestReplenishment, {
      user: ctx.user,
      body: { pettyCashAccountId: acct.payload.data._id, amount: 2000, bankAccountId: String(ctx.bankAccount._id), notes: "Urgent, approved by boss" },
    });
    await callController(postReplenishment, { user: ctx.user, params: { id: rep.payload.data._id } });

    const entry = await FinancialLedgerEntry.findOne({ sourceTransactionType: "petty_cash_replenishment", sourceTransactionId: String(rep.payload.data._id) }).lean();
    expect(entry.notes).toContain(rep.payload.data.replenishmentNumber);
    expect(entry.notes).toContain("Urgent, approved by boss");
    expect(entry.notes).toContain(acct.payload.data.name);
  });
});
