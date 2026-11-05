// Company data reset: the backup must come first, the wipe removes only the target company's records,
// "transactions" keeps master data with zeroed balances, and filed data needs an explicit override.
import { beforeAll, describe, it, expect } from "vitest";
import { Writable } from "stream";
import zlib from "zlib";
import { callController } from "../test/callController.js";
import { createTestLease, createTestUser, createTestChartOfAccounts } from "../test/factories.js";
import { createTestTenantInvoice } from "../test/factories.payments.js";
import { createPayment } from "../controllers/propertyController/rentPayment.js";
import {
  findUnclassifiedModels,
  loadAllModels,
  previewCompanyReset,
  streamCompanyExport,
  startCompanyReset,
} from "./companyDataResetService.js";
import Company from "../models/Company.js";
import CompanyDataReset from "../models/CompanyDataReset.js";
import Tenant from "../models/Tenant.js";
import Property from "../models/Property.js";
import TenantInvoice from "../models/TenantInvoice.js";
import RentPayment from "../models/RentPayment.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import SequenceCounter from "../models/SequenceCounter.js";
import AccountingPeriod from "../models/AccountingPeriod.js";
import AuditLog from "../models/AuditLog.js";

const seedCompany = async () => {
  const lease = await createTestLease({});
  const { tenant, unit, property, company, landlord } = lease;
  const user = await createTestUser({ company });
  const accounts = await createTestChartOfAccounts(company._id);
  const chartAccount = accounts.find((a) => a.code === "1200") || accounts[0];
  await createTestTenantInvoice({
    company, property, landlord, tenant, unit, chartAccount, createdBy: user,
    category: "RENT_CHARGE", amount: 20000, invoiceDate: new Date(2026, 0, 1), dueDate: new Date(2026, 0, 5),
  });
  const receipt = await callController(createPayment, {
    user,
    body: {
      tenant: String(tenant._id), unit: String(unit._id), amount: 20000,
      referenceNumber: `RST-${Date.now()}-${Math.random()}`, cashbook: "Main Cashbook", paymentMethod: "mobile_money",
      paymentDate: new Date(2026, 0, 2), month: 1, year: 2026, isConfirmed: true,
    },
  });
  expect(receipt.statusCode).toBe(200);
  await SequenceCounter.create([
    { business: company._id, key: "tenant_code", sequence: 7 },
    { business: company._id, key: "invoice_test", sequence: 12 },
  ]);
  return { ...lease, user };
};

const fakeResponse = () => {
  const chunks = [];
  const res = new Writable({ write(chunk, _enc, cb) { chunks.push(chunk); cb(); } });
  res.headers = {};
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.body = () => JSON.parse(zlib.gunzipSync(Buffer.concat(chunks)).toString("utf8"));
  return res;
};

const admin = { id: "milik-admin", isSystemAdmin: true, email: "admin@test.local" };

const waitForJob = async (jobId) => {
  for (const deadline = Date.now() + 90000; Date.now() < deadline;) {
    const job = await CompanyDataReset.findById(jobId).lean();
    if (["completed", "failed"].includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("reset did not finish");
};

describe("company data reset", { timeout: 120000 }, () => {
  // registers every model file once; slow under the vitest transform
  beforeAll(() => loadAllModels(), 300000);

  it("has every company-scoped model classified", async () => {
    expect(await findUnclassifiedModels()).toEqual([]);
  });

  it("refuses to start without a backup, or with the wrong company name", async () => {
    const { company } = await seedCompany();
    await expect(startCompanyReset({ companyId: company._id, scope: "transactions", confirmName: "nope", user: admin }))
      .rejects.toMatchObject({ status: 400 });
    await expect(startCompanyReset({ companyId: company._id, scope: "transactions", confirmName: company.companyName, user: admin }))
      .rejects.toMatchObject({ status: 409 });
  });

  it("needs the override when the company has closed periods", async () => {
    const { company } = await seedCompany();
    await AccountingPeriod.create({
      business: company._id, name: "Jan 2026", startDate: new Date(2026, 0, 1), endDate: new Date(2026, 0, 31), status: "closed",
    });
    await streamCompanyExport({ companyId: company._id, scope: "transactions", user: admin, res: fakeResponse() });
    await expect(startCompanyReset({ companyId: company._id, scope: "transactions", confirmName: company.companyName, user: admin }))
      .rejects.toMatchObject({ status: 409 });
    const job = await startCompanyReset({ companyId: company._id, scope: "transactions", confirmName: company.companyName, overrideFiled: true, user: admin });
    expect((await waitForJob(job._id)).status).toBe("completed");
  });

  it("wipes transactions, keeps master data with zeroed balances, and leaves other companies alone", async () => {
    const target = await seedCompany();
    const other = await seedCompany();
    const { company } = target;
    await Tenant.updateOne({ _id: target.tenant._id }, { $set: { balance: 999, depositRefundStatus: "paid", depositRefundAmount: 500 } });

    const preview = await previewCompanyReset({ companyId: company._id, scope: "transactions" });
    expect(preview.totalRecords).toBeGreaterThan(0);
    expect(preview.steps.find((s) => s.model === "TenantInvoice").total).toBe(1);

    const res = fakeResponse();
    await streamCompanyExport({ companyId: company._id, scope: "transactions", user: admin, res });
    const backup = res.body();
    expect(backup.collections.TenantInvoice).toHaveLength(1);
    expect(backup.collections.Tenant).toHaveLength(1);
    expect(backup.collections.User).toBeUndefined();

    const job = await startCompanyReset({ companyId: company._id, scope: "transactions", confirmName: company.companyName, user: admin });
    expect((await Company.findById(company._id).lean()).locked).toBe(true);
    const done = await waitForJob(job._id);
    expect(done.status).toBe("completed");

    expect(await TenantInvoice.countDocuments({ business: company._id })).toBe(0);
    expect(await RentPayment.countDocuments({ business: company._id })).toBe(0);
    expect(await FinancialLedgerEntry.countDocuments({ business: company._id })).toBe(0);
    expect(await ChartOfAccount.countDocuments({ business: company._id, balance: { $ne: 0 } })).toBe(0);
    expect(await ChartOfAccount.countDocuments({ business: company._id })).toBeGreaterThan(0);

    const tenant = await Tenant.findById(target.tenant._id).lean();
    expect(tenant).toMatchObject({ balance: 0, depositRefundStatus: "not_applicable", depositRefundAmount: 0 });
    expect(await Property.countDocuments({ business: company._id })).toBe(1);

    const counters = await SequenceCounter.find({ business: company._id }).lean();
    expect(counters.map((c) => c.key)).toEqual(["tenant_code"]);

    expect(await TenantInvoice.countDocuments({ business: other.company._id })).toBe(1);
    expect(await FinancialLedgerEntry.countDocuments({ business: other.company._id })).toBeGreaterThan(0);

    expect((await Company.findById(company._id).lean()).locked).toBe(false);
    const actions = (await AuditLog.find({ company: company._id }).lean()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["company.data_reset_started", "company.data_reset_completed"]));
  });

  it("scope all removes master records but keeps setup", async () => {
    const { company } = await seedCompany();
    await streamCompanyExport({ companyId: company._id, scope: "all", user: admin, res: fakeResponse() });
    const job = await startCompanyReset({ companyId: company._id, scope: "all", confirmName: company.companyName, user: admin });
    expect((await waitForJob(job._id)).status).toBe("completed");

    expect(await Tenant.countDocuments({ business: company._id })).toBe(0);
    expect(await Property.countDocuments({ business: company._id })).toBe(0);
    expect(await SequenceCounter.countDocuments({ business: company._id })).toBe(0);
    expect(await ChartOfAccount.countDocuments({ business: company._id, property: null })).toBeGreaterThan(0);
    expect(await ChartOfAccount.countDocuments({ business: company._id, property: { $ne: null } })).toBe(0);
  });
});
