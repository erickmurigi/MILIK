// Billing run: turns due ClientBillingSchedule rows into client invoices.
//
// preview and run share buildBillingProposal, so what the preview shows is exactly what the run
// raises. Idempotency is per schedule row: run() moves each row scheduled -> invoicing with an atomic
// conditional update before building its invoice, so a row can be invoiced at most once even when
// the cron and a manual run overlap. A failed invoice puts its rows back to scheduled.
import mongoose from "mongoose";
import ClientBillingSchedule from "../models/ClientBillingSchedule.js";
import ClientBillingRun from "../models/ClientBillingRun.js";
import ClientContract from "../models/ClientContract.js";
import ClientInvoice from "../models/ClientInvoice.js";
import { round2 } from "../../../utils/math.js";
import { createError } from "../../../utils/error.js";
import { logAuditEvent } from "../../../utils/auditLogger.js";
import { emitToCompany } from "../../../utils/socketManager.js";
import { calculateLineAmounts, isoDay, toUTCDate } from "./clientLineMath.js";
import { getClientTaxContext, resolveClientLineTax } from "./clientTaxService.js";
import { syncContractSchedule } from "./clientScheduleService.js";
import { getClientBillingSettings } from "./clientContractService.js";
import { nextInvoiceNumberForSeries } from "./clientSequenceService.js";
import { postClientInvoice } from "./clientInvoicePostingService.js";
import { assertClientCreditOk } from "./clientCreditControlService.js";

const BILLABLE_CONTRACT_STATUSES = ["active", "pending_renewal", "terminated", "expired", "renewed"];
const SCHEDULE_SYNC_STATUSES = ["active", "pending_renewal", "suspended"];

const DAY_MS = 24 * 60 * 60 * 1000;

// period "YYYY-MM" bills everything due up to that month's end; asOf bills up to a specific day.
export const resolveBillingCutoff = ({ period = "", asOf = null } = {}) => {
  if (asOf) {
    const d = toUTCDate(asOf);
    if (!d) throw createError(400, "asOf must be a valid date");
    return { cutoff: d, period: isoDay(d).slice(0, 7) };
  }
  const key = String(period || "").trim() || isoDay(new Date()).slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) throw createError(400, "period must be YYYY-MM");
  const [y, m] = key.split("-").map(Number);
  return { cutoff: new Date(Date.UTC(y, m, 0)), period: key };
};

const contractScopeFilter = ({ business, scope, scopeId }) => {
  const filter = { business };
  if (scope === "client") {
    if (!mongoose.Types.ObjectId.isValid(String(scopeId || ""))) throw createError(400, "clientId is required for scope=client");
    filter.client = scopeId;
  } else if (scope === "contract") {
    if (!mongoose.Types.ObjectId.isValid(String(scopeId || ""))) throw createError(400, "contractId is required for scope=contract");
    filter._id = scopeId;
  } else if (scope === "auto_bill") {
    filter.autoBill = true;
  }
  return filter;
};

const describeRow = (row) => {
  const period = row.billingFrequency === "one_off" ? "" : ` (${isoDay(row.from)} to ${isoDay(row.to)})`;
  const prorated = row.prorationFactor && Math.abs(row.prorationFactor - 1) > 1e-6 ? " — prorated" : "";
  return `${row.itemName}${period}${prorated}`;
};

// One invoice line per schedule row, priced at today's tax codes.
const rowToInvoiceLine = (row, taxCtx, taxMode) => {
  const tax = resolveClientLineTax(taxCtx, row.taxCodeKey);
  const calc = calculateLineAmounts({ ...row, ...tax, taxMode });
  return {
    itemName: row.itemName,
    description: describeRow(row),
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    discountPercent: row.discountPercent,
    prorationFactor: row.prorationFactor ?? 1,
    taxable: tax.taxType === "vat",
    ...tax,
    amount: calc.netAmount,
    taxAmount: calc.taxAmount,
    totalAmount: calc.totalAmount,
    discountAmount: calc.discountAmount,
    servicePeriodStart: row.from,
    servicePeriodEnd: row.to,
    revenueRecognition: row.revenueRecognition,
    incomeAccount: row.incomeAccount || null,
    contract: row.contract,
    contractLineKey: row.lineKey,
    scheduleRow: row._id,
    scheduleKey: row.idempotencyKey,
  };
};

// Builds (but does not save) the invoices the due rows would produce.
export const buildBillingProposal = async ({ business, period = "", asOf = null, scope = "all", scopeId = null, groupBy = "client", issueDate = null, rows: givenRows = null, syncSchedules = true }) => {
  const { cutoff, period: periodKey } = resolveBillingCutoff({ period, asOf });
  const group = groupBy === "contract" ? "contract" : "client";
  const contractFilter = contractScopeFilter({ business, scope, scopeId });

  if (syncSchedules && !givenRows) {
    const toSync = await ClientContract.find({ ...contractFilter, status: { $in: SCHEDULE_SYNC_STATUSES } });
    const taxCtx = await getClientTaxContext(business);
    for (const contract of toSync) await syncContractSchedule({ contract, asOf: cutoff, taxCtx });
  }

  const contracts = await ClientContract.find({ ...contractFilter, status: { $in: BILLABLE_CONTRACT_STATUSES } })
    .select("_id client contractNumber currency taxMode paymentTermsDays poNumber version terms status")
    .lean();
  const contractById = new Map(contracts.map((c) => [String(c._id), c]));

  const rows = givenRows || (contracts.length
    ? await ClientBillingSchedule.find({
        business,
        contract: { $in: contracts.map((c) => c._id) },
        status: "scheduled",
        billingDate: { $lte: cutoff },
      }).sort({ billingDate: 1, lineKey: 1 }).lean()
    : []);

  const taxCtx = await getClientTaxContext(business);
  const groups = new Map();
  for (const row of rows) {
    const contract = contractById.get(String(row.contract));
    if (!contract) continue;
    // Never mix currencies or tax modes on one invoice.
    const key = group === "contract"
      ? String(row.contract)
      : `${row.client}|${contract.currency || "KES"}|${contract.taxMode || "exclusive"}`;
    if (!groups.has(key)) {
      groups.set(key, { client: row.client, contracts: new Map(), currency: contract.currency || "KES", taxMode: contract.taxMode || "exclusive", rows: [] });
    }
    const g = groups.get(key);
    g.contracts.set(String(contract._id), contract);
    g.rows.push(row);
  }

  const issue = toUTCDate(issueDate || new Date());
  const invoices = [...groups.values()].map((g) => {
    const contractsInGroup = [...g.contracts.values()];
    const single = contractsInGroup.length === 1 ? contractsInGroup[0] : null;
    const terms = Math.min(...contractsInGroup.map((c) => Number(c.paymentTermsDays ?? 30)));
    const lines = g.rows.map((row) => rowToInvoiceLine(row, taxCtx, g.taxMode));
    const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
    const taxAmount = round2(lines.reduce((s, l) => s + l.taxAmount, 0));
    const total = round2(lines.reduce((s, l) => s + l.totalAmount, 0));
    return {
      client: g.client,
      contract: single?._id || null,
      contractNumbers: contractsInGroup.map((c) => c.contractNumber),
      contractVersion: single?.version || null,
      poNumber: single?.poNumber || "",
      currency: g.currency,
      taxMode: g.taxMode,
      issueDate: issue,
      dueDate: new Date(issue.getTime() + terms * DAY_MS),
      periodStart: new Date(Math.min(...g.rows.map((r) => new Date(r.from).getTime()))),
      periodEnd: new Date(Math.max(...g.rows.map((r) => new Date(r.to).getTime()))),
      rowIds: g.rows.map((r) => r._id),
      lines,
      subtotal,
      taxAmount,
      total,
    };
  }).filter((inv) => inv.total > 0 || inv.lines.length);

  // Credit control: a client at "block" (credit hold, blacklisted, over a hard limit) is shown in the
  // preview and skipped by the run; "warn" is informational.
  for (const inv of invoices) {
    const check = await assertClientCreditOk(inv.client, { business, additionalAmount: inv.total });
    inv.creditCheck = { level: check.level, reasons: check.reasons || [] };
  }

  return {
    period: periodKey,
    cutoff,
    scope,
    groupBy: group,
    invoiceCount: invoices.length,
    rowCount: invoices.reduce((s, i) => s + i.rowIds.length, 0),
    subtotal: round2(invoices.reduce((s, i) => s + i.subtotal, 0)),
    taxAmount: round2(invoices.reduce((s, i) => s + i.taxAmount, 0)),
    total: round2(invoices.reduce((s, i) => s + i.total, 0)),
    invoices,
  };
};

const releaseRows = (rowIds, runId) =>
  ClientBillingSchedule.updateMany(
    { _id: { $in: rowIds }, status: "invoicing", billingRun: runId },
    { $set: { status: "scheduled", billingRun: null, claimedAt: null } }
  );

export const runBilling = async ({ business, period = "", asOf = null, scope = "all", scopeId = null, groupBy = "client", issueDate = null, userId = null, triggeredBy = "manual", postAsDraft = null, req = null }) => {
  const settings = await getClientBillingSettings(business);
  const asDraft = postAsDraft === null || postAsDraft === undefined ? Boolean(settings.billingRunPostsAsDraft) : Boolean(postAsDraft);
  const proposal = await buildBillingProposal({ business, period, asOf, scope, scopeId, groupBy, issueDate });

  const run = await ClientBillingRun.create({
    business,
    triggeredBy,
    runBy: userId,
    asOfDate: proposal.cutoff,
    issueDate: toUTCDate(issueDate || new Date()),
    period: proposal.period,
    scope,
    scopeId: scope === "client" || scope === "contract" ? scopeId : null,
    groupBy: proposal.groupBy,
    postAsDraft: asDraft,
  });

  const created = [];
  const failures = [];
  for (const planned of proposal.invoices) {
    if (planned.creditCheck?.level === "block") {
      failures.push({ client: planned.client, contract: planned.contract, kind: "credit_block", message: `Skipped by credit control: ${planned.creditCheck.reasons.join("; ")}` });
      continue;
    }
    // Claim the rows. Any row another run got to first simply drops out of this invoice.
    const claimedAt = new Date();
    await ClientBillingSchedule.updateMany(
      { _id: { $in: planned.rowIds }, status: "scheduled" },
      { $set: { status: "invoicing", billingRun: run._id, claimedAt } }
    );
    const claimedRows = await ClientBillingSchedule.find({ _id: { $in: planned.rowIds }, status: "invoicing", billingRun: run._id }).sort({ billingDate: 1, lineKey: 1 }).lean();
    if (!claimedRows.length) continue;

    let invoice = null;
    try {
      // Rebuild from exactly the claimed rows (identical to the preview unless rows were taken).
      const rebuilt = claimedRows.length === planned.rowIds.length
        ? planned
        : (await buildBillingProposal({ business, period, asOf, scope, scopeId, groupBy, issueDate, rows: claimedRows, syncSchedules: false })).invoices[0];

      invoice = new ClientInvoice({
        business,
        client: rebuilt.client,
        contract: rebuilt.contract,
        contractVersion: rebuilt.contractVersion,
        invoiceNumber: await nextInvoiceNumberForSeries(business, settings.invoicePrefix),
        series: String(settings.invoicePrefix || "CINV").toUpperCase(),
        poNumber: rebuilt.poNumber,
        currency: rebuilt.currency,
        taxCalculation: "line",
        taxMode: rebuilt.taxMode,
        issueDate: rebuilt.issueDate,
        dueDate: rebuilt.dueDate,
        periodStart: rebuilt.periodStart,
        periodEnd: rebuilt.periodEnd,
        lineItems: rebuilt.lines,
        terms: settings.invoiceTerms || "",
        notes: rebuilt.contractNumbers.length ? `Contract${rebuilt.contractNumbers.length > 1 ? "s" : ""}: ${rebuilt.contractNumbers.join(", ")}` : "",
        billingRun: run._id,
        createdBy: userId,
      });
      await invoice.save();
      if (!asDraft) await postClientInvoice({ invoice, userId, targetStatus: "posted" });

      await ClientBillingSchedule.updateMany(
        { _id: { $in: claimedRows.map((r) => r._id) }, status: "invoicing", billingRun: run._id },
        { $set: { status: "invoiced", invoice: invoice._id, invoiceNumber: invoice.invoiceNumber, statusChangedAt: new Date() } }
      );
      created.push(invoice);
    } catch (error) {
      if (invoice?._id && invoice.status === "draft") await ClientInvoice.deleteOne({ _id: invoice._id, status: "draft" }).catch(() => null);
      await releaseRows(claimedRows.map((r) => r._id), run._id);
      failures.push({ client: planned.client, contract: planned.contract, message: error.message });
    }
  }

  run.invoiceCount = created.length;
  run.rowCount = created.reduce((s, inv) => s + inv.lineItems.length, 0);
  run.subtotal = round2(created.reduce((s, inv) => s + inv.subtotal, 0));
  run.taxAmount = round2(created.reduce((s, inv) => s + inv.vatAmount, 0));
  run.total = round2(created.reduce((s, inv) => s + inv.total, 0));
  run.invoices = created.map((i) => i._id);
  run.failures = failures;
  const hardFailures = failures.filter((f) => f.kind !== "credit_block");
  run.status = hardFailures.length ? (created.length ? "completed_with_errors" : "failed") : "completed";
  run.completedAt = new Date();
  await run.save();

  await logAuditEvent({
    req, company: business, action: "client_billing.run", category: "finance",
    actor: req ? null : { name: triggeredBy === "cron" ? "System (billing cron)" : "System" },
    targetType: "ClientBillingRun", targetId: run._id, targetName: proposal.period,
    message: `Billing run ${proposal.period}: ${created.length} invoice(s), total ${run.total}${failures.length ? `, ${failures.length} failed` : ""}`,
    metadata: { scope, scopeId, groupBy: proposal.groupBy, postAsDraft: asDraft, failures },
  });
  if (created.length) emitToCompany(String(business), "clients:billing:completed", { runId: String(run._id), invoiceCount: created.length });
  return run;
};

// Cron entry point: auto-bill contracts for every company, as of today.
export const runAutoBillingForAllCompanies = async ({ asOf = new Date() } = {}) => {
  const businesses = await ClientContract.distinct("business", { autoBill: true, status: { $in: BILLABLE_CONTRACT_STATUSES } });
  const results = [];
  for (const business of businesses) {
    try {
      const run = await runBilling({ business, asOf, scope: "auto_bill", triggeredBy: "cron" });
      if (run.invoiceCount || run.failures.length) results.push({ business, invoices: run.invoiceCount, failures: run.failures.length });
    } catch (error) {
      results.push({ business, error: error.message });
    }
  }
  return results;
};
