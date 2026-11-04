// Regression tests for the Property Sale module's ghost-write fix: several functions in
// propertySaleAccountingService.js used to post or reverse multiple ledger legs per logical operation
// with either `Promise.all` (no rollback at all) or a catch-based manual-reversal loop (blind to a leg
// that ghost-writes — the insert commits on the server while the driver's write-acknowledgment is lost,
// so the `await postEntry(...)`/`await postReversal(...)` call itself still throws, with no reference to
// the written leg's _id for any catch block to clean up). Both patterns are now wrapped in one real Mongo
// transaction (withGLTransaction / postEntries' own internal transaction), so MongoDB itself rolls back
// every write made inside an aborted attempt. Uses the same deterministic-failure technique as
// controllers/propertyController/tenantInvoices.test.js: delete the ChartOfAccount a later leg targets so
// that leg's posting account check fails on every run.
import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { createTestCompany, createTestChartOfAccounts } from "../../../test/factories.js";
import FinancialLedgerEntry from "../../../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import {
  resolvePSAccount,
  postPropertySalePaymentLedger,
  postPropertySaleCommissionAccrual,
  reversePropertySaleCommissionAccrual,
} from "./propertySaleAccountingService.js";

const oid = () => new mongoose.Types.ObjectId();

describe("propertySaleAccountingService — transactional GL posting/reversal", () => {
  it("postPropertySalePaymentLedger leaves no leg behind when the second (credit) leg's account is missing", async () => {
    const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
    await createTestChartOfAccounts(company._id);
    const business = company._id;
    const userId = oid();

    // Pre-resolving (and so caching) the revenue account, then deleting its underlying
    // ChartOfAccount row directly, means postPropertySalePaymentLedger will still resolve a
    // (now-stale) cached id for it — postEntry's own account-existence check (no bypass) is what
    // throws deterministically on the credit leg, which under the fixed sequential-in-transaction
    // code runs AFTER the debit leg has already been inserted inside the same transaction.
    const creditAcc = await resolvePSAccount(business, "4410");
    await ChartOfAccount.deleteOne({ _id: creditAcc._id });

    const payment = {
      _id: oid(),
      paymentNumber: "PMT-ATOMIC-1",
      paymentType: "installment",
      amount: 10_000,
      paymentDate: new Date(),
    };

    await expect(
      postPropertySalePaymentLedger({ businessId: business, payment, userId })
    ).rejects.toThrow(/account/i);

    // Under the old `Promise.all([postEntry, postEntry])` code (no transaction, no rollback at
    // all), the debit leg — a real, valid account — would have been inserted and left behind the
    // moment the credit leg failed. Now: nothing from this failed attempt survives.
    const entries = await FinancialLedgerEntry.find({
      business,
      sourceTransactionType: "property_sale_payment",
      sourceTransactionId: String(payment._id),
    }).lean();
    expect(entries).toHaveLength(0);
  });

  it("reversePropertySaleCommissionAccrual leaves neither leg reversed when the second leg's reversal fails", async () => {
    const company = await createTestCompany({ modules: { propertySale: true, accounts: true } });
    await createTestChartOfAccounts(company._id);
    const business = company._id;
    const userId = oid();

    const commission = { _id: oid(), commissionNumber: "BC-ATOMIC-1", commissionAmount: 15_000, createdAt: new Date() };
    await postPropertySaleCommissionAccrual({ businessId: business, commission, userId });

    const originalEntries = await FinancialLedgerEntry.find({
      business,
      sourceTransactionType: "property_sale_commission",
      sourceTransactionId: String(commission._id),
      status: "approved",
    }).lean();
    expect(originalEntries).toHaveLength(2);

    // Force the SECOND leg's reversal to fail deterministically, after the first leg's reversal
    // would already have been created under the old Promise.all-with-no-rollback code — delete its
    // posting account outright, so postEntry's account-existence check (inside postReversal's own
    // re-post of the flipped-direction entry) throws.
    await ChartOfAccount.deleteOne({ _id: originalEntries[1].accountId });

    await expect(
      reversePropertySaleCommissionAccrual({ businessId: business, commission, userId })
    ).rejects.toThrow(/account/i);

    // Neither original leg may be left half-reversed.
    const reloaded = await FinancialLedgerEntry.find({
      business,
      sourceTransactionType: "property_sale_commission",
      sourceTransactionId: String(commission._id),
    }).lean();
    expect(reloaded).toHaveLength(2);
    reloaded.forEach((entry) => expect(entry.status).toBe("approved"));

    // And no orphaned REVERSAL entry may survive from the first leg's otherwise-successful insert.
    const reversalRows = await FinancialLedgerEntry.find({
      business,
      category: "REVERSAL",
      reversalOf: originalEntries[0]._id,
    }).lean();
    expect(reversalRows).toHaveLength(0);
  });
});
