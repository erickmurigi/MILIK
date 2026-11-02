// Closes the gap the earlier fork's landlordAdvancements.doubleCount.test.js left open: that test
// proved the STATEMENT'S OWN DISPLAYED figure (amountPayableToLandlord) is correctly net of a
// recovery in isolation, but didn't prove the COMBINED GL effect once that net figure is actually
// credited to 2110 on top of the recovery's own direct debit. This test drives that combined effect
// through the real statement-processing posting function (postCommissionAccrualForProcessedStatement,
// which both accrues commission AND credits the Landlord Remittance Payable for netAmountDue — see
// processedStatements.js) to read 2110's true final balance.
import { describe, it, expect } from "vitest";
import { callController } from "../../test/callController.js";
import { createTestLease, createTestUser, createTestChartOfAccounts } from "../../test/factories.js";
import { createTestInvoice, createTestReceipt, createTestProcessedStatement } from "../../test/factories.landlord.js";
import { createLandlordAdvancement, processLandlordAdvancementRecovery } from "./landlordAdvancements.js";
import { postCommissionAccrualForProcessedStatement } from "./processedStatements.js";
import { generateLandlordStatement } from "../../services/landlordStatementService.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";

describe("landlord advance recovery — combined GL effect through real statement processing", () => {
  it("2110's final balance should equal the true remaining cash obligation (rent collected minus recovery)", async () => {
    const leaseBundle = await createTestLease({ rentAmount: 100000 });
    const { property, landlord, company } = leaseBundle;
    await createTestChartOfAccounts(company._id);
    const user = await createTestUser({ company });

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const invoiceDate = periodStart;
    const paymentDate = new Date(periodStart.getTime() + 60 * 1000);

    const invoiceBundle = await createTestInvoice({
      leaseBundle, category: "RENT_CHARGE", amount: 100000, invoiceDate,
      dueDate: new Date(periodStart.getTime() + 7 * 24 * 60 * 60 * 1000),
    });
    await createTestReceipt({ invoiceBundle, amount: 100000, paymentDate, allocate: true });

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
      user, params: { id: advanceId }, body: { amount: 20000, processedAt: paymentDate },
    });
    expect(recoverRes.statusCode).toBe(200);

    // The recovery is processed against its OWN schedule-driven period (the advance's
    // dayOfMonth/frequency cycle), which does not necessarily equal the arbitrary
    // periodStart/"now" window this test otherwise uses for rent — read back the exact period
    // the recovery actually landed on so the processed statement below genuinely corresponds to
    // the same real-world period a live "close this statement" action would.
    const recoveryEntry = await FinancialLedgerEntry.findOne({
      business: company._id, "metadata.postingKind": "landlord_advancement_recovery",
    }).lean();
    expect(recoveryEntry).toBeTruthy();
    const recoveryPeriodStart = recoveryEntry.statementPeriodStart;
    const recoveryPeriodEnd = recoveryEntry.statementPeriodEnd;

    // Confirms the statement's own displayed figure is 80,000 (already net of the recovery) —
    // same result the earlier fork found.
    const generated = await generateLandlordStatement({
      propertyId: String(property._id), landlordId: String(landlord._id),
      statementPeriodStart: periodStart, statementPeriodEnd: new Date(),
    });
    expect(generated.metadata.summary.amountPayableToLandlord).toBe(80000);

    // Now actually POST that figure to the GL the way real statement processing does — dated to
    // the SAME period the recovery itself landed on (see above).
    const { statement } = await createTestProcessedStatement({
      company, landlord, property, periodStart: recoveryPeriodStart, periodEnd: recoveryPeriodEnd,
      netAmountDue: generated.metadata.summary.amountPayableToLandlord,
    });
    const approvedStatement = { _id: statement._id, statementNumber: "STMT-ADV-TEST-001" };
    await postCommissionAccrualForProcessedStatement({ processedStatement: statement, approvedStatement, userId: user.id });

    const remittanceAccount = await ChartOfAccount.findOne({
      business: company._id, name: { $regex: "landlord remittance", $options: "i" },
    }).lean();
    const entries = await FinancialLedgerEntry.find({
      business: company._id, accountId: remittanceAccount._id, status: { $in: ["approved", "reversed"] },
    }).lean();
    const net = entries.reduce((sum, e) => sum + Number(e.credit || 0) - Number(e.debit || 0), 0);

    console.log("DIAGNOSTIC — 2110 net balance after recovery + statement processing:", net);
    // True remaining cash obligation: 100,000 collected, minus the 20,000 already recovered.
    expect(net).toBe(80000);
  }, 60000);
});
