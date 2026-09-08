import { describe, it, expect } from "vitest";
import {
  createTenantInvoiceRecord,
  deleteTenantInvoice,
  getTakeOnBalances,
  createTenantInvoiceNote,
  getTenantInvoicesList,
} from "./tenantInvoices.js";
import { callController } from "../../test/callController.js";
import TenantInvoice from "../../models/TenantInvoice.js";
import TenantInvoiceNote from "../../models/TenantInvoiceNote.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import {
  createTestChartOfAccounts,
  createTestLease,
  createTestUser,
} from "../../test/factories.js";

// Builds a minimal req.user-bearing object usable both as `req` for
// createTenantInvoiceRecord (which reads req.user/req.body) and as the
// `user` param for callController.
const buildReqUser = (userDoc) => userDoc;

describe("createTenantInvoiceRecord — idempotency", () => {
  it("creating an invoice with the same idempotencyKey twice only creates one invoice", async () => {
    const { tenant, unit, property, company, landlord } = await createTestLease({});
    await createTestChartOfAccounts(company._id);
    const user = await createTestUser({ company });

    const req = { user, body: {} };
    const payload = {
      business: String(company._id),
      property: String(property._id),
      landlord: String(landlord._id),
      tenant: String(tenant._id),
      unit: String(unit._id),
      category: "RENT_CHARGE",
      amount: 15000,
      description: "Rent charge",
      invoiceDate: new Date(),
      dueDate: new Date(),
      idempotencyKey: "test-idem-key-001",
    };

    const first = await createTenantInvoiceRecord({ req, payload });
    const second = await createTenantInvoiceRecord({ req, payload });

    expect(String(first._id)).toBe(String(second._id));

    const invoices = await TenantInvoice.find({
      business: company._id,
      idempotencyKey: "test-idem-key-001",
    }).lean();
    expect(invoices).toHaveLength(1);
    expect(invoices[0].amount).toBe(15000);
  });
});

describe("deleteTenantInvoice — GL reversal", () => {
  it("reverses ledger entries and marks a posted, unpaid invoice as reversed", async () => {
    const { tenant, unit, property, company, landlord } = await createTestLease({});
    await createTestChartOfAccounts(company._id);
    const user = await createTestUser({ company });

    const req = { user, body: {} };
    const invoice = await createTenantInvoiceRecord({
      req,
      payload: {
        business: String(company._id),
        property: String(property._id),
        landlord: String(landlord._id),
        tenant: String(tenant._id),
        unit: String(unit._id),
        category: "RENT_CHARGE",
        amount: 12000,
        invoiceDate: new Date(),
        dueDate: new Date(),
      },
    });

    expect(invoice.postingStatus).toBe("posted");
    expect(invoice.ledgerEntries.length).toBeGreaterThan(0);

    const originalEntries = await FinancialLedgerEntry.find({
      business: company._id,
      sourceTransactionType: "invoice",
      sourceTransactionId: String(invoice._id),
      status: "approved",
    }).lean();
    expect(originalEntries.length).toBeGreaterThan(0);

    const { statusCode, payload } = await callController(deleteTenantInvoice, {
      params: { id: String(invoice._id) },
      user,
    });

    expect(statusCode).toBe(200);
    expect(payload.auditStatus).toBe("reversed");

    const reloaded = await TenantInvoice.findById(invoice._id).lean();
    expect(reloaded.status).toBe("reversed");
    expect(reloaded.postingStatus).toBe("reversed");

    // Every original approved entry must now be reversed (have a reversedByEntry),
    // and a matching REVERSAL entry should exist in the ledger.
    const reloadedOriginalEntries = await FinancialLedgerEntry.find({
      business: company._id,
      sourceTransactionType: "invoice",
      sourceTransactionId: String(invoice._id),
      category: { $ne: "REVERSAL" },
    }).lean();
    expect(reloadedOriginalEntries.length).toBeGreaterThan(0);
    reloadedOriginalEntries.forEach((entry) => {
      expect(entry.reversedByEntry).toBeTruthy();
    });

    const reversalEntries = await FinancialLedgerEntry.find({
      business: company._id,
      category: "REVERSAL",
    }).lean();
    expect(reversalEntries.length).toBeGreaterThan(0);
  });
});

describe("take-on balances", () => {
  it("an invoice created with isTakeOnBalance metadata is listed by getTakeOnBalances with correct outstanding", async () => {
    const { tenant, unit, property, company, landlord } = await createTestLease({});
    await createTestChartOfAccounts(company._id);
    const user = await createTestUser({ company });

    const req = { user, body: {} };
    const invoice = await createTenantInvoiceRecord({
      req,
      payload: {
        business: String(company._id),
        property: String(property._id),
        landlord: String(landlord._id),
        tenant: String(tenant._id),
        unit: String(unit._id),
        category: "RENT_CHARGE",
        amount: 8000,
        description: "Opening balance carried over",
        invoiceDate: new Date(),
        dueDate: new Date(),
        metadata: {
          isTakeOnBalance: true,
          sourceTransactionType: "tenant_take_on_balance",
        },
      },
    });

    expect(invoice.metadata.isTakeOnBalance).toBe(true);

    const { statusCode, payload } = await callController(getTakeOnBalances, {
      query: { tenant: String(tenant._id) },
      user,
    });

    expect(statusCode).toBe(200);
    expect(payload.success).toBe(true);
    const row = payload.data.find((r) => String(r.invoiceId) === String(invoice._id));
    expect(row).toBeTruthy();
    expect(row.amount).toBe(8000);
    expect(row.balance).toBe(8000);
    expect(row.status).toBe("unallocated");
    expect(row.canDelete).toBe(true);
  });
});

describe("debit notes", () => {
  it("creates a debit note against a posted invoice and it counts toward the tenant's outstanding balance", async () => {
    const { tenant, unit, property, company, landlord } = await createTestLease({});
    await createTestChartOfAccounts(company._id);
    const user = await createTestUser({ company });

    const req = { user, body: {} };
    const sourceInvoice = await createTenantInvoiceRecord({
      req,
      payload: {
        business: String(company._id),
        property: String(property._id),
        landlord: String(landlord._id),
        tenant: String(tenant._id),
        unit: String(unit._id),
        category: "RENT_CHARGE",
        amount: 15000,
        invoiceDate: new Date(),
        dueDate: new Date(),
      },
    });

    expect(sourceInvoice.postingStatus).toBe("posted");

    const { statusCode, payload } = await callController(createTenantInvoiceNote, {
      body: {
        noteType: "DEBIT_NOTE",
        sourceInvoiceId: String(sourceInvoice._id),
        tenantId: String(tenant._id),
        propertyId: String(property._id),
        category: "RENT_CHARGE",
        amount: 2500,
        description: "Additional charge",
      },
      user,
    });

    expect(statusCode).toBe(201);
    expect(payload.noteType).toBe("DEBIT_NOTE");
    expect(payload.debit).toBe(2500);

    const noteInDb = await TenantInvoiceNote.findOne({
      business: company._id,
      tenant: tenant._id,
      noteType: "DEBIT_NOTE",
    }).lean();
    expect(noteInDb).toBeTruthy();
    expect(noteInDb.amount).toBe(2500);
    expect(noteInDb.postingStatus).toBe("posted");
  });

  // Regression test: a tenant whose only charge is a standalone debit note (no regular
  // TenantInvoice — e.g. a brand-new customer whose first-ever charge is a one-off
  // connection/setup fee) never appeared as an open item on Add Receipt. Root cause: the
  // snapshot computation in getTenantInvoicesList was gated on `adjustedInvoices.length > 0`,
  // which is derived from the tenant's regular TenantInvoice records — zero for a tenant
  // with no invoices yet, so the whole snapshot+debit-note-append step was skipped.
  it("a standalone debit note (no source invoice, tenant has no regular invoices) still appears as an open item via includeSnapshots", async () => {
    const { tenant, property, company } = await createTestLease({});
    await createTestChartOfAccounts(company._id);
    const user = await createTestUser({ company });

    const tenantHasInvoices = await TenantInvoice.exists({ business: company._id, tenant: tenant._id });
    expect(tenantHasInvoices).toBeFalsy();

    const { statusCode: createStatus, payload: createdNote } = await callController(createTenantInvoiceNote, {
      body: {
        noteType: "DEBIT_NOTE",
        tenantId: String(tenant._id),
        propertyId: String(property._id),
        category: "UTILITY_CHARGE",
        amount: 15000,
        description: "CONNECTION FEE - WATER",
      },
      user,
    });

    expect(createStatus).toBe(201);
    expect(createdNote.noteType).toBe("DEBIT_NOTE");

    const { statusCode, payload } = await callController(getTenantInvoicesList, {
      query: { tenant: String(tenant._id), includeSnapshots: "1" },
      user,
    });

    expect(statusCode).toBe(200);
    const items = Array.isArray(payload) ? payload : payload?.data || [];
    const noteItem = items.find((item) => item.noteType === "DEBIT_NOTE");
    expect(noteItem).toBeTruthy();
    expect(noteItem.outstanding).toBe(15000);
  });
});
