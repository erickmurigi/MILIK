// Integration tests for controllers/propertyController/latePenalties.js.
// Focus: the batch-generation flow (overdue invoice -> penalty invoice created) and
// the batch-delete endpoint added earlier today.
import { describe, it, expect } from "vitest";
import { callController } from "../../test/callController.js";
import { createTestLease, createTestUser } from "../../test/factories.js";
import { createTestTenantInvoice, createTestLatePenaltyRule } from "../../test/factories.payments.js";
import TenantInvoice from "../../models/TenantInvoice.js";
import LatePenaltyBatch from "../../models/LatePenaltyBatch.js";
import { processLatePenalties, deleteLatePenaltiesBatch } from "./latePenalties.js";

describe("processLatePenalties — batch generation", () => {
  it("creates a LATE_PENALTY_CHARGE invoice for an eligible overdue rent invoice", async () => {
    const { tenant, unit, property, company, landlord } = await createTestLease({});
    const user = await createTestUser({ company });

    const rule = await createTestLatePenaltyRule({
      company,
      calculationType: "percentage_overdue_balance",
      rateOrAmount: 10, // 10% of outstanding balance
      graceDays: 0,
      minimumOverdueDays: 0,
    });

    // Overdue rent invoice — due 20 days before the run date, still pending.
    const runDate = new Date(2026, 2, 20);
    const dueDate = new Date(2026, 2, 1);
    const overdueInvoice = await createTestTenantInvoice({
      company, property, landlord, tenant, unit,
      category: "RENT_CHARGE", amount: 10000,
      invoiceDate: dueDate, dueDate, status: "pending",
    });

    const { statusCode, payload } = await callController(processLatePenalties, {
      user,
      body: { ruleId: String(rule._id), runDate },
    });

    expect(statusCode).toBe(201);
    expect(payload.summary.processedCount).toBe(1);
    expect(payload.summary.failedCount).toBe(0);
    expect(payload.summary.totalPenaltyAmount).toBe(1000); // 10% of 10000

    const penaltyInvoices = await TenantInvoice.find({
      business: company._id,
      category: "LATE_PENALTY_CHARGE",
    }).lean();

    expect(penaltyInvoices).toHaveLength(1);
    expect(penaltyInvoices[0].amount).toBe(1000);
    expect(String(penaltyInvoices[0].tenant)).toBe(String(tenant._id));
    expect(penaltyInvoices[0].metadata.penaltySourceInvoiceId).toBe(String(overdueInvoice._id));

    expect(payload.batch.items).toHaveLength(1);
    expect(payload.batch.items[0].status).toBe("processed");
    expect(payload.batch.status).toBe("processed");
  });

  it("skips invoices that are not yet overdue", async () => {
    const { tenant, unit, property, company, landlord } = await createTestLease({});
    const user = await createTestUser({ company });

    const rule = await createTestLatePenaltyRule({ company, rateOrAmount: 10 });

    const runDate = new Date(2026, 2, 20);
    // Due date is AFTER the run date — not overdue yet.
    const futureDueDate = new Date(2026, 3, 1);
    await createTestTenantInvoice({
      company, property, landlord, tenant, unit,
      category: "RENT_CHARGE", amount: 10000,
      invoiceDate: new Date(2026, 2, 1), dueDate: futureDueDate, status: "pending",
    });

    await expect(
      callController(processLatePenalties, {
        user,
        body: { ruleId: String(rule._id), runDate },
      })
    ).rejects.toThrow(/no eligible late penalty rows/i);

    const penaltyInvoices = await TenantInvoice.find({
      business: company._id,
      category: "LATE_PENALTY_CHARGE",
    }).lean();
    expect(penaltyInvoices).toHaveLength(0);
  });
});

describe("deleteLatePenaltiesBatch", () => {
  it("blocks deletion of a posted (on-ledger) penalty but deletes an item with no linked invoice, in one batch call", async () => {
    const { tenant, unit, property, company, landlord } = await createTestLease({});
    const user = await createTestUser({ company });

    const rule = await createTestLatePenaltyRule({ company, rateOrAmount: 10 });

    const runDate = new Date(2026, 2, 20);
    const dueDate = new Date(2026, 2, 1);
    const overdueInvoice = await createTestTenantInvoice({
      company, property, landlord, tenant, unit,
      category: "RENT_CHARGE", amount: 10000,
      invoiceDate: dueDate, dueDate, status: "pending",
    });

    // Real run — creates a genuine LATE_PENALTY_CHARGE invoice, which posts journal
    // entries. Per deleteLatePenaltiesBatch, an item linked to an invoice with journal
    // entries cannot be deleted directly — it must be reversed instead.
    const { payload: processedPayload } = await callController(processLatePenalties, {
      user,
      body: { ruleId: String(rule._id), runDate },
    });
    const postedItemId = String(processedPayload.batch.items[0]._id);
    const postedPenaltyInvoiceId =
      processedPayload.batch.items[0].penaltyInvoice?._id || processedPayload.batch.items[0].penaltyInvoice;

    // A second, synthetic batch item modelling a penalty-invoice creation attempt that
    // never produced a linked invoice (e.g. it failed) — deleteLatePenaltiesBatch can
    // clean this up directly since there is no journal entry to protect.
    const syntheticBatch = await LatePenaltyBatch.create({
      business: company._id,
      batchName: "Synthetic failed batch",
      rule: rule._id,
      ruleName: rule.ruleName,
      runDate,
      periodKey: "2026-03",
      status: "failed",
      items: [
        {
          sourceInvoice: overdueInvoice._id,
          sourceInvoiceNumber: overdueInvoice.invoiceNumber,
          tenant: tenant._id,
          property: property._id,
          unit: unit._id,
          dueDate,
          overdueDays: 19,
          outstandingBalance: 10000,
          calculatedPenalty: 500,
          penaltyInvoice: null,
          invoiced: false,
          status: "failed",
          reason: "Simulated invoice-creation failure",
        },
      ],
    });
    const failedItemId = String(syntheticBatch.items[0]._id);

    const { statusCode, payload } = await callController(deleteLatePenaltiesBatch, {
      user,
      body: {
        itemIds: [failedItemId, postedItemId],
        reason: "Test cleanup",
      },
    });

    expect(statusCode).toBe(200);
    expect(payload.results).toHaveLength(2);

    const deletedResult = payload.results.find((r) => r.itemId === failedItemId);
    const blockedResult = payload.results.find((r) => r.itemId === postedItemId);

    expect(deletedResult.status).toBe("deleted");
    expect(blockedResult.status).toBe("failed");
    expect(blockedResult.message).toMatch(/journal entry/i);

    // The item with no linked invoice is marked deleted on its batch...
    const refreshedSyntheticBatch = await LatePenaltyBatch.findById(syntheticBatch._id).lean();
    expect(refreshedSyntheticBatch.items[0].isDeleted).toBe(true);
    expect(refreshedSyntheticBatch.items[0].status).toBe("deleted");

    // ...while the genuinely posted penalty invoice remains untouched (deletion blocked).
    const stillExists = await TenantInvoice.findById(postedPenaltyInvoiceId).lean();
    expect(stillExists).not.toBeNull();
  }, 60000);
});
