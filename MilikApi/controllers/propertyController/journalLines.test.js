// Multi-line journals: create -> validate -> post -> reverse, with the accounting invariant (debits == credits)
// checked on the real ledger at every step, plus the tags carried onto ledger entries.
import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { createJournalEntry, getJournalEntry, postJournalEntry, reverseJournalEntry, updateJournalEntry, getJournalPostingPreview } from "./journalEntries.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import AccountingPeriod from "../../models/AccountingPeriod.js";
import SaleProject from "../../modules/propertySale/models/SaleProject.js";
import { callController } from "../../test/callController.js";
import { createTestCompany, createTestChartOfAccounts, createTestUser } from "../../test/factories.js";
import { getAccountByCode } from "../../test/factories.financial.js";

const setup = async () => {
  const company = await createTestCompany({ modules: { propertyManagement: true, propertySale: true, accounts: true } });
  await createTestChartOfAccounts(company._id);
  const user = await createTestUser({ company });
  const call = (fn, opts = {}) => callController(fn, { user, ...opts });
  const acct = async (code) => String((await getAccountByCode(company._id, code))._id);
  const project = await SaleProject.create({ business: company._id, projectNumber: "PRJ-1", name: "Kitengela Plots" });
  return { company, user, call, acct, project };
};

const totals = (entries) => ({
  debit: entries.reduce((s, e) => s + Number(e.debit || 0), 0),
  credit: entries.reduce((s, e) => s + Number(e.credit || 0), 0),
});

describe("multi-line journals", () => {
  it("posts an expense with VAT as one balanced group, carries the tags, and reverses cleanly", async () => {
    const { call, acct, project, company } = await setup();
    const expense = await acct("5100"); // Maintenance Expense
    const cash = await acct("1100"); // Cash on Hand
    const receivable = await acct("1200");

    const created = await call(createJournalEntry, {
      body: {
        journalType: "general_manual_journal",
        sourceModule: "propertySale",
        date: new Date(),
        reference: "INV-77",
        narration: "Survey fees for Kitengela Plots",
        lines: [
          { account: expense, debit: 250000, description: "Survey", dimensions: { module: "propertySale", project: String(project._id), costCentre: " Sales " } },
          { account: receivable, debit: 40000, description: "Input VAT" },
          { account: cash, credit: 290000, description: "Paid from cash" },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.payload).toMatchObject({ status: "draft", amount: 290000, sourceModule: "propertySale" });
    expect(created.payload.lines).toHaveLength(3);
    // names come back populated for the screen
    expect(created.payload.lines[0].account.code).toBe("5100");
    expect(created.payload.lines[0].dimensions.project.name).toBe("Kitengela Plots");
    expect(created.payload.lines[0].dimensions.costCentre).toBe("Sales");

    const posted = await call(postJournalEntry, { params: { id: created.payload._id } });
    expect(posted.payload.status).toBe("posted");
    const entries = await FinancialLedgerEntry.find({ journalGroupId: posted.payload.journalGroupId }).lean();
    expect(entries).toHaveLength(3);
    expect(totals(entries)).toEqual({ debit: 290000, credit: 290000 });
    // the project tag is on the ledger entry for the expense line only
    const tagged = entries.filter((e) => String(e.dimensions?.saleProject) === String(project._id));
    expect(tagged).toHaveLength(1);
    expect(tagged[0]).toMatchObject({ direction: "debit", debit: 250000 });
    expect(tagged[0].dimensions).toMatchObject({ module: "propertySale", costCentre: "Sales" });
    expect(String(tagged[0].business)).toBe(String(company._id));

    const reversed = await call(reverseJournalEntry, { params: { id: created.payload._id }, body: { reason: "Posted twice" } });
    expect(reversed.payload.status).toBe("reversed");
    const all = await FinancialLedgerEntry.find({ business: company._id, "metadata.journalNo": created.payload.journalNo }).lean();
    const { debit, credit } = totals(all);
    expect(debit).toBe(credit);
    // the reversal of the expense line keeps the project tag
    const reversal = await FinancialLedgerEntry.find({ business: company._id, category: "REVERSAL", "dimensions.saleProject": project._id }).lean();
    expect(reversal).toHaveLength(1);
    expect(reversal[0]).toMatchObject({ direction: "credit", credit: 250000 });
  });

  it("rejects a journal that does not balance, has one line, or has bad lines", async () => {
    const { call, acct } = await setup();
    const a = await acct("5100");
    const b = await acct("1100");
    const create = (lines, extra = {}) => call(createJournalEntry, { body: { date: new Date(), lines, ...extra } });

    await expect(create([{ account: a, debit: 100 }, { account: b, credit: 99.99 }])).rejects.toThrow(/does not balance.*0\.01/);
    await expect(create([{ account: a, debit: 100 }])).rejects.toThrow(/at least two lines/);
    await expect(create([{ account: a, debit: 100, credit: 100 }, { account: b, credit: 100 }])).rejects.toThrow(/debit or a credit, not both/);
    await expect(create([{ account: a }, { account: b, credit: 100 }])).rejects.toThrow(/enter an amount/);
    await expect(create([{ account: a, debit: -5 }, { account: b, credit: -5 }])).rejects.toThrow(/0 or more/);
    await expect(create([{ account: "", debit: 100 }, { account: b, credit: 100 }])).rejects.toThrow(/choose an account/);
    await expect(create([{ account: new mongoose.Types.ObjectId(), debit: 100 }, { account: b, credit: 100 }])).rejects.toThrow(/not found/);
    await expect(create([{ account: a, debit: 100, dimensions: { module: "bogus" } }, { account: b, credit: 100 }])).rejects.toThrow(/unknown module/);
    await expect(create([{ account: a, debit: 100 }, { account: b, credit: 100 }], { date: "" })).rejects.toThrow(/Date is required/);
    await expect(create([{ account: a, debit: 100 }, { account: b, credit: 100 }], { journalType: "landlord_credit_adjustment" })).rejects.toThrow(/two-line form/);
  });

  it("balances to the cent even with floating point amounts", async () => {
    const { call, acct } = await setup();
    const a = await acct("5100");
    const b = await acct("1100");
    const c = await acct("1200");
    // 0.1 + 0.2 !== 0.3 in floating point, but the journal is balanced to the cent
    const ok = await call(createJournalEntry, { body: { date: new Date(), lines: [
      { account: a, debit: 0.1 }, { account: c, debit: 0.2 }, { account: b, credit: 0.3 },
    ] } });
    expect(ok.payload.amount).toBe(0.3);
  });

  it("keeps tags and accounts inside the company", async () => {
    const { call, acct, project } = await setup();
    const other = await setup(); // another company with its own accounts and project
    const mine = await acct("5100");
    const mine2 = await acct("1100");
    const body = (lines) => ({ date: new Date(), lines });

    // another company's account
    await expect(call(createJournalEntry, { body: body([{ account: await other.acct("5100"), debit: 5 }, { account: mine2, credit: 5 }]) }))
      .rejects.toThrow(/not found in this company/);
    // another company's project
    await expect(call(createJournalEntry, { body: body([
      { account: mine, debit: 5, dimensions: { project: String(other.project._id) } }, { account: mine2, credit: 5 },
    ]) })).rejects.toThrow(/Project not found/);
    // own project is fine
    const ok = await call(createJournalEntry, { body: body([
      { account: mine, debit: 5, dimensions: { project: String(project._id) } }, { account: mine2, credit: 5 },
    ]) });
    expect(ok.statusCode).toBe(201);
  });

  it("edits a draft (lines replaced, still validated) but never a posted journal", async () => {
    const { call, acct } = await setup();
    const a = await acct("5100");
    const b = await acct("1100");
    const created = (await call(createJournalEntry, { body: { date: new Date(), narration: "first", lines: [{ account: a, debit: 100 }, { account: b, credit: 100 }] } })).payload;

    const edited = await call(updateJournalEntry, { params: { id: created._id }, body: { narration: "second", lines: [{ account: a, debit: 250 }, { account: b, credit: 250 }] } });
    expect(edited.payload).toMatchObject({ narration: "second", amount: 250 });
    await expect(call(updateJournalEntry, { params: { id: created._id }, body: { lines: [{ account: a, debit: 250 }, { account: b, credit: 200 }] } })).rejects.toThrow(/does not balance/);

    // editing only the header keeps the lines
    const header = await call(updateJournalEntry, { params: { id: created._id }, body: { narration: "third" } });
    expect(header.payload.lines).toHaveLength(2);

    await call(postJournalEntry, { params: { id: created._id } });
    await expect(call(updateJournalEntry, { params: { id: created._id }, body: { narration: "late" } })).rejects.toThrow(/Only draft/);
  });

  it("refuses to post into a locked period, and leaves nothing half-posted", async () => {
    const { call, acct, company } = await setup();
    const a = await acct("5100");
    const b = await acct("1100");
    const date = new Date();
    await AccountingPeriod.create({
      business: company._id, name: "Locked month", status: "locked",
      startDate: new Date(date.getFullYear(), date.getMonth(), 1), endDate: new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59),
    });
    const created = (await call(createJournalEntry, { body: { date, lines: [{ account: a, debit: 10 }, { account: b, credit: 10 }] } })).payload;
    await expect(call(postJournalEntry, { params: { id: created._id } })).rejects.toThrow(/locked period/);
    expect(await FinancialLedgerEntry.countDocuments({ business: company._id, "metadata.journalNo": created.journalNo })).toBe(0);
    const still = await call(getJournalEntry, { params: { id: created._id } });
    expect(still.payload.status).toBe("draft");
  });

  it("previews (validates) lines without saving, and old two-line journals still work", async () => {
    const { call, acct } = await setup();
    const a = await acct("5100");
    const b = await acct("1100");
    const preview = await call(getJournalPostingPreview, { body: { lines: [{ account: a, debit: 5 }, { account: b, credit: 5 }] } });
    expect(preview.payload).toMatchObject({ balanced: true, totalDebit: 5, totalCredit: 5 });

    const legacy = await call(createJournalEntry, { body: { journalType: "company_journal", debitAccount: a, creditAccount: b, amount: 12, date: new Date() } });
    expect(legacy.statusCode).toBe(201);
    expect(legacy.payload.lines ?? []).toHaveLength(0);
    const posted = await call(postJournalEntry, { params: { id: legacy.payload._id } });
    expect(posted.payload.status).toBe("posted");
  });
});

describe("auto-reversing journals", () => {
  const nextMonth = () => { const d = new Date(); d.setMonth(d.getMonth() + 1, 1); return d; };

  it("posts a dated mirror journal so the accrual nets to zero, and refuses a second reversal", async () => {
    const { call, acct, company } = await setup();
    const expense = await acct("5100");
    const payable = await acct("1200");
    const date = new Date();
    const created = (await call(createJournalEntry, { body: { date, autoReverseDate: nextMonth(), narration: "Accrue audit fee", lines: [
      { account: expense, debit: 900 }, { account: payable, credit: 900 },
    ] } })).payload;
    expect(created.autoReverseDate).toBeTruthy();

    const posted = (await call(postJournalEntry, { params: { id: created._id } })).payload;
    expect(posted.status).toBe("posted");
    expect(posted.autoReversal).toMatchObject({ posted: true });

    const all = await FinancialLedgerEntry.find({ business: company._id, category: "ADJUSTMENT" }).lean();
    expect(all).toHaveLength(4);
    expect(totals(all).debit).toBe(totals(all).credit);
    const net = (id) => all.filter((e) => String(e.accountId) === id).reduce((s, e) => s + e.debit - e.credit, 0);
    expect(net(expense)).toBe(0);
    expect(net(payable)).toBe(0);
    // the mirror carries the later date — compare calendar month/year directly rather than a
    // single millisecond threshold, since "last day of this month at midnight" sits BEFORE
    // "now" whenever the test happens to run on the month's last day, which made every entry
    // (not just the 2 mirror ones) satisfy a `>` threshold comparison.
    const mirrorDate = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    expect(all.filter((e) => {
      const d = new Date(e.transactionDate);
      return d.getFullYear() === mirrorDate.getFullYear() && d.getMonth() === mirrorDate.getMonth();
    })).toHaveLength(2);

    await expect(call(reverseJournalEntry, { params: { id: created._id }, body: { reason: "again" } })).rejects.toThrow(/already reversed automatically/);
  });

  it("rejects a reverse date that is not after the journal date", async () => {
    const { call, acct } = await setup();
    const lines = [{ account: await acct("5100"), debit: 5 }, { account: await acct("1100"), credit: 5 }];
    await expect(call(createJournalEntry, { body: { date: new Date(), autoReverseDate: new Date(Date.now() - 86400000), lines } })).rejects.toThrow(/after the journal date/);
  });

  it("keeps the original posted and the mirror as a draft when the reverse date is in a locked period", async () => {
    const { call, acct, company } = await setup();
    const a = await acct("5100");
    const b = await acct("1200");
    const later = nextMonth();
    await AccountingPeriod.create({
      business: company._id, name: "Locked next month", status: "locked",
      startDate: new Date(later.getFullYear(), later.getMonth(), 1), endDate: new Date(later.getFullYear(), later.getMonth() + 1, 0, 23, 59, 59),
    });
    const created = (await call(createJournalEntry, { body: { date: new Date(), autoReverseDate: later, lines: [{ account: a, debit: 40 }, { account: b, credit: 40 }] } })).payload;
    const posted = (await call(postJournalEntry, { params: { id: created._id } })).payload;
    expect(posted.status).toBe("posted");
    expect(posted.autoReversal).toMatchObject({ posted: false });
    expect(posted.autoReversal.message).toMatch(/locked period/);
    expect(await FinancialLedgerEntry.countDocuments({ business: company._id, category: "ADJUSTMENT" })).toBe(2);
    // the original can still be reversed by hand
    const reversed = await call(reverseJournalEntry, { params: { id: created._id }, body: { reason: "manual" } });
    expect(reversed.payload.status).toBe("reversed");
  });
});
