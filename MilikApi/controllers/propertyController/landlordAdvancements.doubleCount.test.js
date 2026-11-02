// Investigates a suspected double-count: processLandlordAdvancementRecovery posts a DIRECT debit
// to the Landlord Remittance Payable account (2110) for the recovery amount, tagged
// metadata.statementBucket: "advance_recovery" / includeInLandlordStatement: true. Separately,
// landlordStatementService.js's netRemittance formula ALSO subtracts advanceRecoveriesTotal — which
// it computes by scanning for that exact same statementBucket tag (see getAdjustmentEntries /
// isAdvanceRecovery around line 3561). If both fire for the same recovery, the company's true
// payable would be understated by the recovery amount a second time.
import { describe, it, expect } from "vitest";
import { callController } from "../../test/callController.js";
import { createTestLease, createTestUser, createTestChartOfAccounts } from "../../test/factories.js";
import { createTestInvoice, createTestReceipt } from "../../test/factories.landlord.js";
import { createLandlordAdvancement, processLandlordAdvancementRecovery } from "./landlordAdvancements.js";
import { generateLandlordStatement } from "../../services/landlordStatementService.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";

describe("landlord advance recovery vs statement netAmountDue — double-count check", () => {
  it("does not subtract the same recovery from both the direct 2110 debit and the statement's netAmountDue", async () => {
    const leaseBundle = await createTestLease({ rentAmount: 100000 });
    const { property, landlord, company } = leaseBundle;
    await createTestChartOfAccounts(company._id);
    const user = await createTestUser({ company });

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const invoiceDate = periodStart;
    const paymentDate = new Date(periodStart.getTime() + 60 * 1000);

    // Full rent collected by the manager this period.
    const invoiceBundle = await createTestInvoice({
      leaseBundle, category: "RENT_CHARGE", amount: 100000, invoiceDate,
      dueDate: new Date(periodStart.getTime() + 7 * 24 * 60 * 60 * 1000),
    });
    await createTestReceipt({ invoiceBundle, amount: 100000, paymentDate, allocate: true });

    // Disburse a 20,000 future-recoverable advance, then recover it fully in this same period.
    const createRes = await callController(createLandlordAdvancement, {
      user,
      body: {
        landlord: String(landlord._id), property: String(property._id),
        advanceType: "future_recoverable", amount: 20000,
        disbursementDate: periodStart, startDate: periodStart,
        status: "disbursed", frequency: "monthly", dayOfMonth: 5,
        paymentMethod: "bank_transfer",
      },
    });
    expect(createRes.statusCode).toBe(201);
    const advanceId = createRes.payload._id;

    const recoverRes = await callController(processLandlordAdvancementRecovery, {
      user,
      params: { id: advanceId },
      body: { amount: 20000, processedAt: paymentDate },
    });
    expect(recoverRes.statusCode).toBe(200);

    const remittanceAccount = await ChartOfAccount.findOne({
      business: company._id, name: { $regex: "landlord remittance", $options: "i" },
    }).lean();
    const recoveryDebit = await FinancialLedgerEntry.findOne({
      business: company._id, accountId: remittanceAccount._id,
      "metadata.postingKind": "landlord_advancement_recovery",
    }).lean();
    expect(recoveryDebit).toBeTruthy();
    expect(recoveryDebit.debit).toBe(20000);

    const statement = await generateLandlordStatement({
      propertyId: String(property._id), landlordId: String(landlord._id),
      statementPeriodStart: periodStart, statementPeriodEnd: new Date(),
    });

    // The true remaining cash obligation: 100,000 collected minus the 20,000 already recovered
    // via the direct debit above = 80,000. If the statement ALSO subtracts advanceRecoveriesTotal
    // on top of that, amountPayableToLandlord will come out at 60,000 instead — proving the
    // double-count.
    console.log("DIAGNOSTIC — totalAdvanceRecoveries:", statement.metadata.summary.totalAdvanceRecoveries);
    console.log("DIAGNOSTIC — managerCollections:", statement.metadata.summary.managerCollections);
    console.log("DIAGNOSTIC — amountPayableToLandlord:", statement.metadata.summary.amountPayableToLandlord);
    expect(statement.metadata.summary.amountPayableToLandlord).toBe(80000);
  }, 60000);
});
