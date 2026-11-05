// Company data reset: wipes a company's wrong or test data so it can start again, keeping the company,
// its users, settings and audit trail.
//
//   scope "transactions" — every transaction goes (invoices, receipts, vouchers, journals, the GL, payroll
//                          runs, sales, jobs…); master records (properties, units, landlords, tenants, leases,
//                          clients, contracts, employees, products…) and setup stay, with their cached
//                          balances zeroed.
//   scope "all"          — master records go too; only setup (chart of accounts, tax/billing/module settings,
//                          departments, services, categories…) stays.
//
// Every company-scoped model must be listed in MODEL_CLASSES. A model nobody classified blocks the reset
// rather than being silently skipped or deleted (see companyDataResetService.test.js).
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { once } from "events";
import mongoose from "mongoose";
import { fileURLToPath, pathToFileURL } from "url";
import Company from "../models/Company.js";
import CompanyDataReset from "../models/CompanyDataReset.js";
import { createError } from "../utils/error.js";
import { invalidateCompanyCache } from "../controllers/verifyToken.js";
import { logAuditEvent } from "../utils/auditLogger.js";

export const RESET_SCOPES = ["transactions", "all"];
// the backup must be this fresh when the reset starts
export const EXPORT_VALID_MS = 24 * 60 * 60 * 1000;

// [modelName, module, label]. Lists run in this order, so children go before the records they point to:
// a reset that stops part-way leaves no record pointing at one already deleted.
const TRANSACTIONS = [
  ["PaymentReferenceLock", "Finance", "Payment reference locks"],
  ["MpesaCollection", "Finance", "M-Pesa collections"],
  ["SmsLog", "Communication", "SMS log"],
  ["Notification", "Communication", "Notifications"],
  ["GLHealthRun", "Finance", "GL health runs"],
  ["LandlordStatementLine", "Property Management", "Landlord statement lines"],
  ["LandlordStatementTenantBalance", "Property Management", "Landlord statement balances"],
  ["LandlordStatement", "Property Management", "Landlord statements"],
  ["ProcessedStatement", "Property Management", "Processed statements"],
  ["TenantInvoiceNote", "Property Management", "Credit / debit notes"],
  ["LatePenaltyBatch", "Property Management", "Late penalty batches"],
  ["Receipt", "Property Management", "Receipt allocations"],
  ["RentPayment", "Property Management", "Receipts"],
  ["TenantInvoice", "Property Management", "Tenant invoices"],
  ["MeterReading", "Property Management", "Meter readings"],
  ["LandlordReceipt", "Property Management", "Landlord receipts"],
  ["LandlordAdvancement", "Property Management", "Landlord advances"],
  ["PaymentVoucher", "Finance", "Payment vouchers"],
  ["ExpenseProperty", "Property Management", "Property expenses"],
  ["Expense", "Finance", "Expenses"],
  ["ExpenseRequisition", "Finance", "Expense requisitions"],
  ["PettyCashDisbursement", "Finance", "Petty cash vouchers"],
  ["PettyCashReplenishment", "Finance", "Petty cash replenishments"],
  ["BankStatementLine", "Finance", "Bank statement lines"],
  ["BankReconciliation", "Finance", "Bank reconciliations"],
  ["TaxRemittance", "Finance", "Tax remittances"],
  ["CoopCollection", "Finance", "Co-op collections"],
  ["JournalEntry", "Finance", "Journals"],
  ["Inspection", "Property Management", "Inspections"],
  ["Maintenance", "Property Management", "Maintenance requests"],
  ["RentalListingLead", "Property Management", "Listing leads"],

  ["EtimsSubmission", "Contract Management", "eTIMS submissions"],
  ["ClientDunningLog", "Contract Management", "Reminder log"],
  ["ClientInvoiceFlag", "Contract Management", "Disputes"],
  ["ClientPromiseToPay", "Contract Management", "Promises to pay"],
  ["ClientInteraction", "Contract Management", "Client interactions"],
  ["ClientWhtCertificate", "Contract Management", "WHT certificates"],
  ["ClientCreditRefund", "Contract Management", "Credit refunds"],
  ["ClientReceipt", "Contract Management", "Client receipts"],
  ["ClientPayment", "Contract Management", "Client payments"],
  ["ClientCreditNote", "Contract Management", "Client credit / debit notes"],
  ["ClientRevenueSchedule", "Contract Management", "Revenue schedules"],
  ["ClientInvoice", "Contract Management", "Client invoices"],
  ["ClientBillingRun", "Contract Management", "Billing runs"],
  ["ClientBillingSchedule", "Contract Management", "Billing schedules"],
  ["ClientQuote", "Contract Management", "Quotes"],

  ["CarWashMpesaNotification", "Car Wash", "M-Pesa notifications"],
  ["CarWashAccountStatement", "Car Wash", "Account statements"],
  ["CarWashAccountTopup", "Car Wash", "Account top-ups"],
  ["CarWashCommissionPayout", "Car Wash", "Commission payouts"],
  ["CarWashStaffCommission", "Car Wash", "Staff commissions"],
  ["CarWashStaffDamage", "Car Wash", "Staff damages"],
  ["CarWashStaffSaving", "Car Wash", "Staff savings"],
  ["CarWashCustomerCredit", "Car Wash", "Customer credits"],
  ["CarWashDeposit", "Car Wash", "Deposits"],
  ["CarWashExpense", "Car Wash", "Expenses"],
  ["CarWashPayment", "Car Wash", "Payments"],
  ["CarWashLoyaltyCard", "Car Wash", "Loyalty cards"],
  ["CarWashJob", "Car Wash", "Jobs"],

  ["POSTillMovement", "Inventory", "Till movements"],
  ["POSSale", "Inventory", "POS sales"],
  ["POSSession", "Inventory", "POS sessions"],
  ["InvSupplierPayment", "Inventory", "Supplier payments"],
  ["InvStockTransfer", "Inventory", "Stock transfers"],
  ["InvStockEntry", "Inventory", "Stock entries"],
  ["InvPurchaseOrder", "Inventory", "Purchase orders"],

  ["HRPayslip", "HR", "Payslips"],
  ["HRPayrollPeriod", "HR", "Payroll periods"],
  ["HRAttendance", "HR", "Attendance"],
  ["HRLeaveApplication", "HR", "Leave applications"],
  ["HRLetter", "HR", "Letters"],
  ["HRAppraisal", "HR", "Appraisals"],
  ["HRAppraisalCycle", "HR", "Appraisal cycles"],

  ["SaleOwnerStatementLine", "Property Sale", "Owner statement lines"],
  ["SaleOwnerStatement", "Property Sale", "Owner statements"],
  ["SaleOwnerPayout", "Property Sale", "Owner payouts"],
  ["SaleOwnerCommission", "Property Sale", "Owner commissions"],
  ["SaleAgencyCommissionPayout", "Property Sale", "Agency commission payouts"],
  ["SaleAdvocateRechargeRemittance", "Property Sale", "Advocate remittances"],
  ["SaleCommission", "Property Sale", "Commissions"],
  ["SalePayment", "Property Sale", "Payments"],
  ["SalePaymentSchedule", "Property Sale", "Payment schedules"],
  ["SaleOffer", "Property Sale", "Offers"],
  ["SaleDeal", "Property Sale", "Deals"],
  ["SaleActivity", "Property Sale", "Activities"],
  ["SaleLead", "Property Sale", "Leads"],

  ["PropertyLedgerEntry", "Finance", "Property ledger"],
  ["FinancialLedgerEntry", "Finance", "General ledger entries"],
  ["AccountingPeriod", "Finance", "Accounting periods"],
];

const MASTERS = [
  ["LandlordStandingOrder", "Property Management", "Standing orders"],
  ["Lease", "Property Management", "Leases"],
  ["Tenant", "Property Management", "Tenants"],
  ["Unit", "Property Management", "Units"],
  ["Property", "Property Management", "Properties"],
  ["Landlord", "Property Management", "Landlords"],
  ["ServiceProvider", "Finance", "Service providers"],
  ["PettyCashAccount", "Finance", "Petty cash accounts"],
  ["FixedAsset", "Finance", "Fixed assets"],
  ["Budget", "Finance", "Budgets"],

  ["ClientContractVersion", "Contract Management", "Contract versions"],
  ["ClientContract", "Contract Management", "Contracts"],
  ["Client", "Contract Management", "Clients"],

  ["CarWashCreditAccount", "Car Wash", "Credit accounts"],
  ["CarWashCustomer", "Car Wash", "Customers"],
  ["CarWashStaff", "Car Wash", "Staff"],

  ["InvProduct", "Inventory", "Products"],
  ["InvSupplier", "Inventory", "Suppliers"],
  ["InvTill", "Inventory", "Tills"],

  ["HREmployee", "HR", "Employees"],

  ["SaleListing", "Property Sale", "Listings"],
  ["SaleProject", "Property Sale", "Projects"],
  ["SaleOwner", "Property Sale", "Owners"],
  ["SaleBuyer", "Property Sale", "Buyers"],
  ["SaleAgent", "Property Sale", "Agents"],
  ["SaleAdvocate", "Property Sale", "Advocates"],
];

// Never deleted. Included in the backup export.
const SETUP = [
  "ChartOfAccount", "CostCentre", "Zone", "LatePenaltyRule", "Printer", "Utility",
  "ClientCollectionSettings", "ClientEtimsSettings",
  "CarWashBranch", "CarWashService", "CarWashCommissionRule", "CarWashLoyaltyProgram", "CarWashExpenseCategoryConfig",
  "InvCategory", "InvLocation", "InvPaymentMethod", "InvPOSSettings", "InvTaxGroup", "InvUnitOfMeasure",
  "HRDepartment", "HRDesignation", "HRKpi", "HRLeaveType", "HRLetterTemplate", "HRPayComponent", "HRSignatory",
  "HRStatutoryConfig", "SaleSettings",
];

// Never deleted and never exported: the company itself, its people and logins, its settings (which hold
// credentials) and its audit trail.
const KEEP = ["Company", "CompanySettings", "User", "AuditLog", "PushToken", "TokenBlacklist", "TrialRequest", "CompanyDataReset"];

// Handled separately: numbering restarts, except the counters behind master-record codes kept by the scope.
const COUNTERS = "SequenceCounter";
const MASTER_COUNTER_KEYS = [/^tenant_code$/, /^clients_client_/, /^clients_contract_/, /^(adv|agt|byr|lst|own|prj)$/];

const MODEL_DIRS = ["models", "modules/carwash/models", "modules/clients/models", "modules/hr/models", "modules/inventory/models", "modules/propertySale/models"];
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let modelsLoaded = null;
// Registers every model, so a reset never misses a collection just because nothing imported it yet.
export const loadAllModels = () => {
  modelsLoaded ||= Promise.all(
    MODEL_DIRS.map((dir) => path.join(apiRoot, dir))
      .filter((abs) => fs.existsSync(abs))
      .flatMap((abs) => fs.readdirSync(abs)
        .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
        .map((file) => import(pathToFileURL(path.join(abs, file)).href)))
  );
  return modelsLoaded;
};

const scopeFieldOf = (Model) => (Model.schema.path("business") ? "business" : Model.schema.path("company") ? "company" : null);

// Company-scoped models nobody classified — they block the reset until someone decides what they are.
export const findUnclassifiedModels = async () => {
  await loadAllModels();
  const known = new Set([...TRANSACTIONS.map(([m]) => m), ...MASTERS.map(([m]) => m), ...SETUP, ...KEEP, COUNTERS]);
  return Object.values(mongoose.models)
    .filter((M) => !known.has(M.modelName) && scopeFieldOf(M))
    .map((M) => M.modelName)
    .sort();
};

const toStep = ([model, module, label]) => ({ model, module, label, action: "delete" });

export const buildResetSteps = (scope) => [
  ...TRANSACTIONS.map(toStep),
  ...(scope === "all" ? MASTERS.map(toStep) : []),
  { model: COUNTERS, module: "System", label: "Document numbering", action: "delete" },
  { model: "ChartOfAccount", module: "Finance", label: "Account balances", action: "reset" },
  ...(scope === "transactions"
    ? [
        { model: "Tenant", module: "Property Management", label: "Tenant balances and deposit refunds", action: "reset" },
        { model: "PettyCashAccount", module: "Finance", label: "Petty cash balances", action: "reset" },
        { model: "FixedAsset", module: "Finance", label: "Asset depreciation", action: "reset" },
        { model: "CarWashCreditAccount", module: "Car Wash", label: "Credit account balances", action: "reset" },
        { model: "CarWashCustomer", module: "Car Wash", label: "Customer totals", action: "reset" },
        { model: "ClientContract", module: "Contract Management", label: "Contract billing schedules rebuilt", action: "reset" },
      ]
    : []),
];

const assertScope = (scope) => {
  if (!RESET_SCOPES.includes(scope)) throw createError(400, `Scope must be one of: ${RESET_SCOPES.join(", ")}`);
};

const keptCounterFilter = (scope) =>
  scope === "transactions" ? { key: { $nin: MASTER_COUNTER_KEYS } } : {};

const companyFilter = (Model, companyId, extra = {}) => ({ [scopeFieldOf(Model)]: companyId, ...extra });

const resetFilter = (step, companyId, scope) => {
  const Model = mongoose.model(step.model);
  if (step.model === COUNTERS) return companyFilter(Model, companyId, keptCounterFilter(scope));
  return companyFilter(Model, companyId);
};

// What a reset would remove, plus anything that stops it.
export const previewCompanyReset = async ({ companyId, scope }) => {
  assertScope(scope);
  await loadAllModels();
  const company = await Company.findById(companyId).select("companyName locked isActive accountStatus").lean();
  if (!company) throw createError(404, "Company not found");

  const steps = buildResetSteps(scope);
  const totals = await Promise.all(
    steps.map((step) => mongoose.model(step.model).countDocuments(resetFilter(step, companyId, scope)))
  );
  const AccountingPeriod = mongoose.model("AccountingPeriod");
  const TaxRemittance = mongoose.model("TaxRemittance");
  const ChartOfAccount = mongoose.model("ChartOfAccount");
  const [masterTotals, propertyAccounts, closedPeriods, taxRemittances, unclassified, running] = await Promise.all([
    // what the company actually has, so the dialog talks about its records and not every module's
    Promise.all(MASTERS.map(([model]) => mongoose.model(model).countDocuments(companyFilter(mongoose.model(model), companyId)))),
    scope === "all" ? ChartOfAccount.countDocuments({ business: companyId, property: { $ne: null } }) : 0,
    AccountingPeriod.countDocuments({ business: companyId, status: { $in: ["closed", "locked"] } }),
    TaxRemittance.countDocuments({ business: companyId }),
    findUnclassifiedModels(),
    CompanyDataReset.findOne({ company: companyId, status: "running" }).select("_id").lean(),
  ]);

  return {
    company: { _id: companyId, companyName: company.companyName },
    scope,
    steps: steps.map((step, i) => ({
      ...step,
      label: step.model === "ChartOfAccount" && propertyAccounts ? "Account balances and property accounts" : step.label,
      total: totals[i],
    })),
    masters: MASTERS.map(([model, module, label], i) => ({ model, module, label, total: masterTotals[i] })).filter((m) => m.total),
    totalRecords: steps.reduce((sum, step, i) => sum + (step.action === "delete" ? totals[i] : 0), 0),
    filed: { closedPeriods, taxRemittances },
    unclassified,
    running: Boolean(running),
  };
};

const actorOf = (user = {}) => ({
  id: String(user.id || user._id || ""),
  name: [user.surname, user.otherNames].filter(Boolean).join(" ").trim() || user.name || "",
  email: user.email || "",
});

// Streams a gzipped JSON backup of every record the reset can touch, and marks the job ready once the
// whole file has been written. Settings, users and the audit trail are untouched by a reset, so they
// are not in it (settings hold credentials).
export const streamCompanyExport = async ({ companyId, scope, user, res }) => {
  assertScope(scope);
  await loadAllModels();
  const company = await Company.findById(companyId).select("companyName").lean();
  if (!company) throw createError(404, "Company not found");

  const job = await CompanyDataReset.create({
    company: companyId, companyName: company.companyName, scope, status: "exporting", requestedBy: actorOf(user),
  });

  // count first (in parallel) and read only the collections that hold something: a company uses a
  // handful of the ~150 record types, and reading each one in turn made small backups time out
  const candidates = [...TRANSACTIONS.map(([m]) => m), ...MASTERS.map(([m]) => m), ...SETUP, COUNTERS];
  const sizes = await Promise.all(candidates.map((name) => mongoose.model(name).countDocuments(companyFilter(mongoose.model(name), companyId))));
  const models = candidates.filter((_, i) => sizes[i] > 0);
  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = String(company.companyName || "company").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  res.setHeader("Content-Type", "application/gzip");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}-backup-${stamp}.json.gz"`);

  const gzip = zlib.createGzip();
  gzip.pipe(res);
  let bytes = 0;
  let pending = "";
  const closed = new Promise((resolve) => res.once("close", resolve));
  const flush = async () => {
    // the download was cancelled: stop reading, the job never becomes ready
    if (res.destroyed) throw new Error("download cancelled");
    if (!pending) return;
    const chunk = pending;
    pending = "";
    bytes += Buffer.byteLength(chunk);
    if (!gzip.write(chunk)) await Promise.race([once(gzip, "drain"), closed]);
  };
  // documents are buffered into ~256 KB chunks: one gzip write per document was most of the cost
  const write = async (text) => {
    pending += text;
    if (pending.length >= 256 * 1024) await flush();
  };

  const counts = {};
  try {
    await write(`{"format":"milik-company-backup","version":1,"company":${JSON.stringify({ _id: companyId, companyName: company.companyName })},"scope":${JSON.stringify(scope)},"exportedAt":${JSON.stringify(new Date())},"collections":{`);
    for (const [index, name] of models.entries()) {
      const Model = mongoose.model(name);
      await write(`${index ? "," : ""}${JSON.stringify(name)}:[`);
      let n = 0;
      for await (const doc of Model.find(companyFilter(Model, companyId)).lean().cursor({ batchSize: 500 })) {
        await write(`${n ? "," : ""}${JSON.stringify(doc)}`);
        n += 1;
      }
      await write("]");
      counts[name] = n;
    }
    await write("}}");
    await flush();
    await new Promise((resolve, reject) => {
      gzip.once("error", reject);
      res.once("finish", resolve);
      closed.then(() => (res.writableFinished ? resolve() : reject(new Error("download cancelled"))));
      gzip.end();
    });
    await CompanyDataReset.updateOne({ _id: job._id }, { $set: { status: "ready", exportedAt: new Date(), exportBytes: bytes, counts } });
  } catch (err) {
    await CompanyDataReset.updateOne({ _id: job._id }, { $set: { status: "failed", error: `Backup failed: ${err.message}` } });
    gzip.destroy(err);
    throw err;
  }
  return job._id;
};

const runStep = async (step, companyId, scope) => {
  const Model = mongoose.model(step.model);
  const where = companyFilter(Model, companyId);

  if (step.action === "delete") {
    const { deletedCount } = await Model.deleteMany(resetFilter(step, companyId, scope));
    return deletedCount;
  }

  switch (step.model) {
    case "ChartOfAccount": {
      let removed = 0;
      // property sub-accounts belong to properties that no longer exist
      if (scope === "all") removed = (await Model.deleteMany({ ...where, property: { $ne: null } })).deletedCount;
      const { modifiedCount } = await Model.updateMany({ ...where, balance: { $ne: 0 } }, { $set: { balance: 0 } });
      return removed + modifiedCount;
    }
    case "Tenant":
      return (await Model.updateMany({
        ...where,
        $or: [{ balance: { $ne: 0 } }, { depositRefundStatus: { $ne: "not_applicable" } }, { depositRefundAmount: { $ne: 0 } }, { "depositLandlordRefunds.0": { $exists: true } }],
      }, {
        $set: { balance: 0, depositRefundStatus: "not_applicable", depositRefundAmount: 0, depositRefundReference: "", depositLandlordRefunds: [] },
      })).modifiedCount;
    case "PettyCashAccount":
    case "CarWashCreditAccount":
      return (await Model.updateMany({ ...where, currentBalance: { $ne: 0 } }, { $set: { currentBalance: 0 } })).modifiedCount;
    case "FixedAsset":
      return (await Model.updateMany(
        { ...where, $or: [{ accumulatedDepreciation: { $ne: 0 } }, { lastDepreciationDate: { $ne: null } }] },
        { $set: { accumulatedDepreciation: 0, lastDepreciationDate: null } }
      )).modifiedCount;
    case "CarWashCustomer":
      return (await Model.updateMany({
        ...where,
        $or: [{ "stats.totalJobs": { $ne: 0 } }, { "stats.totalInvoiced": { $ne: 0 } }, { "stats.totalPaid": { $ne: 0 } }, { "stats.outstanding": { $ne: 0 } }, { "stats.lastVisit": { $ne: null } }],
      }, {
        $set: { "stats.totalJobs": 0, "stats.totalInvoiced": 0, "stats.totalPaid": 0, "stats.outstanding": 0, "stats.lastVisit": null },
      })).modifiedCount;
    case "ClientContract": {
      // invoices are gone, so each live contract's schedule is rebuilt and every period is billable again
      const [{ syncContractSchedule }, { getClientTaxContext }] = await Promise.all([
        import("../modules/clients/services/clientScheduleService.js"),
        import("../modules/clients/services/clientTaxService.js"),
      ]);
      // one tax lookup for the company, not one per contract
      const taxCtx = await getClientTaxContext(companyId);
      let synced = 0;
      for await (const contract of Model.find({ ...where, status: { $nin: ["draft", "pending_approval", "cancelled"] } }).cursor()) {
        await syncContractSchedule({ contract, taxCtx });
        synced += 1;
      }
      return synced;
    }
    default:
      throw new Error(`No reset defined for ${step.model}`);
  }
};

// Validates the request, locks the company and starts the reset in the background. Returns the job.
export const startCompanyReset = async ({ companyId, scope, confirmName, overrideFiled = false, user, req = null }) => {
  assertScope(scope);
  const preview = await previewCompanyReset({ companyId, scope });

  if (String(confirmName || "").trim() !== String(preview.company.companyName || "").trim()) {
    throw createError(400, "Type the company name exactly as shown to confirm");
  }
  if (preview.running) throw createError(409, "A reset is already running for this company");
  if (preview.unclassified.length) {
    throw createError(409, `Reset is unavailable: these record types are not classified yet: ${preview.unclassified.join(", ")}`);
  }
  const { closedPeriods, taxRemittances } = preview.filed;
  if ((closedPeriods || taxRemittances) && !overrideFiled) {
    throw createError(409, `This company has ${closedPeriods} closed accounting period(s) and ${taxRemittances} tax remittance(s). Confirm the override to reset filed data.`);
  }

  const job = await CompanyDataReset.findOne({
    company: companyId, scope, status: "ready", exportedAt: { $gte: new Date(Date.now() - EXPORT_VALID_MS) },
  }).sort({ exportedAt: -1 });
  if (!job) throw createError(409, "Download the backup first. It must be from the last 24 hours and for the same scope");

  const company = await Company.findById(companyId);
  // claim the job atomically so two clicks can't start two resets
  const claimed = await CompanyDataReset.findOneAndUpdate(
    { _id: job._id, status: "ready" },
    {
      $set: {
        status: "running",
        overrideFiled: Boolean(overrideFiled),
        requestedBy: actorOf(user),
        previousState: { locked: Boolean(company.locked), isActive: company.isActive !== false, accountStatus: company.accountStatus || "" },
        steps: preview.steps.map((s) => ({ ...s, done: 0, status: "pending" })),
        startedAt: new Date(),
        error: "",
      },
    },
    { new: true }
  );
  if (!claimed) throw createError(409, "This reset has already started");

  // nobody can sign in to the company while it is being reset
  company.locked = true;
  await company.save();
  invalidateCompanyCache(companyId);

  await logAuditEvent({
    req, company: companyId, action: "company.data_reset_started", category: "company", severity: "critical",
    targetType: "Company", targetId: companyId, targetName: preview.company.companyName,
    message: `Started ${scope === "all" ? "full" : "transactions"} data reset of ${preview.company.companyName} (${preview.totalRecords} records)`,
    metadata: { jobId: String(claimed._id), scope, totalRecords: preview.totalRecords, overrideFiled: Boolean(overrideFiled), filed: preview.filed },
  });

  setImmediate(() => {
    runCompanyReset(claimed._id, { actor: user }).catch((err) => console.error("Company data reset failed:", err));
  });
  return claimed.toObject();
};

// Runs every step in order. Safe to run again after a failure: finished steps find nothing left to do.
export const runCompanyReset = async (jobId, { actor = null } = {}) => {
  await loadAllModels();
  const job = await CompanyDataReset.findById(jobId);
  if (!job) throw new Error("Reset job not found");
  const companyId = job.company;

  try {
    // A company uses a handful of the ~100 record types. Steps that had records at preview run one by
    // one, in order, with progress; the rest are swept together at the end in case anything was added
    // since. A retry skips steps already done.
    const open = job.steps.map((step, i) => ({ step, i })).filter(({ step }) => step.status !== "done");
    const ordered = open.filter(({ step }) => step.total > 0);
    const empty = open.filter(({ step }) => !(step.total > 0));
    let finished = null; // previous step's progress goes out with the next step's start: one write per step
    for (const { step, i } of ordered) {
      await CompanyDataReset.updateOne({ _id: job._id }, { $set: { ...finished, [`steps.${i}.status`]: "running" } });
      const done = await runStep(step, companyId, job.scope);
      finished = { [`steps.${i}.status`]: "done", [`steps.${i}.done`]: done };
    }
    const swept = await Promise.all(empty.map(({ step }) => runStep(step, companyId, job.scope)));
    const sweptSet = Object.fromEntries(empty.flatMap(({ i }, k) => [[`steps.${i}.status`, "done"], [`steps.${i}.done`, swept[k]]]));
    const lastProgress = { ...finished, ...sweptSet };
    if (Object.keys(lastProgress).length) await CompanyDataReset.updateOne({ _id: job._id }, { $set: lastProgress });

    const { locked, isActive, accountStatus } = job.previousState || {};
    await Company.updateOne({ _id: companyId }, { $set: { locked: Boolean(locked), isActive: isActive !== false, accountStatus: accountStatus || "Active" } });
    invalidateCompanyCache(companyId);
    await CompanyDataReset.updateOne({ _id: job._id }, { $set: { status: "completed", finishedAt: new Date() } });
    await logAuditEvent({
      actor, company: companyId, action: "company.data_reset_completed", category: "company", severity: "critical",
      targetType: "Company", targetId: companyId, targetName: job.companyName,
      message: `Completed ${job.scope === "all" ? "full" : "transactions"} data reset of ${job.companyName}`,
      metadata: { jobId: String(job._id), scope: job.scope },
    });
  } catch (err) {
    // the company stays locked so nobody works on half-reset data; running the reset again finishes it
    await CompanyDataReset.updateOne({ _id: job._id }, { $set: { status: "failed", error: err.message, finishedAt: new Date() } });
    await logAuditEvent({
      actor, company: companyId, action: "company.data_reset_failed", category: "company", severity: "critical",
      targetType: "Company", targetId: companyId, targetName: job.companyName,
      message: `Data reset of ${job.companyName} failed: ${err.message}`,
      metadata: { jobId: String(job._id), scope: job.scope },
    });
    throw err;
  }
};

// Restarts a failed reset from where it stopped. Needs no new backup: the original one still covers it.
export const retryCompanyReset = async ({ companyId, jobId, user }) => {
  const job = await CompanyDataReset.findOneAndUpdate(
    { _id: jobId, company: companyId, status: "failed", startedAt: { $ne: null } },
    { $set: { status: "running", error: "", finishedAt: null } },
    { new: true }
  );
  if (!job) throw createError(404, "No failed reset to retry");
  setImmediate(() => {
    runCompanyReset(job._id, { actor: user }).catch((err) => console.error("Company data reset retry failed:", err));
  });
  return job.toObject();
};

export const latestCompanyReset = (companyId) =>
  CompanyDataReset.findOne({ company: companyId }).sort({ createdAt: -1 }).lean();
