// "Deposit Applied" receipts — a tenant's already-held deposit is reclassified against
// a rent (or other) invoice instead of new cash arriving. No cashbook is touched; which
// account absorbs it depends on who actually holds the deposit (Tenant.depositHeldBy),
// resolved server-side, never trusted from the client.
import { describe, it, expect } from "vitest";
import { callController } from "../../test/callController.js";
import { createTestLease, createTestUser, createTestChartOfAccounts } from "../../test/factories.js";
import { createTestTenantInvoice } from "../../test/factories.payments.js";
import { createPayment } from "./rentPayment.js";
import Tenant from "../../models/Tenant.js";
import RentPayment from "../../models/RentPayment.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";

const collectDeposit = async ({ tenant, unit, property, company, landlord, chartAccount, invoiceAuthor, user, amount = 15000 }) => {
  const depositInvoice = await createTestTenantInvoice({
    company, property, landlord, tenant, unit, chartAccount, createdBy: invoiceAuthor,
    category: "DEPOSIT_CHARGE", amount, invoiceDate: new Date(2026, 0, 1), dueDate: new Date(2026, 0, 5),
  });
  const { statusCode } = await callController(createPayment, {
    user,
    body: {
      tenant: String(tenant._id), unit: String(unit._id), amount,
      referenceNumber: `DEP-REF-${Date.now()}-${Math.random()}`,
      cashbook: "Main Cashbook", paymentMethod: "mobile_money",
      paymentDate: new Date(2026, 0, 2), month: 1, year: 2026, isConfirmed: true,
    },
  });
  expect(statusCode).toBe(200);
  return depositInvoice;
};

describe("deposit_applied receipts", () => {
  it("Management-Company-held: debits the Tenant Deposit Payable account, not a cashbook, and clears the rent invoice", async () => {
    const { tenant, unit, property, company, landlord } = await createTestLease({});
    const user = await createTestUser({ company });
    const accounts = await createTestChartOfAccounts(company._id);
    const chartAccount = accounts.find((a) => a.code === "1200") || accounts[0];
    const invoiceAuthor = await createTestUser({ company });

    await collectDeposit({ tenant, unit, property, company, landlord, chartAccount, invoiceAuthor, user, amount: 15000 });

    const rentInvoice = await createTestTenantInvoice({
      company, property, landlord, tenant, unit, chartAccount, createdBy: invoiceAuthor,
      category: "RENT_CHARGE", amount: 12000, invoiceDate: new Date(2026, 1, 1), dueDate: new Date(2026, 1, 5),
    });

    const { statusCode, payload } = await callController(createPayment, {
      user,
      body: {
        tenant: String(tenant._id), unit: String(unit._id), amount: 12000,
        referenceNumber: `DEPAPP-REF-${Date.now()}`,
        paymentMethod: "deposit_applied",
        paymentDate: new Date(2026, 1, 3), month: 2, year: 2026, isConfirmed: true,
      },
    });

    expect(statusCode).toBe(200);
    expect(payload.paidDirectToLandlord).toBe(false);
    expect(payload.cashbook).toBe("");
    expect(payload.allocationSummary.rent).toBe(12000);

    const saved = await RentPayment.findById(payload._id).lean();
    expect(saved.postingStatus).toBe("posted");

    const depositAccount = await ChartOfAccount.findOne({ business: company._id, code: "2100" }).lean();
    expect(depositAccount).toBeTruthy();

    const entries = await FinancialLedgerEntry.find({ journalGroupId: saved.journalGroupId }).lean();
    const debitToDeposit = entries.find((e) => String(e.accountId) === String(depositAccount._id) && e.debit > 0);
    expect(debitToDeposit).toBeTruthy();
    expect(debitToDeposit.debit).toBe(12000);
  });

  it("Landlord-held: auto-sets paidDirectToLandlord and debits the Landlord Remittance Payable account", async () => {
    const { tenant, unit, property, company, landlord } = await createTestLease({});
    await Tenant.findByIdAndUpdate(tenant._id, { depositHeldBy: "Landlord" });
    const user = await createTestUser({ company });
    const accounts = await createTestChartOfAccounts(company._id);
    const chartAccount = accounts.find((a) => a.code === "1200") || accounts[0];
    const invoiceAuthor = await createTestUser({ company });

    await collectDeposit({ tenant, unit, property, company, landlord, chartAccount, invoiceAuthor, user, amount: 15000 });

    const rentInvoice = await createTestTenantInvoice({
      company, property, landlord, tenant, unit, chartAccount, createdBy: invoiceAuthor,
      category: "RENT_CHARGE", amount: 10000, invoiceDate: new Date(2026, 1, 1), dueDate: new Date(2026, 1, 5),
    });

    // Client does NOT send paidDirectToLandlord — the server must derive it from the tenant record.
    const { statusCode, payload } = await callController(createPayment, {
      user,
      body: {
        tenant: String(tenant._id), unit: String(unit._id), amount: 10000,
        referenceNumber: `DEPAPP-LL-REF-${Date.now()}`,
        paymentMethod: "deposit_applied",
        paymentDate: new Date(2026, 1, 3), month: 2, year: 2026, isConfirmed: true,
      },
    });

    expect(statusCode).toBe(200);
    expect(payload.paidDirectToLandlord).toBe(true);

    const saved = await RentPayment.findById(payload._id).lean();
    expect(saved.postingStatus).toBe("posted");

    const remittanceAccount = await ChartOfAccount.findOne({
      business: company._id,
      name: { $regex: "landlord remittance", $options: "i" },
    }).lean();
    expect(remittanceAccount).toBeTruthy();

    const entries = await FinancialLedgerEntry.find({ journalGroupId: saved.journalGroupId }).lean();
    const debitToRemittance = entries.find((e) => String(e.accountId) === String(remittanceAccount._id) && e.debit > 0);
    expect(debitToRemittance).toBeTruthy();
    expect(debitToRemittance.debit).toBe(10000);
  });

  it("rejects an amount larger than the deposit currently held", async () => {
    const { tenant, unit, property, company, landlord } = await createTestLease({});
    const user = await createTestUser({ company });
    const accounts = await createTestChartOfAccounts(company._id);
    const chartAccount = accounts.find((a) => a.code === "1200") || accounts[0];
    const invoiceAuthor = await createTestUser({ company });

    await collectDeposit({ tenant, unit, property, company, landlord, chartAccount, invoiceAuthor, user, amount: 5000 });

    await createTestTenantInvoice({
      company, property, landlord, tenant, unit, chartAccount, createdBy: invoiceAuthor,
      category: "RENT_CHARGE", amount: 12000, invoiceDate: new Date(2026, 1, 1), dueDate: new Date(2026, 1, 5),
    });

    await expect(callController(createPayment, {
      user,
      body: {
        tenant: String(tenant._id), unit: String(unit._id), amount: 12000,
        referenceNumber: `DEPAPP-OVER-${Date.now()}`,
        paymentMethod: "deposit_applied",
        paymentDate: new Date(2026, 1, 3), month: 2, year: 2026, isConfirmed: true,
      },
    })).rejects.toThrow(/only kes 5,000/i);
  });
});
