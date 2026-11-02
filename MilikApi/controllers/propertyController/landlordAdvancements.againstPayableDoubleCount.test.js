// Same double-count class as landlordAdvancements.statementProcessing.test.js, but for the OTHER
// advance type: "against_payable". Unlike future_recoverable (recovery subtracted via
// advanceRecoveriesTotal), an against-payable disbursement is subtracted via earlyPayoutsTotal — see
// landlordAdvancements.js's postDisbursementIfMissing (statementBucket: "advance_payment",
// postingKind: "landlord_advance_against_payable") and landlordStatementService.js's netRemittance
// formula. Both advance types post their own real, immediate direct debit to 2110 AND get subtracted
// a second time from whatever netAmountDue the statement later credits — the same bug, two triggers.
// This test posts the "advance_payment"-tagged debit directly (mirroring exactly what
// postDisbursementIfMissing posts) rather than driving the full real-money "against payable" business
// flow (which requires an existing payable balance to draw against), since what's under test here is
// specifically whether postCommissionAccrualForProcessedStatement's gross-up query correctly captures
// this posting kind — the underlying redundant-subtraction mechanism is already proven identical to
// the future_recoverable case.
import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import { createTestLease, createTestUser, createTestChartOfAccounts } from "../../test/factories.js";
import { createTestProcessedStatement } from "../../test/factories.landlord.js";
import { postCommissionAccrualForProcessedStatement } from "./processedStatements.js";
import { postEntry } from "../../services/ledgerPostingService.js";
import { resolveLandlordRemittancePayableAccount } from "../../services/propertyAccountingService.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";

describe("against-payable advance disbursement — combined GL effect through statement processing", () => {
  it("does not double-subtract an against-payable advance already debited directly to 2110", async () => {
    const leaseBundle = await createTestLease({});
    const { property, landlord, company } = leaseBundle;
    await createTestChartOfAccounts(company._id);
    const user = await createTestUser({ company });

    const periodStart = new Date(2026, 1, 1);
    const periodEnd = new Date(2026, 1, 28, 23, 59, 59, 999);
    const disbursementDate = new Date(2026, 1, 10);

    const remittanceAccount = await resolveLandlordRemittancePayableAccount(company._id);

    // Mirrors postDisbursementIfMissing's against_payable branch exactly.
    await postEntry({
      business: company._id,
      property: property._id,
      landlord: landlord._id,
      sourceTransactionType: "advance",
      sourceTransactionId: String(new mongoose.Types.ObjectId()),
      transactionDate: disbursementDate,
      statementPeriodStart: disbursementDate,
      statementPeriodEnd: disbursementDate,
      category: "ADVANCE_TO_LANDLORD",
      amount: 15000,
      direction: "debit",
      accountId: remittanceAccount._id,
      payer: "manager",
      receiver: "landlord",
      notes: "Landlord advance against current payable",
      metadata: {
        advancementId: String(new mongoose.Types.ObjectId()),
        advanceType: "against_payable",
        includeInLandlordStatement: true,
        statementBucket: "advance_payment",
        postingKind: "landlord_advance_against_payable",
        alreadyPaidToLandlord: true,
      },
      createdBy: user.id,
      approvedBy: user.id,
      approvedAt: disbursementDate,
      status: "approved",
    });

    // netAmountDue as landlordStatementService.js would compute it: already net of the 15,000
    // early payout (90,000 gross rent minus the 15,000 already paid out early = 75,000).
    const { statement } = await createTestProcessedStatement({
      company, landlord, property, periodStart, periodEnd, netAmountDue: 75000,
    });
    const approvedStatement = { _id: statement._id, statementNumber: "STMT-AP-TEST-001" };
    await postCommissionAccrualForProcessedStatement({ processedStatement: statement, approvedStatement, userId: user.id });

    const entries = await FinancialLedgerEntry.find({
      business: company._id, accountId: remittanceAccount._id, status: { $in: ["approved", "reversed"] },
    }).lean();
    const net = entries.reduce((sum, e) => sum + Number(e.credit || 0) - Number(e.debit || 0), 0);

    // True remaining cash obligation: 90,000 collected minus the 15,000 already paid out early.
    expect(net).toBe(75000);
  }, 60000);
});
