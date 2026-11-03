// Integration tests for recording landlord payments against processed statements.
import { describe, it, expect } from "vitest";
import { callController } from "../../test/callController.js";
import {
  createTestCompany,
  createTestLandlord,
  createTestProperty,
  createTestUser,
} from "../../test/factories.js";
import { createTestProcessedStatement } from "../../test/factories.landlord.js";
import { payLandlord } from "./landlordPaymentController.js";
import { getProperty } from "./property.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import ProcessedStatement from "../../models/ProcessedStatement.js";
import PaymentVoucher from "../../models/PaymentVoucher.js";
import { ensureSystemChartOfAccounts } from "../../services/chartOfAccountsService.js";

describe("payLandlord", () => {
  it("reduces the statement balance and the landlord's PCTRL/remittable balance by the payment amount", async () => {
    // This test performs two full GL-posting payment cycles (chart-of-accounts bootstrap,
    // ledger entries, balance aggregation) — comfortably exceeds the default 30s test timeout.
    const company = await createTestCompany();
    const { landlord } = await createTestLandlord({ company });
    const { property } = await createTestProperty({ company, landlord });
    const { statement } = await createTestProcessedStatement({
      company,
      landlord,
      property,
      netAmountDue: 5000,
    });
    const user = await createTestUser({ company });

    const { statusCode, payload } = await callController(payLandlord, {
      user,
      body: {
        statementId: String(statement._id),
        amount: 2000,
        paymentMethod: "bank_transfer",
        referenceNumber: "PAY-001",
      },
    });

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.statement.amountPaid).toBe(2000);
    expect(payload.data.statement.balanceDue).toBe(3000);
    expect(payload.data.statement.status).toBe("part_paid");

    // Regression coverage for a real reported bug: the voucher used to be born "approved" (status)
    // and "landlord_other" (category), indistinguishable from a manual ad-hoc landlord expense and
    // requiring a separate, manual "mark as paid" step even though the payment had already fully
    // posted. It must come out of payLandlord already complete.
    expect(payload.data.voucher.status).toBe("paid");
    expect(payload.data.voucher.category).toBe("landlord_remittance");
    expect(payload.data.voucher.paymentMethod).toBe("bank_transfer");
    expect(String(payload.data.voucher.settlementAccount)).toBeTruthy();

    // The property's PCTRL (landlord remittance payable, account 2110) balance must
    // reflect the payable created (5000) minus the payment just recorded (2000) = 3000.
    const propView = await callController(getProperty, {
      user,
      params: { id: String(property._id) },
    });
    expect(propView.payload.data.pctrlBalance).toBe(3000);

    // Paying off the remaining balance should zero out both the statement and PCTRL.
    const second = await callController(payLandlord, {
      user,
      body: {
        statementId: String(statement._id),
        amount: 3000,
        paymentMethod: "bank_transfer",
        referenceNumber: "PAY-002",
      },
    });
    expect(second.payload.data.statement.balanceDue).toBe(0);
    expect(second.payload.data.statement.status).toBe("paid");

    const propViewAfterFull = await callController(getProperty, {
      user,
      params: { id: String(property._id) },
    });
    expect(propViewAfterFull.payload.data.pctrlBalance).toBe(0);
  }, 60000);

  it("rejects a payment amount exceeding the outstanding balance", async () => {
    const company = await createTestCompany();
    const { landlord } = await createTestLandlord({ company });
    const { property } = await createTestProperty({ company, landlord });
    const { statement } = await createTestProcessedStatement({
      company,
      landlord,
      property,
      netAmountDue: 1000,
    });
    const user = await createTestUser({ company });

    await expect(
      callController(payLandlord, {
        user,
        body: { statementId: String(statement._id), amount: 5000, paymentMethod: "cash" },
      })
    ).rejects.toThrow(/cannot exceed outstanding balance/);
  });

  it("rejects payment against a negative (recovery) statement", async () => {
    const company = await createTestCompany();
    const { landlord } = await createTestLandlord({ company });
    const { property } = await createTestProperty({ company, landlord });
    const { statement } = await createTestProcessedStatement({
      company,
      landlord,
      property,
      netAmountDue: 0,
      isNegativeStatement: true,
      amountPayableByLandlordToManager: 1500,
    });
    const user = await createTestUser({ company });

    await expect(
      callController(payLandlord, {
        user,
        body: { statementId: String(statement._id), amount: 500, paymentMethod: "cash" },
      })
    ).rejects.toThrow(/negative/);
  });

  // Regression test for a real bug: payLandlord used to write amountPaid/balanceDue/status to the
  // statement and save() BEFORE creating the voucher and posting its GL entries. If that posting
  // then failed partway, the catch block correctly rolled back the voucher and the GL leg already
  // posted — but the earlier save had already committed, leaving the statement permanently
  // reporting a payment that no voucher or ledger entry actually backed, with nothing to
  // self-correct it (the sync that recomputes these fields from live vouchers only ever runs on
  // this function's own success path). Forces a real GL posting failure (an inactive cashbook
  // account, which postEntry rejects) and asserts the statement comes out of it completely
  // unchanged, with no stray voucher left behind either.
  it("leaves the statement and voucher list untouched when GL posting fails partway through", async () => {
    const company = await createTestCompany();
    const { landlord } = await createTestLandlord({ company });
    const { property } = await createTestProperty({ company, landlord });
    const { statement } = await createTestProcessedStatement({
      company,
      landlord,
      property,
      netAmountDue: 5000,
    });
    const user = await createTestUser({ company });

    await ensureSystemChartOfAccounts(company._id);
    const cashbookAccount = await ChartOfAccount.findOne({ business: company._id, code: "1100" });
    cashbookAccount.isActive = false;
    await cashbookAccount.save();

    await expect(
      callController(payLandlord, {
        user,
        body: {
          statementId: String(statement._id),
          amount: 2000,
          paymentMethod: "cash",
          cashbook: "1100",
          referenceNumber: "PAY-FAIL-001",
        },
      })
    ).rejects.toThrow();

    const reloaded = await ProcessedStatement.findById(statement._id).lean();
    expect(reloaded.amountPaid).toBe(0);
    expect(reloaded.balanceDue).toBe(5000);
    expect(reloaded.status).not.toBe("paid");
    expect(reloaded.status).not.toBe("part_paid");

    const vouchers = await PaymentVoucher.find({ sourceProcessedStatement: statement._id }).lean();
    expect(vouchers).toHaveLength(0);
  }, 30000);
});
