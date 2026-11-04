import { describe, it, expect } from "vitest";
import {
  createTenantInvoiceRecord,
  deleteTenantInvoice,
  getTakeOnBalances,
  createTenantInvoiceNote,
  getTenantInvoicesList,
  getTenantInvoiceById,
  getTenantInvoiceNotes,
} from "./tenantInvoices.js";
import { callController } from "../../test/callController.js";
import TenantInvoice from "../../models/TenantInvoice.js";
import TenantInvoiceNote from "../../models/TenantInvoiceNote.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import Unit from "../../models/Unit.js";
import {
  createTestChartOfAccounts,
  createTestCompanySettings,
  createTestLease,
  createTestUser,
} from "../../test/factories.js";

const enableTaxOnRent = (company) =>
  createTestCompanySettings({
    company,
    taxSettings: {
      enabled: true,
      defaultTaxMode: "exclusive",
      defaultTaxCodeKey: "vat_standard",
      defaultVatRate: 16,
      roundingPrecision: 2,
      outputVatAccountCode: "2140",
      invoiceTaxableByDefault: true,
      invoiceTaxabilityByCategory: { rent: true, utility: true, penalty: false, deposit: false },
    },
  });

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

  // Regression test for a real production bug found live in GLR: a batch booking run produced
  // two rent invoices for the same tenant/unit/period. The only caller that ever passed an
  // explicit idempotencyKey was the cron-triggered auto-invoicing job — manual single-invoice
  // creation and batch booking relied solely on findConflictingMonthlyInvoice, a read-then-write
  // check with no database backing, so two overlapping calls could both see "no conflict" before
  // either had saved. The fix derives the same kind of idempotencyKey for every caller (not just
  // cron) once the billing period is resolved, so the real unique {business, idempotencyKey} index
  // on TenantInvoice backs every code path. See createTenantInvoiceRecord for the fix.
  it("never creates two rent invoices for the same tenant/unit/period when booked concurrently with no explicit idempotencyKey", async () => {
    const { tenant, unit, property, company, landlord } = await createTestLease({ rentAmount: 15000 });
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
      description: "Rent — Feb 2026",
      invoiceDate: new Date(2026, 1, 1),
      dueDate: new Date(2026, 1, 5),
      // No idempotencyKey — this is the manual/batch-booking shape, not the cron shape.
    };

    // Indexes build asynchronously in the background after model registration — wait for them so
    // this test deterministically exercises the real unique index rather than racing its build.
    await TenantInvoice.init();

    // Simulate the real-world failure: two concurrent booking attempts for the same
    // tenant/unit/period (a batch booking run submitted twice, or a duplicate item within the
    // same batch), both racing the in-memory findConflictingMonthlyInvoice pre-check.
    const results = await Promise.allSettled([
      createTenantInvoiceRecord({ req, payload }),
      createTenantInvoiceRecord({ req, payload }),
    ]);

    const invoices = await TenantInvoice.find({
      business: company._id, tenant: tenant._id, unit: unit._id, category: "RENT_CHARGE",
    }).lean();
    expect(invoices).toHaveLength(1);
    expect(invoices[0].idempotencyKey).toBeTruthy();

    // At least one call must have succeeded — the system must never silently drop a booking,
    // only ever prevent it from being duplicated.
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
  }, 30000);
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

  // Regression test for a real production bug found live in GLR: deleting an invoice retried 7
  // times, each attempt throwing a 500 and leaving behind a new orphaned REVERSAL entry for the
  // same leg, while that leg itself was never actually marked reversed. Root cause: the reversal
  // loop posted each leg one at a time with no transaction — when a later leg's reversal failed,
  // the earlier leg's reversal entry (already inserted) had no way to be undone, so it survived
  // as a phantom credit/debit with nothing it was ever meant to balance against. Fixed by wrapping
  // the whole loop in one Mongo transaction (see deleteTenantInvoice), so any leg's failure rolls
  // back every write from that attempt, inserts included.
  it("rolls back every leg's reversal, leaving no orphaned entry, if a later leg's reversal fails mid-delete", async () => {
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
        amount: 9000,
        invoiceDate: new Date(),
        dueDate: new Date(),
      },
    });

    const originalEntries = await FinancialLedgerEntry.find({
      business: company._id,
      sourceTransactionType: "invoice",
      sourceTransactionId: String(invoice._id),
      status: "approved",
    }).lean();
    expect(originalEntries.length).toBeGreaterThanOrEqual(2);

    // Force the SECOND leg's reversal to fail deterministically, after the first leg's reversal
    // has already been created — by deleting its posting account outright, so postEntry's own
    // account-existence check throws (this check has no allowInactiveAccount bypass, unlike the
    // active/inactive check reversals otherwise skip).
    const secondLegAccountId = originalEntries[1].accountId;
    await ChartOfAccount.deleteOne({ _id: secondLegAccountId });

    await expect(
      callController(deleteTenantInvoice, { params: { id: String(invoice._id) }, user })
    ).rejects.toThrow();

    // The whole request failed, so the invoice itself must be untouched.
    const reloadedInvoice = await TenantInvoice.findById(invoice._id).lean();
    expect(reloadedInvoice.status).not.toBe("reversed");
    expect(reloadedInvoice.postingStatus).toBe("posted");

    // Neither original leg may be left half-reversed.
    const reloadedOriginalEntries = await FinancialLedgerEntry.find({
      business: company._id,
      sourceTransactionType: "invoice",
      sourceTransactionId: String(invoice._id),
      category: { $ne: "REVERSAL" },
    }).lean();
    reloadedOriginalEntries.forEach((entry) => {
      expect(entry.status).toBe("approved");
      expect(entry.reversedByEntry).toBeFalsy();
    });

    // And no orphaned REVERSAL document may survive from the first leg's otherwise-successful
    // insert — this is the exact shape of the bug seen live on INV01386.
    const reversalEntries = await FinancialLedgerEntry.find({
      business: company._id,
      category: "REVERSAL",
      reversalOf: originalEntries[0]._id,
    }).lean();
    expect(reversalEntries).toHaveLength(0);
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

describe("getTenantInvoiceById", () => {
  const buildInvoice = async () => {
    const { tenant, unit, property, company, landlord } = await createTestLease({});
    await createTestChartOfAccounts(company._id);
    const user = await createTestUser({ company });
    const invoice = await createTenantInvoiceRecord({
      req: { user, body: {} },
      payload: {
        business: String(company._id),
        property: String(property._id),
        landlord: String(landlord._id),
        tenant: String(tenant._id),
        unit: String(unit._id),
        category: "RENT_CHARGE",
        amount: 18000,
        invoiceDate: new Date(),
        dueDate: new Date(),
      },
    });
    return { invoice, user, company, tenant };
  };

  it("returns the single invoice with snapshot fields (outstanding / computedStatus)", async () => {
    const { invoice, user } = await buildInvoice();

    const { statusCode, payload } = await callController(getTenantInvoiceById, {
      params: { id: String(invoice._id) },
      user,
    });

    expect(statusCode).toBe(200);
    expect(String(payload._id)).toBe(String(invoice._id));
    expect(payload.invoiceNumber).toBe(invoice.invoiceNumber);
    expect(payload.outstanding).toBe(18000);
    expect(payload.appliedAmount).toBe(0);
    expect(Array.isArray(payload.receiptApplications)).toBe(true);
  });

  it("does not expose an invoice that belongs to another company", async () => {
    const { invoice } = await buildInvoice();
    const other = await createTestUser({});

    await expect(
      callController(getTenantInvoiceById, { params: { id: String(invoice._id) }, user: other })
    ).rejects.toThrow(/not found/i);
  });

  it("rejects a malformed id with a 400 instead of a 500", async () => {
    const { user } = await buildInvoice();

    await expect(
      callController(getTenantInvoiceById, { params: { id: "not-an-id" }, user })
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("getTenantInvoiceNotes — validation", () => {
  // Regression: createError was used without being imported, so this validation path
  // surfaced as a ReferenceError (HTTP 500) instead of a clean 400.
  it("returns a 400 when neither tenant nor business is supplied", async () => {
    const user = await createTestUser({});

    await expect(
      callController(getTenantInvoiceNotes, { query: {}, user })
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/tenant or business/i) });
  });

  it("does not return another company's notes when only ?tenant= is supplied", async () => {
    const { tenant, property, company } = await createTestLease({});
    await createTestChartOfAccounts(company._id);
    const owner = await createTestUser({ company });
    await callController(createTenantInvoiceNote, {
      body: {
        noteType: "DEBIT_NOTE",
        tenantId: String(tenant._id),
        propertyId: String(property._id),
        category: "RENT_CHARGE",
        amount: 900,
        description: "Extra",
      },
      user: owner,
    });

    const ownerView = await callController(getTenantInvoiceNotes, { query: { tenant: String(tenant._id) }, user: owner });
    expect(ownerView.payload).toHaveLength(1);

    const outsider = await createTestUser({});
    const outsiderView = await callController(getTenantInvoiceNotes, { query: { tenant: String(tenant._id) }, user: outsider });
    expect(outsiderView.payload).toHaveLength(0);
  });
});

// postInvoiceJournal posts the receivable, income, and (when taxable) output VAT legs under
// one real transaction — found during a Tax Report accuracy audit that its manual catch-based
// rollback could never see a leg whose postEntry ghost-wrote (inserted successfully but the
// await still threw), permanently orphaning it. See postInvoiceJournal in tenantInvoices.js.
describe("createTenantInvoiceRecord — output VAT posting atomicity", () => {
  it("posts receivable, income, and output VAT legs for a taxable invoice", async () => {
    const { tenant, unit, property, company, landlord } = await createTestLease({ rentAmount: 10000 });
    await createTestChartOfAccounts(company._id);
    await enableTaxOnRent(company);
    const user = await createTestUser({ company });

    const invoice = await createTenantInvoiceRecord({
      req: { user, body: {} },
      payload: {
        business: String(company._id),
        property: String(property._id),
        landlord: String(landlord._id),
        tenant: String(tenant._id),
        unit: String(unit._id),
        category: "RENT_CHARGE",
        amount: 10000,
        description: "Rent charge",
        invoiceDate: new Date(),
        dueDate: new Date(),
      },
    });

    expect(invoice.taxSnapshot?.taxAmount).toBeGreaterThan(0);

    const entries = await FinancialLedgerEntry.find({
      sourceTransactionType: "invoice",
      sourceTransactionId: String(invoice._id),
    }).lean();
    expect(entries).toHaveLength(3);

    const vatLeg = entries.find((e) => e.metadata?.postingRole === "output_vat_payable");
    expect(vatLeg).toBeTruthy();
    expect(vatLeg.credit).toBeCloseTo(invoice.taxSnapshot.taxAmount, 2);
  });

  it("rolls back the receivable and income legs, leaving no orphaned entry, if the output VAT leg fails mid-post", async () => {
    const { tenant, unit, property, company, landlord } = await createTestLease({ rentAmount: 10000 });
    await createTestChartOfAccounts(company._id);
    await enableTaxOnRent(company);
    const user = await createTestUser({ company });

    // Force resolveOutputVatAccount to fail: remove its exact code match AND every account
    // whose name would otherwise satisfy its fallback regex (2141 "Withholding Tax Payable"
    // and 2170 "PAYE Tax Payable" both match /vat|tax payable/i too).
    await ChartOfAccount.deleteMany({
      business: company._id,
      $or: [{ code: "2140" }, { name: { $regex: "vat|tax payable", $options: "i" } }],
    });

    await expect(
      createTenantInvoiceRecord({
        req: { user, body: {} },
        payload: {
          business: String(company._id),
          property: String(property._id),
          landlord: String(landlord._id),
          tenant: String(tenant._id),
          unit: String(unit._id),
          category: "RENT_CHARGE",
          amount: 10000,
          description: "Rent charge",
          invoiceDate: new Date(),
          dueDate: new Date(),
        },
      })
    ).rejects.toThrow();

    // The invoice document itself is intentionally kept (marked postingStatus: "failed" by the
    // outer catch in createTenantInvoiceRecord) — what this test proves is that no GL entry
    // survives for it, i.e. the receivable + income legs that posted before the VAT leg failed
    // were rolled back, not left as an orphaned, unbalanced pair.
    const invoices = await TenantInvoice.find({ business: company._id, tenant: tenant._id, category: "RENT_CHARGE" }).lean();
    expect(invoices).toHaveLength(1);
    expect(invoices[0].postingStatus).toBe("failed");

    const entries = await FinancialLedgerEntry.find({
      sourceTransactionType: "invoice",
      sourceTransactionId: { $in: invoices.map((i) => String(i._id)) },
    }).lean();
    expect(entries).toHaveLength(0);
  });
});

// Regression coverage for unit-level rent VAT classification: a unit's own rentTaxSettings
// (see models/Unit.js) must override the company-wide invoiceTaxabilityByCategory.rent switch
// in both directions, and a never-configured unit must fall back to the company switch unchanged.
describe("createTenantInvoiceRecord — unit-level rent VAT override", () => {
  const makeInvoicePayload = ({ company, property, landlord, tenant, unit }) => ({
    business: String(company._id),
    property: String(property._id),
    landlord: String(landlord._id),
    tenant: String(tenant._id),
    unit: String(unit._id),
    category: "RENT_CHARGE",
    amount: 10000,
    description: "Rent charge",
    invoiceDate: new Date(),
    dueDate: new Date(),
  });

  it("taxes rent when the unit is explicitly enabled even though the company-wide rent switch is off", async () => {
    const { tenant, unit, property, company, landlord } = await createTestLease({ rentAmount: 10000 });
    await createTestChartOfAccounts(company._id);
    await createTestCompanySettings({
      company,
      taxSettings: {
        enabled: true,
        defaultTaxMode: "exclusive",
        defaultTaxCodeKey: "vat_standard",
        defaultVatRate: 16,
        roundingPrecision: 2,
        outputVatAccountCode: "2140",
        invoiceTaxableByDefault: false,
        invoiceTaxabilityByCategory: { rent: false, utility: false, penalty: false, deposit: false },
      },
    });
    await Unit.findByIdAndUpdate(unit._id, {
      rentTaxSettings: { enabled: true, taxCodeKey: "vat_standard", taxMode: "company_default", rateOverride: null },
    });
    const user = await createTestUser({ company });

    const invoice = await createTenantInvoiceRecord({
      req: { user, body: {} },
      payload: makeInvoicePayload({ company, property, landlord, tenant, unit }),
    });

    expect(invoice.taxSnapshot?.isTaxable).toBe(true);
    expect(invoice.taxSnapshot?.taxAmount).toBeGreaterThan(0);
  });

  it("exempts rent when the unit is explicitly disabled even though the company-wide rent switch is on", async () => {
    const { tenant, unit, property, company, landlord } = await createTestLease({ rentAmount: 10000 });
    await createTestChartOfAccounts(company._id);
    await enableTaxOnRent(company);
    await Unit.findByIdAndUpdate(unit._id, {
      rentTaxSettings: { enabled: false, taxCodeKey: "vat_standard", taxMode: "company_default", rateOverride: null },
    });
    const user = await createTestUser({ company });

    const invoice = await createTenantInvoiceRecord({
      req: { user, body: {} },
      payload: makeInvoicePayload({ company, property, landlord, tenant, unit }),
    });

    expect(invoice.taxSnapshot?.isTaxable).toBe(false);
    expect(Number(invoice.taxSnapshot?.taxAmount || 0)).toBe(0);
  });

  it("falls back to the company-wide rent switch unchanged when the unit has never been configured", async () => {
    const { tenant, unit, property, company, landlord } = await createTestLease({ rentAmount: 10000 });
    await createTestChartOfAccounts(company._id);
    await enableTaxOnRent(company);
    // No Unit.rentTaxSettings write at all — this is every pre-existing unit in production today.
    const user = await createTestUser({ company });

    const invoice = await createTenantInvoiceRecord({
      req: { user, body: {} },
      payload: makeInvoicePayload({ company, property, landlord, tenant, unit }),
    });

    expect(invoice.taxSnapshot?.isTaxable).toBe(true);
    expect(invoice.taxSnapshot?.taxAmount).toBeGreaterThan(0);
  });
});
