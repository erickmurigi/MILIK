import { describe, it, expect } from "vitest";
import { remitVat, voidRemittance } from "./taxRemittance.js";
import TaxRemittance from "../../models/TaxRemittance.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import { callController } from "../../test/callController.js";
import { createTestChartOfAccounts, createTestCompany, createTestUser } from "../../test/factories.js";

const getCashbookAccount = async (businessId) =>
  ChartOfAccount.findOne({ business: businessId, code: "1100" }).lean();

describe("remitVat — GL posting atomicity", () => {
  it("posts Dr VAT Payable / Cr Cashbook and creates the remittance record", async () => {
    const company = await createTestCompany();
    await createTestChartOfAccounts(company._id);
    const user = await createTestUser({ company });
    const cashbook = await getCashbookAccount(company._id);

    const { statusCode, payload } = await callController(remitVat, {
      body: {
        business: String(company._id),
        year: 2026,
        month: 3,
        amountRemitted: 5000,
        paymentDate: new Date(2026, 2, 15),
        paymentReference: "KRA-VAT-001",
        cashbookAccountId: String(cashbook._id),
      },
      user,
    });

    expect(statusCode).toBe(201);
    expect(payload.status).toBe("remitted");

    const entries = await FinancialLedgerEntry.find({
      business: company._id,
      sourceTransactionType: "tax_remittance",
      sourceTransactionId: String(payload._id),
    }).lean();
    expect(entries).toHaveLength(2);
  });

  // Regression test for the same ghost-write failure mode fixed in whtRemittance.js: the old code
  // created the TaxRemittance first, then claimed the payment reference, then posted the GL legs
  // sequentially with no transaction, relying on a manual TaxRemittance.deleteOne +
  // FinancialLedgerEntry.deleteMany in the catch block to "undo" a failed attempt. That assumes
  // "the call threw => nothing was written", which is false under a ghost write (a save() that
  // commits on the primary but loses its acknowledgment). Fixed by wrapping the TaxRemittance.create
  // call, the payment-reference claim, and every GL leg in one Mongo transaction, so any step's
  // failure rolls back every write from that attempt, inserts included.
  it("rolls back the TaxRemittance and both GL legs if the second leg's posting fails", async () => {
    const company = await createTestCompany();
    await createTestChartOfAccounts(company._id);
    const user = await createTestUser({ company });
    const cashbook = await getCashbookAccount(company._id);

    // Force the SECOND leg's posting (Cr Cashbook) to fail deterministically, while the first leg
    // (Dr VAT Payable) still succeeds and is actually inserted inside the transaction. The remitVat
    // controller's own pre-check on cashbookAccountId only filters on `isActive` (not `active`), so
    // a document with a stale `active: false` from an old record still passes that check and lets
    // the request proceed — but postEntry's own validatePostingAccount defensively checks BOTH
    // `active` and `isActive` for legacy documents, so the second leg's own postEntry call throws
    // once it actually tries to post to this account.
    await ChartOfAccount.collection.updateOne({ _id: cashbook._id }, { $set: { active: false } });

    await expect(
      callController(remitVat, {
        body: {
          business: String(company._id),
          year: 2026,
          month: 4,
          amountRemitted: 7000,
          paymentDate: new Date(2026, 3, 10),
          paymentReference: "KRA-VAT-002",
          cashbookAccountId: String(cashbook._id),
        },
        user,
      })
    ).rejects.toThrow();

    // No orphaned TaxRemittance record.
    expect(await TaxRemittance.countDocuments({ business: company._id })).toBe(0);

    // No orphaned one-sided GL entry from the first leg's otherwise-successful insert.
    expect(
      await FinancialLedgerEntry.countDocuments({
        business: company._id,
        sourceTransactionType: "tax_remittance",
      })
    ).toBe(0);
  });
});

describe("voidRemittance — GL reversal atomicity", () => {
  it("reverses both legs and marks the remittance voided", async () => {
    const company = await createTestCompany();
    await createTestChartOfAccounts(company._id);
    const user = await createTestUser({ company });
    const cashbook = await getCashbookAccount(company._id);

    const { payload: remittance } = await callController(remitVat, {
      body: {
        business: String(company._id),
        year: 2026,
        month: 5,
        amountRemitted: 4000,
        paymentDate: new Date(2026, 4, 5),
        paymentReference: "KRA-VAT-003",
        cashbookAccountId: String(cashbook._id),
      },
      user,
    });

    const { statusCode, payload } = await callController(voidRemittance, {
      params: { id: String(remittance._id) },
      body: { business: String(company._id), reason: "test void" },
      user,
    });

    expect(statusCode).toBe(200);
    expect(payload.status).toBe("voided");

    const entries = await FinancialLedgerEntry.find({
      business: company._id,
      sourceTransactionType: "tax_remittance",
      sourceTransactionId: String(remittance._id),
      category: { $ne: "REVERSAL" },
    }).lean();
    expect(entries.length).toBeGreaterThan(0);
    entries.forEach((entry) => expect(entry.reversedByEntry).toBeTruthy());
  });

  // Regression test mirroring deleteTenantInvoice's "rolls back every leg's reversal..." test
  // (tenantInvoices.test.js): forces the SECOND leg's reversal to fail deterministically — by
  // deleting its ChartOfAccount document outright, so postEntry's own account-existence check
  // throws — after the first leg's reversal has already been created inside the transaction.
  it("rolls back every leg's reversal, leaving no orphaned entry, if the second leg's reversal fails", async () => {
    const company = await createTestCompany();
    await createTestChartOfAccounts(company._id);
    const user = await createTestUser({ company });
    const cashbook = await getCashbookAccount(company._id);

    const { payload: remittance } = await callController(remitVat, {
      body: {
        business: String(company._id),
        year: 2026,
        month: 6,
        amountRemitted: 6000,
        paymentDate: new Date(2026, 5, 5),
        paymentReference: "KRA-VAT-004",
        cashbookAccountId: String(cashbook._id),
      },
      user,
    });

    const originalEntries = await FinancialLedgerEntry.find({
      business: company._id,
      sourceTransactionType: "tax_remittance",
      sourceTransactionId: String(remittance._id),
      status: "approved",
    }).lean();
    expect(originalEntries.length).toBe(2);

    const secondLegAccountId = originalEntries[1].accountId;
    await ChartOfAccount.deleteOne({ _id: secondLegAccountId });

    await expect(
      callController(voidRemittance, {
        params: { id: String(remittance._id) },
        body: { business: String(company._id), reason: "test void" },
        user,
      })
    ).rejects.toThrow();

    // The whole request failed, so the remittance itself must be untouched.
    const reloaded = await TaxRemittance.findById(remittance._id).lean();
    expect(reloaded.status).not.toBe("voided");

    // Neither original leg may be left half-reversed.
    const reloadedOriginalEntries = await FinancialLedgerEntry.find({
      business: company._id,
      sourceTransactionType: "tax_remittance",
      sourceTransactionId: String(remittance._id),
      category: { $ne: "REVERSAL" },
    }).lean();
    reloadedOriginalEntries.forEach((entry) => {
      expect(entry.status).toBe("approved");
      expect(entry.reversedByEntry).toBeFalsy();
    });

    // And no orphaned REVERSAL document may survive from the first leg's otherwise-successful insert.
    const reversalEntries = await FinancialLedgerEntry.find({
      business: company._id,
      category: "REVERSAL",
      reversalOf: originalEntries[0]._id,
    }).lean();
    expect(reversalEntries).toHaveLength(0);
  });
});
