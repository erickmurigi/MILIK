import mongoose from "mongoose";
import LatePenaltyRule from "../../models/LatePenaltyRule.js";
import LatePenaltyBatch from "../../models/LatePenaltyBatch.js";
import TenantInvoice from "../../models/TenantInvoice.js";
import Property from "../../models/Property.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import { createTenantInvoiceRecord, resolveActorUserId, computeTenantInvoiceSnapshots, computeTenantInvoiceSnapshotsBatch, recomputeTenantFinancialState } from "./tenantInvoices.js";
import { ensureSystemChartOfAccounts } from "../../services/chartOfAccountsService.js";
import { aggregateChartOfAccountBalances } from "../../services/chartAccountAggregationService.js";
import { getAccessibleCompanyIds } from "../../utils/permissionControl.js";
import { postReversal } from "../../services/ledgerPostingService.js";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const round2 = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const normalizeDate = (value, fallback = new Date()) => {
  const date = value ? new Date(value) : new Date(fallback);
  return Number.isNaN(date.getTime()) ? new Date(fallback) : date;
};

const startOfDay = (value) => {
  const d = normalizeDate(value);
  d.setHours(0, 0, 0, 0);
  return d;
};

const resolveBusinessId = (req) => {
  const requested = req.params?.businessId || req.body?.business || req.query?.business || null;
  const authenticated = req.user?.company?._id || req.user?.company || req.user?.businessId || null;

  if (req.user?.isSystemAdmin || req.user?.superAdminAccess) {
    return requested || authenticated || null;
  }

  const accessibleCompanies = getAccessibleCompanyIds(req.user || {});

  if (!requested) {
    return authenticated || accessibleCompanies[0] || null;
  }

  if (String(requested) === String(authenticated) || accessibleCompanies.includes(String(requested))) {
    return requested;
  }

  const error = new Error("Not authorized to access records for this company.");
  error.statusCode = 403;
  throw error;
};

const buildPeriodKey = (rule, runDate) => {
  const dt = normalizeDate(runDate);
  const frequency = String(rule?.repeatFrequency || "manual").toLowerCase();
  if (frequency === "monthly") {
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
  }
  return dt.toISOString().slice(0, 10);
};

const getPeriodWindow = (rule, runDate) => {
  const dt = normalizeDate(runDate);
  if (String(rule?.repeatFrequency || "manual").toLowerCase() === "monthly") {
    return {
      start: new Date(dt.getFullYear(), dt.getMonth(), 1, 0, 0, 0, 0),
      end: new Date(dt.getFullYear(), dt.getMonth() + 1, 0, 23, 59, 59, 999),
    };
  }
  return {
    start: startOfDay(dt),
    end: new Date(startOfDay(dt).getTime() + 24 * 60 * 60 * 1000 - 1),
  };
};

const getMonthKey = (value) => {
  const dt = normalizeDate(value);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
};

const formatPenaltyDescriptionPeriod = (value) => {
  const dt = normalizeDate(value);
  return `${dt.toLocaleString("en-US", { month: "short" })}/${String(dt.getFullYear()).slice(-2)}`;
};

const canonicalizeBillingPeriodKey = (value) => {
  const normalized = String(value || "monthly")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");

  if (!normalized) return "monthly";
  if (["monthly", "month", "1_month", "1m"].includes(normalized)) return "monthly";
  if (["quarterly", "quarter", "3_months", "3m"].includes(normalized)) return "quarterly";
  if (["semi_annual", "semiannual", "semi_annually", "biannual", "half_yearly", "6_months", "6m"].includes(normalized)) return "semi_annual";
  if (["annual", "annually", "yearly", "12_months", "12m"].includes(normalized)) return "annual";
  return normalized;
};

const resolveInvoiceCoverageWindow = (invoice = {}) => {
  const metadata = invoice?.metadata && typeof invoice.metadata === "object" ? invoice.metadata : {};
  const billingPeriodKey = canonicalizeBillingPeriodKey(metadata?.billingPeriodKey || metadata?.frequencyKey || metadata?.billingFrequency || "monthly");
  const invoiceDate = normalizeDate(invoice?.invoiceDate || new Date());
  const startCandidate = metadata?.periodStartDate || metadata?.periodFromDate || invoice?.invoiceDate || null;
  const endCandidate = metadata?.periodEndDate || metadata?.periodToDate || null;
  const start = startCandidate ? startOfDay(startCandidate) : startOfDay(invoiceDate);

  let end = null;
  if (endCandidate) {
    end = normalizeDate(endCandidate, start);
    end.setHours(23, 59, 59, 999);
  } else if (billingPeriodKey === "monthly") {
    end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999);
  } else {
    const dueDate = invoice?.dueDate ? normalizeDate(invoice.dueDate, start) : null;
    end = dueDate ? new Date(dueDate) : new Date(start);
    end.setHours(23, 59, 59, 999);
  }

  return { start, end, billingPeriodKey, periodKey: String(metadata?.periodKey || "").trim() };
};

const isInvoiceInCurrentPenaltyWindow = (invoice, runDate) => {
  const runAt = startOfDay(runDate);
  const invoiceWindow = resolveInvoiceCoverageWindow(invoice);
  return runAt >= invoiceWindow.start && runAt <= invoiceWindow.end;
};

const assertRuleCanRun = (rule, runDate) => {
  if (!rule?.active) {
    const error = new Error("This late penalty rule is inactive. Activate it before previewing or processing penalties.");
    error.statusCode = 400;
    throw error;
  }

  const runAt = startOfDay(runDate);
  const today = startOfDay(new Date());
  if (runAt.getTime() > today.getTime()) {
    const error = new Error("Late penalties cannot be previewed or processed with a future run date.");
    error.statusCode = 400;
    throw error;
  }

  const effectiveFrom = startOfDay(rule?.effectiveFrom || runAt);
  if (runAt.getTime() < effectiveFrom.getTime()) {
    const error = new Error("The selected run date is before this rule becomes effective.");
    error.statusCode = 400;
    throw error;
  }
};

const normalizeRuleAutomationFields = (payload = {}) => ({
  repeatFrequency: payload?.repeatFrequency || "manual",
  applyAutomatically: false,
});

const isInvoiceCategoryEligible = (invoice, rule, runDate) => {
  const category = String(invoice?.category || "").toUpperCase();
  const mode = String(rule?.penalizeItem || "outstanding_invoice_balance").toLowerCase();

  if (category === "LATE_PENALTY_CHARGE" || category === "DEPOSIT_CHARGE") return false;
  if (mode === "rent_only") return category === "RENT_CHARGE";
  if (mode === "current_period_rent_only") {
    return category === "RENT_CHARGE" && isInvoiceInCurrentPenaltyWindow(invoice, runDate);
  }
  if (mode === "current_period_bill_balance_only") {
    return isInvoiceInCurrentPenaltyWindow(invoice, runDate);
  }
  if (mode === "all_arrears" || mode === "outstanding_invoice_balance") {
    return category === "RENT_CHARGE" || category === "UTILITY_CHARGE";
  }
  return category === "RENT_CHARGE" || category === "UTILITY_CHARGE";
};

const calculatePenaltyAmount = ({ rule, outstandingBalance, overdueDays }) => {
  const balance = Number(outstandingBalance || 0);
  const calcType = String(rule?.calculationType || "percentage_overdue_balance").toLowerCase();
  const rateOrAmount = Number(rule?.rateOrAmount || 0);

  let value = 0;
  if (calcType === "flat_amount") value = rateOrAmount;
  else if (calcType === "percentage_overdue_balance") value = balance * (rateOrAmount / 100);
  else if (calcType === "daily_fixed_amount") value = overdueDays * rateOrAmount;
  else if (calcType === "daily_percentage") value = balance * (rateOrAmount / 100) * overdueDays;

  const maxCap = Number(rule?.maximumPenaltyCap || 0);
  if (maxCap > 0) value = Math.min(value, maxCap);
  return round2(value);
};

const getOutstandingBalance = async (invoice, asOfDate = null) => {
  const tenantId = invoice?.tenant?._id || invoice?.tenant;
  if (!invoice?.business || !tenantId || !invoice?._id) {
    return round2(Number(invoice?.amount || 0));
  }

  const { invoiceSnapshots } = await computeTenantInvoiceSnapshots({
    businessId: invoice.business,
    tenantId,
    asOfDate,
  });

  const snapshot = invoiceSnapshots.find((item) => String(item._id) === String(invoice._id));
  if (!snapshot) return round2(Number(invoice?.amount || 0));
  return round2(Number(snapshot.outstanding || 0));
};

const resolveExistingPenaltyItemStates = async ({ businessId, ruleId, periodKey }) => {
  const batches = await LatePenaltyBatch.find({
    business: businessId,
    rule: ruleId,
    periodKey,
  })
    .select("items.sourceInvoice items.invoiced items.isDeleted items.deletedAt items.reversedAt items.status")
    .lean();

  const stateMap = new Map();

  for (const batch of batches) {
    for (const item of Array.isArray(batch?.items) ? batch.items : []) {
      const sourceInvoiceId = String(item?.sourceInvoice || "");
      if (!sourceInvoiceId) continue;

      const existing = stateMap.get(sourceInvoiceId) || {
        invoiced: false,
        isDeleted: false,
        isReversed: false,
      };

      if (item?.invoiced) existing.invoiced = true;
      if (item?.isDeleted || String(item?.status || "").toLowerCase() === "deleted" || item?.deletedAt) {
        existing.isDeleted = true;
      }
      if (item?.reversedAt || String(item?.status || "").toLowerCase() === "reversed") {
        existing.isReversed = true;
      }

      stateMap.set(sourceInvoiceId, existing);
    }
  }

  return stateMap;
};

const buildCandidateRows = async ({ businessId, rule, runDate }) => {
  const runAt = startOfDay(runDate);
  assertRuleCanRun(rule, runAt);

  const invoices = await TenantInvoice.find({
    business: businessId,
    status: { $in: ["pending", "partially_paid"] },
    dueDate: { $lt: runAt },
    category: { $in: ["RENT_CHARGE", "UTILITY_CHARGE"] },
  })
    .populate("tenant", "name tenantCode")
    .populate("property", "propertyName propertyCode exemptFromLatePenalties")
    .populate("unit", "unitNumber")
    .sort({ dueDate: 1, createdAt: 1 })
    .lean();

  const periodKey = buildPeriodKey(rule, runDate);
  const existingPenaltyItemStates = await resolveExistingPenaltyItemStates({
    businessId,
    ruleId: rule._id,
    periodKey,
  });

  const tenantIds = [
    ...new Set(
      invoices
        .map((invoice) => String(invoice?.tenant?._id || invoice?.tenant || ""))
        .filter(Boolean)
    ),
  ];
  const snapshotMap = await computeTenantInvoiceSnapshotsBatch({
    businessId,
    tenantIds,
    asOfDate: runAt,
  });
  const outstandingByInvoiceId = new Map();
  snapshotMap.forEach(({ invoiceSnapshots = [] }) => {
    invoiceSnapshots.forEach((snapshot) => {
      outstandingByInvoiceId.set(String(snapshot._id), round2(Number(snapshot.outstanding || 0)));
    });
  });

  const duplicatePenaltyInvoices = invoices.length
    ? await TenantInvoice.find({
        business: businessId,
        category: "LATE_PENALTY_CHARGE",
        status: { $nin: ["cancelled", "reversed"] },
        "metadata.penaltyRuleId": String(rule._id),
        "metadata.penaltySourceInvoiceId": {
          $in: invoices.map((invoice) => String(invoice._id)),
        },
        "metadata.penaltyPeriodKey": periodKey,
      })
        .select("_id invoiceNumber amount metadata.penaltySourceInvoiceId")
        .lean()
    : [];
  const duplicatePenaltyInvoiceMap = new Map(
    duplicatePenaltyInvoices
      .map((invoice) => [String(invoice?.metadata?.penaltySourceInvoiceId || ""), invoice])
      .filter(([sourceInvoiceId]) => sourceInvoiceId)
  );

  const rows = [];

  for (const invoice of invoices) {
    const property = invoice?.property || {};
    const outstandingBalance = outstandingByInvoiceId.has(String(invoice._id))
      ? outstandingByInvoiceId.get(String(invoice._id))
      : await getOutstandingBalance(invoice, runAt);
    const dueDate = normalizeDate(invoice?.dueDate || invoice?.invoiceDate || runAt);
    const overdueDays = Math.max(0, Math.floor((runAt.getTime() - startOfDay(dueDate).getTime()) / (24 * 60 * 60 * 1000)));
    const afterGrace = Math.max(0, overdueDays - Number(rule?.graceDays || 0));

    let skippedReason = "";
    if (property?.exemptFromLatePenalties) skippedReason = "Property exempt from late penalties";
    else if (!isInvoiceCategoryEligible(invoice, rule, runDate)) skippedReason = "Invoice category not eligible for selected rule";
    else if (afterGrace < Number(rule?.minimumOverdueDays || 0)) skippedReason = "Minimum overdue days not reached";
    else if (outstandingBalance <= 0) skippedReason = "No outstanding balance";
    else if (outstandingBalance < Number(rule?.minimumBalance || 0)) skippedReason = "Below minimum balance filter";
    else if (Number(rule?.maximumBalance || 0) > 0 && outstandingBalance > Number(rule.maximumBalance)) skippedReason = "Above maximum balance filter";

    const existingPenaltyState = existingPenaltyItemStates.get(String(invoice._id));
    if (!skippedReason && existingPenaltyState?.isDeleted) {
      skippedReason = "Deleted late penalty already exists for this invoice and period";
    } else if (!skippedReason && existingPenaltyState?.isReversed) {
      skippedReason = "Reversed late penalty already exists for this invoice and period";
    } else if (!skippedReason && existingPenaltyState?.invoiced) {
      skippedReason = "Late penalty already invoiced for this invoice and period";
    }

    let duplicatePenaltyInvoice = null;
    if (!skippedReason) {
      duplicatePenaltyInvoice = duplicatePenaltyInvoiceMap.get(String(invoice._id)) || null;
      if (duplicatePenaltyInvoice?._id) skippedReason = `Duplicate already exists (${duplicatePenaltyInvoice.invoiceNumber})`;
    }

    const calculatedPenalty = skippedReason
      ? 0
      : calculatePenaltyAmount({ rule, outstandingBalance, overdueDays: afterGrace });

    if (!skippedReason && calculatedPenalty <= 0) {
      skippedReason = "Calculated penalty is zero";
    }

    rows.push({
      sourceInvoiceId: String(invoice._id),
      sourceInvoiceNumber: invoice.invoiceNumber || "",
      tenantId: invoice?.tenant?._id ? String(invoice.tenant._id) : String(invoice.tenant || ""),
      tenantName: invoice?.tenant?.name || "Unknown Tenant",
      tenantCode: invoice?.tenant?.tenantCode || "",
      propertyId: property?._id ? String(property._id) : String(invoice.property || ""),
      propertyName: property?.propertyName || property?.name || "Unknown Property",
      propertyCode: property?.propertyCode || "",
      unitId: invoice?.unit?._id ? String(invoice.unit._id) : String(invoice.unit || ""),
      unitNumber: invoice?.unit?.unitNumber || "-",
      dueDate,
      invoiceDate: invoice.invoiceDate,
      overdueDays: afterGrace,
      outstandingBalance,
      calculatedPenalty,
      skippedReason,
      duplicatePenaltyInvoice,
    });
  }

  return rows;
};

const loadRuleOrThrow = async (businessId, ruleId) => {
  if (!isValidObjectId(ruleId)) {
    const error = new Error("A valid late penalty rule is required.");
    error.statusCode = 400;
    throw error;
  }

  const rule = await LatePenaltyRule.findOne({ _id: ruleId, business: businessId })
    .populate("postingAccount", "code name type")
    .lean();

  if (!rule) {
    const error = new Error("Late penalty rule not found.");
    error.statusCode = 404;
    throw error;
  }

  return rule;
};

const findBatchAndItemOrThrow = async ({ businessId, itemId }) => {
  if (!isValidObjectId(itemId)) {
    const error = new Error("A valid late penalty item is required.");
    error.statusCode = 400;
    throw error;
  }

  const batch = await LatePenaltyBatch.findOne({
    business: businessId,
    "items._id": itemId,
  });

  if (!batch) {
    const error = new Error("Late penalty item not found.");
    error.statusCode = 404;
    throw error;
  }

  const item = batch.items.id(itemId);
  if (!item) {
    const error = new Error("Late penalty item not found.");
    error.statusCode = 404;
    throw error;
  }

  return { batch, item };
};

const findPenaltyInvoice = async ({ businessId, item }) => {
  const penaltyInvoiceId = item?.penaltyInvoice?._id || item?.penaltyInvoice || null;
  if (!penaltyInvoiceId || !isValidObjectId(penaltyInvoiceId)) {
    return null;
  }

  return TenantInvoice.findOne({
    _id: penaltyInvoiceId,
    business: businessId,
  });
};

const getOriginalPenaltyLedgerEntries = async (invoice) => {
  if (!invoice?._id) return [];

  return FinancialLedgerEntry.find({
    business: invoice.business,
    sourceTransactionType: "invoice",
    sourceTransactionId: String(invoice._id),
    category: { $ne: "REVERSAL" },
  });
};

const refreshPenaltyItemBatchStatus = (batch) => {
  const items = Array.isArray(batch?.items) ? batch.items : [];

  if (!items.length) {
    batch.status = "failed";
    return;
  }

  const activeProcessedItems = items.filter(
    (item) =>
      String(item?.status || "").toLowerCase() === "processed" &&
      !item?.isDeleted &&
      !item?.reversedAt
  );

  const hasFailed = items.some((item) => String(item?.status || "").toLowerCase() === "failed");
  const hasProcessed = items.some((item) => String(item?.status || "").toLowerCase() === "processed");
  const allHandledByReversalOrDelete = hasProcessed && activeProcessedItems.length === 0;

  if (allHandledByReversalOrDelete) {
    batch.status = "reversed_ready";
  } else if (hasFailed && hasProcessed) {
    batch.status = "partial";
  } else if (hasFailed && !hasProcessed) {
    batch.status = "failed";
  } else {
    batch.status = "processed";
  }

  batch.invoicesCreatedCount = activeProcessedItems.length;
  batch.totalPenaltyAmount = round2(
    activeProcessedItems.reduce((sum, item) => sum + Number(item?.calculatedPenalty || 0), 0)
  );
};

const ACTIVE_PENALTY_INVOICE_STATUSES = new Set(["pending", "paid", "partially_paid"]);

const buildBatchDeleteReadiness = async ({ businessId, batch }) => {
  const items = Array.isArray(batch?.items) ? batch.items : [];
  const linkedInvoiceIds = [
    ...new Set(
      items
        .map((item) => item?.penaltyInvoice?._id || item?.penaltyInvoice || null)
        .filter((value) => isValidObjectId(value))
        .map((value) => String(value))
    ),
  ];

  if (!linkedInvoiceIds.length) {
    return { canDeleteBatch: true, deleteBlockers: [] };
  }

  const linkedInvoices = await TenantInvoice.find({
    business: businessId,
    _id: { $in: linkedInvoiceIds },
  })
    .select("_id invoiceNumber status")
    .lean();

  const invoiceMap = new Map(linkedInvoices.map((invoice) => [String(invoice._id), invoice]));
  const deleteBlockers = [];

  for (const item of items) {
    const penaltyInvoiceId = item?.penaltyInvoice?._id || item?.penaltyInvoice || null;
    if (!isValidObjectId(penaltyInvoiceId)) continue;

    const invoice = invoiceMap.get(String(penaltyInvoiceId));
    if (!invoice) continue;

    const normalizedStatus = String(invoice?.status || "").toLowerCase();
    if (ACTIVE_PENALTY_INVOICE_STATUSES.has(normalizedStatus)) {
      deleteBlockers.push({
        itemId: String(item?._id || ""),
        invoiceId: String(invoice._id),
        invoiceNumber: invoice.invoiceNumber || "Penalty invoice",
        status: normalizedStatus,
      });
    }
  }

  return {
    canDeleteBatch: deleteBlockers.length === 0,
    deleteBlockers,
  };
};

const hydrateBatchDeleteReadiness = async (businessId, batch) => {
  const readiness = await buildBatchDeleteReadiness({ businessId, batch });
  return {
    ...batch,
    canDeleteBatch: readiness.canDeleteBatch,
    deleteBlockers: readiness.deleteBlockers,
  };
};

export const getLatePenaltyPostingAccounts = async (req, res) => {
  try {
    const businessId = resolveBusinessId(req);
    await ensureSystemChartOfAccounts(businessId);

    const rows = await ChartOfAccount.find({
      business: businessId,
      type: "income",
      isPosting: { $ne: false },
    })
      .select("_id code name type group subGroup isSystem")
      .sort({ code: 1, name: 1 })
      .lean();

    return res.status(200).json({ accounts: rows });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || "Failed to load late penalty posting accounts." });
  }
};

export const getLatePenaltyRules = async (req, res) => {
  try {
    const businessId = resolveBusinessId(req);
    const rows = await LatePenaltyRule.find({ business: businessId })
      .populate("postingAccount", "code name type")
      .sort({ active: -1, createdAt: -1 })
      .lean();

    return res.status(200).json({ rules: rows });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to load late penalty rules." });
  }
};

export const createLatePenaltyRule = async (req, res) => {
  try {
    const businessId = resolveBusinessId(req);
    const actorUserId = await resolveActorUserId({ req, business: businessId, bodyCreatedBy: req.body.createdBy });
    const trimmedRuleName = String(req.body.ruleName || "").trim();

    if (!trimmedRuleName) {
      return res.status(400).json({ message: "Rule name is required." });
    }

    const postingAccount = await ChartOfAccount.findOne({
      _id: req.body.postingAccount,
      business: businessId,
      type: "income",
    }).lean();

    if (!postingAccount) {
      return res.status(400).json({ message: "Select a valid income posting account for the penalty rule." });
    }

    const automationFields = normalizeRuleAutomationFields(req.body || {});

    const rule = await LatePenaltyRule.create({
      business: businessId,
      ruleName: trimmedRuleName,
      effectiveFrom: normalizeDate(req.body.effectiveFrom || new Date()),
      active: req.body.active !== false,
      postingAccount: postingAccount._id,
      graceDays: Number(req.body.graceDays || 0),
      minimumOverdueDays: Number(req.body.minimumOverdueDays || 0),
      penalizeItem: req.body.penalizeItem || "outstanding_invoice_balance",
      calculationType: req.body.calculationType || "percentage_overdue_balance",
      rateOrAmount: Number(req.body.rateOrAmount || 0),
      minimumBalance: Number(req.body.minimumBalance || 0),
      maximumBalance: Number(req.body.maximumBalance || 0),
      maximumPenaltyCap: Number(req.body.maximumPenaltyCap || 0),
      applyAutomatically: automationFields.applyAutomatically,
      repeatFrequency: automationFields.repeatFrequency,
      notes: req.body.notes || "",
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    const saved = await LatePenaltyRule.findById(rule._id)
      .populate("postingAccount", "code name type")
      .lean();

    return res.status(201).json({ message: "Late penalty rule created successfully.", rule: saved });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(400).json({ message: "A late penalty rule with that name already exists for this company." });
    }
    return res.status(error.statusCode || 500).json({ message: error.message || "Failed to create late penalty rule." });
  }
};

export const updateLatePenaltyRule = async (req, res) => {
  try {
    const businessId = resolveBusinessId(req);
    const actorUserId = await resolveActorUserId({ req, business: businessId, bodyCreatedBy: req.user?.id || req.user?._id });
    const rule = await LatePenaltyRule.findOne({ _id: req.params.id, business: businessId });

    if (!rule) {
      return res.status(404).json({ message: "Late penalty rule not found." });
    }

    if (req.body.ruleName !== undefined && !String(req.body.ruleName || "").trim()) {
      return res.status(400).json({ message: "Rule name is required." });
    }

    if (req.body.postingAccount) {
      const postingAccount = await ChartOfAccount.findOne({
        _id: req.body.postingAccount,
        business: businessId,
        type: "income",
      }).lean();
      if (!postingAccount) {
        return res.status(400).json({ message: "Select a valid income posting account for the penalty rule." });
      }
      rule.postingAccount = postingAccount._id;
    }

    const simpleFields = [
      "ruleName",
      "penalizeItem",
      "calculationType",
      "notes",
    ];
    simpleFields.forEach((field) => {
      if (req.body[field] !== undefined) rule[field] = req.body[field];
    });

    if (req.body.effectiveFrom !== undefined) rule.effectiveFrom = normalizeDate(req.body.effectiveFrom || new Date());
    if (req.body.active !== undefined) rule.active = !!req.body.active;

    const automationFields = normalizeRuleAutomationFields({
      repeatFrequency: req.body.repeatFrequency !== undefined ? req.body.repeatFrequency : rule.repeatFrequency,
      applyAutomatically: req.body.applyAutomatically !== undefined ? req.body.applyAutomatically : rule.applyAutomatically,
    });
    rule.repeatFrequency = automationFields.repeatFrequency;
    rule.applyAutomatically = automationFields.applyAutomatically;

    ["graceDays", "minimumOverdueDays", "rateOrAmount", "minimumBalance", "maximumBalance", "maximumPenaltyCap"].forEach((field) => {
      if (req.body[field] !== undefined) rule[field] = Number(req.body[field] || 0);
    });

    rule.updatedBy = actorUserId;
    await rule.save();

    const saved = await LatePenaltyRule.findById(rule._id)
      .populate("postingAccount", "code name type")
      .lean();

    return res.status(200).json({ message: "Late penalty rule updated successfully.", rule: saved });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(400).json({ message: "A late penalty rule with that name already exists for this company." });
    }
    return res.status(error.statusCode || 500).json({ message: error.message || "Failed to update late penalty rule." });
  }
};

export const previewLatePenalties = async (req, res) => {
  try {
    const businessId = resolveBusinessId(req);
    const rule = await loadRuleOrThrow(businessId, req.body.ruleId);
    const runDate = normalizeDate(req.body.runDate || new Date());
    const periodKey = buildPeriodKey(rule, runDate);
    const rows = await buildCandidateRows({ businessId, rule, runDate });

    const eligibleRows = rows.filter((row) => !row.skippedReason && Number(row.calculatedPenalty || 0) > 0);
    const skippedRows = rows.filter((row) => row.skippedReason);

    return res.status(200).json({
      rule,
      runDate,
      periodKey,
      summary: {
        totalRows: rows.length,
        eligibleCount: eligibleRows.length,
        skippedCount: skippedRows.length,
        totalPenaltyAmount: round2(eligibleRows.reduce((sum, row) => sum + Number(row.calculatedPenalty || 0), 0)),
      },
      rows,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || "Failed to preview late penalties." });
  }
};

export const processLatePenalties = async (req, res) => {
  try {
    const businessId = resolveBusinessId(req);
    const rule = await loadRuleOrThrow(businessId, req.body.ruleId);
    const runDate = normalizeDate(req.body.runDate || new Date());
    const periodKey = buildPeriodKey(rule, runDate);
    const actorUserId = await resolveActorUserId({ req, business: businessId, bodyCreatedBy: req.user?.id || req.user?._id });

    const previewRows = await buildCandidateRows({ businessId, rule, runDate });
    const requestedIds = Array.isArray(req.body.selectedSourceInvoiceIds) && req.body.selectedSourceInvoiceIds.length > 0
      ? new Set(req.body.selectedSourceInvoiceIds.map(String))
      : null;

    const rowsToProcess = previewRows.filter((row) => {
      if (row.skippedReason || Number(row.calculatedPenalty || 0) <= 0) return false;
      if (requestedIds && !requestedIds.has(String(row.sourceInvoiceId))) return false;
      return true;
    });

    if (rowsToProcess.length === 0) {
      return res.status(400).json({ message: "No eligible late penalty rows were selected for processing." });
    }

    const batch = await LatePenaltyBatch.create({
      business: businessId,
      batchName: req.body.batchName || `Late Penalties ${periodKey}`,
      rule: rule._id,
      ruleName: rule.ruleName,
      runDate,
      periodKey,
      invoicesCreatedCount: 0,
      totalPenaltyAmount: 0,
      processedBy: actorUserId,
      status: "processed",
      notes: req.body.notes || "",
      items: [],
    });

    // Batch duplicate check — one query instead of one per row.
    const sourceIds = rowsToProcess.map((r) => String(r.sourceInvoiceId));
    const existingPenalties = await TenantInvoice.find({
      business: businessId,
      category: "LATE_PENALTY_CHARGE",
      status: { $nin: ["cancelled", "reversed"] },
      "metadata.penaltyRuleId": String(rule._id),
      "metadata.penaltySourceInvoiceId": { $in: sourceIds },
      "metadata.penaltyPeriodKey": periodKey,
    })
      .select("_id invoiceNumber metadata.penaltySourceInvoiceId")
      .lean();
    const duplicateMap = new Map(
      existingPenalties.map((inv) => [String(inv.metadata?.penaltySourceInvoiceId || ""), inv])
    );

    const results = [];
    for (const row of rowsToProcess) {
      const duplicate = duplicateMap.get(String(row.sourceInvoiceId));

      if (duplicate?._id) {
        results.push({ ...row, status: "duplicate", reason: `Duplicate already exists (${duplicate.invoiceNumber})`, penaltyInvoiceId: String(duplicate._id), invoiced: true });
        continue;
      }

      try {
        const penaltyInvoice = await createTenantInvoiceRecord({
          req,
          payload: {
            business: businessId,
            property: row.propertyId,
            tenant: row.tenantId,
            unit: row.unitId,
            category: "LATE_PENALTY_CHARGE",
            amount: Number(row.calculatedPenalty || 0),
            description: `${row.sourceInvoiceNumber || formatPenaltyDescriptionPeriod(runDate)} Late Penalty`,
            invoiceDate: runDate,
            dueDate: runDate,
            createdBy: actorUserId,
            chartAccountId: rule.postingAccount?._id || rule.postingAccount,
            metadata: {
              includeInLandlordStatement: false,
              includeInCategoryTotals: false,
              statementClassification: "manager_penalty_income",
              sourceTransactionType: "late_penalty_batch",
              penaltyBatchId: String(batch._id),
              penaltyRuleId: String(rule._id),
              penaltyRuleName: rule.ruleName,
              penaltySourceInvoiceId: String(row.sourceInvoiceId),
              penaltySourceInvoiceNumber: row.sourceInvoiceNumber,
              penaltyPeriodKey: periodKey,
              isLatePenalty: true,
            },
          },
        });

        results.push({ ...row, status: "processed", reason: "", penaltyInvoiceId: String(penaltyInvoice._id), penaltyInvoiceNumber: penaltyInvoice.invoiceNumber, invoiced: true });
      } catch (error) {
        results.push({ ...row, status: "failed", reason: error.message || "Failed to create penalty invoice", invoiced: false });
      }
    }

    batch.items = results.map((row) => ({
      sourceInvoice: row.sourceInvoiceId,
      sourceInvoiceNumber: row.sourceInvoiceNumber,
      tenant: row.tenantId || null,
      property: row.propertyId || null,
      unit: row.unitId || null,
      dueDate: row.dueDate || null,
      overdueDays: Number(row.overdueDays || 0),
      outstandingBalance: Number(row.outstandingBalance || 0),
      calculatedPenalty: Number(row.calculatedPenalty || 0),
      penaltyInvoice: row.penaltyInvoiceId || null,
      invoiced: !!row.invoiced,
      status: row.status,
      reason: row.reason || "",
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      deletionReason: "",
      reversedAt: null,
      reversedBy: null,
      reversalReason: "",
    }));
    refreshPenaltyItemBatchStatus(batch);
    await batch.save();

    const savedBatch = await LatePenaltyBatch.findById(batch._id)
      .populate("rule", "ruleName")
      .populate("processedBy", "surname otherNames email")
      .populate("items.penaltyInvoice", "invoiceNumber amount status")
      .lean();

    return res.status(201).json({
      message: "Late penalties processed successfully.",
      batch: savedBatch,
      summary: {
        selectedCount: rowsToProcess.length,
        processedCount: results.filter((row) => row.status === "processed").length,
        duplicateCount: results.filter((row) => row.status === "duplicate").length,
        failedCount: results.filter((row) => row.status === "failed").length,
        totalPenaltyAmount: batch.totalPenaltyAmount,
      },
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || "Failed to process late penalties." });
  }
};

export const getLatePenaltyBatches = async (req, res) => {
  try {
    const businessId = resolveBusinessId(req);
    const rows = await LatePenaltyBatch.find({ business: businessId })
      .populate("rule", "ruleName")
      .populate("processedBy", "surname otherNames email")
      .populate("items.sourceInvoice", "invoiceNumber amount status category")
      .populate("items.penaltyInvoice", "invoiceNumber amount status category")
      .populate("items.tenant", "name tenantCode")
      .populate("items.property", "propertyName propertyCode")
      .populate("items.unit", "unitNumber")
      .sort({ runDate: -1, createdAt: -1 })
      .lean();

    // Batch-check invoice statuses across all batches — one query instead of one per batch
    const allLinkedInvoiceIds = [
      ...new Set(
        rows.flatMap((row) =>
          (Array.isArray(row.items) ? row.items : [])
            .map((item) => item?.penaltyInvoice?._id || item?.penaltyInvoice || null)
            .filter((id) => isValidObjectId(id))
            .map(String)
        )
      ),
    ];
    const allLinkedInvoices = allLinkedInvoiceIds.length
      ? await TenantInvoice.find({ business: businessId, _id: { $in: allLinkedInvoiceIds } })
          .select("_id invoiceNumber status")
          .lean()
      : [];
    const invoiceStatusMap = new Map(allLinkedInvoices.map((inv) => [String(inv._id), inv]));

    const hydratedRows = rows.map((row) => {
      const deleteBlockers = [];
      for (const item of (Array.isArray(row.items) ? row.items : [])) {
        const penaltyInvoiceId = item?.penaltyInvoice?._id || item?.penaltyInvoice || null;
        if (!isValidObjectId(penaltyInvoiceId)) continue;
        const invoice = invoiceStatusMap.get(String(penaltyInvoiceId));
        if (!invoice) continue;
        const normalizedStatus = String(invoice?.status || "").toLowerCase();
        if (ACTIVE_PENALTY_INVOICE_STATUSES.has(normalizedStatus)) {
          deleteBlockers.push({
            itemId: String(item?._id || ""),
            invoiceId: String(invoice._id),
            invoiceNumber: invoice.invoiceNumber || "Penalty invoice",
            status: normalizedStatus,
          });
        }
      }
      return { ...row, canDeleteBatch: deleteBlockers.length === 0, deleteBlockers };
    });

    return res.status(200).json({ batches: hydratedRows });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to load late penalty batches." });
  }
};

export const getLatePenaltyBatch = async (req, res) => {
  try {
    const businessId = resolveBusinessId(req);
    const batch = await LatePenaltyBatch.findOne({ _id: req.params.id, business: businessId })
      .populate("rule", "ruleName effectiveFrom repeatFrequency calculationType rateOrAmount")
      .populate("processedBy", "surname otherNames email")
      .populate("items.sourceInvoice", "invoiceNumber amount status category")
      .populate("items.penaltyInvoice", "invoiceNumber amount status category")
      .populate("items.tenant", "name tenantCode")
      .populate("items.property", "propertyName propertyCode")
      .populate("items.unit", "unitNumber")
      .lean();

    if (!batch) {
      return res.status(404).json({ message: "Late penalty batch not found." });
    }

    return res.status(200).json({ batch: await hydrateBatchDeleteReadiness(businessId, batch) });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to load late penalty batch." });
  }
};

export const deleteLatePenaltyBatch = async (req, res) => {
  try {
    const businessId = resolveBusinessId(req);
    const batchId = req.params?.id;

    if (!isValidObjectId(batchId)) {
      return res.status(400).json({ message: "A valid late penalty batch is required." });
    }

    const batch = await LatePenaltyBatch.findOne({ _id: batchId, business: businessId }).lean();
    if (!batch) {
      return res.status(404).json({ message: "Late penalty batch not found." });
    }

    const readiness = await buildBatchDeleteReadiness({ businessId, batch });
    if (!readiness.canDeleteBatch) {
      return res.status(400).json({
        message: "Cannot delete batch while active penalty invoices still exist. Reverse or clear every penalty invoice in the batch first.",
        deleteBlockers: readiness.deleteBlockers,
      });
    }

    await LatePenaltyBatch.deleteOne({ _id: batch._id, business: businessId });
    return res.status(200).json({ success: true, message: "Late penalty batch deleted successfully." });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || "Failed to delete late penalty batch." });
  }
};

export const reverseLatePenalty = async (req, res) => {
  try {
    const businessId = resolveBusinessId(req);
    const itemIds = Array.isArray(req.body?.itemIds) ? req.body.itemIds.filter(Boolean) : [];
    const requestedItemIds = itemIds.length > 0 ? itemIds : [req.body?.itemId].filter(Boolean);

    if (!requestedItemIds.length) {
      return res.status(400).json({ message: "Select at least one late penalty row to reverse." });
    }

    const actorUserId = await resolveActorUserId({
      req,
      business: businessId,
      bodyCreatedBy: req.user?.id || req.user?._id,
    });

    // Pre-load all matching batches and penalty invoices in two queries
    const validItemIds = requestedItemIds.filter(isValidObjectId);
    const batchDocs = validItemIds.length
      ? await LatePenaltyBatch.find({ business: businessId, "items._id": { $in: validItemIds } })
      : [];
    const batchByItemId = new Map();
    for (const batchDoc of batchDocs) {
      for (const it of (batchDoc.items || [])) {
        batchByItemId.set(String(it._id), { batch: batchDoc, item: it });
      }
    }
    const preloadedInvoiceIds = [
      ...new Set(
        batchDocs
          .flatMap((b) => b.items || [])
          .filter((it) => validItemIds.includes(String(it._id)))
          .map((it) => it?.penaltyInvoice?._id || it?.penaltyInvoice || null)
          .filter(isValidObjectId)
          .map(String)
      ),
    ];
    const preloadedInvoices = preloadedInvoiceIds.length
      ? await TenantInvoice.find({ business: businessId, _id: { $in: preloadedInvoiceIds } })
      : [];
    const invoiceByIdMap = new Map(preloadedInvoices.map((inv) => [String(inv._id), inv]));

    const results = [];
    const touchedAccountIds = new Set();

    for (const itemId of requestedItemIds) {
      try {
        if (!isValidObjectId(itemId)) {
          results.push({ itemId: String(itemId), status: "failed", message: "Invalid late penalty item ID." });
          continue;
        }
        const found = batchByItemId.get(String(itemId));
        if (!found) {
          results.push({ itemId: String(itemId), status: "failed", message: "Late penalty item not found." });
          continue;
        }
        const { batch, item } = found;

        if (item?.isDeleted || String(item?.status || "").toLowerCase() === "deleted") {
          results.push({ itemId: String(item._id), status: "failed", message: "Deleted penalties cannot be reversed." });
          continue;
        }

        if (item?.reversedAt || String(item?.status || "").toLowerCase() === "reversed") {
          results.push({ itemId: String(item._id), status: "skipped", message: "Penalty already reversed." });
          continue;
        }

        const penaltyInvoiceId = item?.penaltyInvoice?._id || item?.penaltyInvoice || null;
        const penaltyInvoice = (penaltyInvoiceId && isValidObjectId(penaltyInvoiceId))
          ? (invoiceByIdMap.get(String(penaltyInvoiceId)) || await findPenaltyInvoice({ businessId, item }))
          : null;

        if (penaltyInvoice) {
          const originalEntries = await getOriginalPenaltyLedgerEntries(penaltyInvoice);

          if (originalEntries.length === 0) {
            results.push({
              itemId: String(item._id),
              status: "failed",
              message: "Cannot reverse penalty without journal entry. Delete instead.",
            });
            continue;
          }

          for (const entry of originalEntries) {
            if (entry?.accountId) {
              touchedAccountIds.add(String(entry.accountId));
            }

            if (!entry?.reversedByEntry && String(entry?.status || "").toLowerCase() !== "reversed") {
              const reversal = await postReversal({
                entryId: entry._id,
                userId: actorUserId,
                reason: req.body?.reason || `Late penalty reversal for ${penaltyInvoice.invoiceNumber || penaltyInvoice._id}`,
              });

              if (reversal?.reversalEntry?.accountId) {
                touchedAccountIds.add(String(reversal.reversalEntry.accountId));
              }
            }
          }

          penaltyInvoice.status = penaltyInvoice.ledgerMode === "off_ledger" ? "cancelled" : "reversed";
          penaltyInvoice.postingStatus = penaltyInvoice.ledgerMode === "off_ledger" ? "not_applicable" : "reversed";
          penaltyInvoice.postingError = null;
          penaltyInvoice.metadata = {
            ...(penaltyInvoice.metadata && typeof penaltyInvoice.metadata === "object" ? penaltyInvoice.metadata : {}),
            reversedAt: new Date(),
            reversedBy: actorUserId,
            reversalReason: req.body?.reason || "Late penalty reversed from late penalties workspace",
          };
          await penaltyInvoice.save();

          await recomputeTenantFinancialState({
            businessId: penaltyInvoice.business,
            tenantId: penaltyInvoice.tenant,
          });
        }

        if (!penaltyInvoice) {
          results.push({
            itemId: String(item._id),
            status: "failed",
            message: "Penalty invoice not found for this batch item.",
          });
          continue;
        }

        item.invoiced = false;
        item.status = "reversed";
        item.reason = req.body?.reason || item.reason || "Late penalty reversed.";
        item.reversedAt = new Date();
        item.reversedBy = actorUserId;
        item.reversalReason = req.body?.reason || "Late penalty reversed from workspace";
        batch.markModified("items");
        refreshPenaltyItemBatchStatus(batch);
        await batch.save();

        results.push({
          itemId: String(item._id),
          status: "reversed",
          message: "Late penalty reversed successfully.",
        });
      } catch (error) {
        results.push({
          itemId: String(itemId),
          status: "failed",
          message: error.message || "Failed to reverse late penalty.",
        });
      }
    }

    if (touchedAccountIds.size > 0) {
      await aggregateChartOfAccountBalances(businessId, Array.from(touchedAccountIds));
    }

    const failed = results.filter((row) => row.status === "failed");
    if (failed.length === results.length) {
      return res.status(400).json({
        message: failed[0]?.message || "Failed to reverse selected late penalties.",
        results,
      });
    }

    return res.status(200).json({
      message: results.length === 1 ? "Late penalty reversed successfully." : "Selected late penalties reversed successfully.",
      results,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || "Failed to reverse late penalty." });
  }
};

export const deleteLatePenalty = async (req, res) => {
  try {
    const businessId = resolveBusinessId(req);
    const itemId = req.params?.id;

    const actorUserId = await resolveActorUserId({
      req,
      business: businessId,
      bodyCreatedBy: req.user?.id || req.user?._id,
    });

    const { batch, item } = await findBatchAndItemOrThrow({ businessId, itemId });

    if (item?.reversedAt || String(item?.status || "").toLowerCase() === "reversed") {
      return res.status(400).json({ message: "Reversed penalties cannot be deleted." });
    }

    if (item?.isDeleted || String(item?.status || "").toLowerCase() === "deleted") {
      return res.status(400).json({ message: "Penalty already deleted." });
    }

    const penaltyInvoice = await findPenaltyInvoice({ businessId, item });

    if (penaltyInvoice) {
      const originalEntries = await getOriginalPenaltyLedgerEntries(penaltyInvoice);
      const hasJournalEntries = Array.isArray(penaltyInvoice.ledgerEntries) && penaltyInvoice.ledgerEntries.length > 0
        ? true
        : originalEntries.length > 0;

      if (hasJournalEntries) {
        return res.status(400).json({
          message: "Cannot delete penalty with journal entry. Reverse instead.",
        });
      }

      if (!["cancelled", "reversed"].includes(String(penaltyInvoice.status || "").toLowerCase())) {
        await TenantInvoice.deleteOne({ _id: penaltyInvoice._id, business: businessId });
        await recomputeTenantFinancialState({
          businessId: penaltyInvoice.business,
          tenantId: penaltyInvoice.tenant,
        });
      }
    }

    item.invoiced = false;
    item.isDeleted = true;
    item.status = "deleted";
    item.reason = req.body?.reason || item.reason || "Late penalty deleted.";
    item.deletedAt = new Date();
    item.deletedBy = actorUserId;
    item.deletionReason = req.body?.reason || "Late penalty deleted from workspace";
    batch.markModified("items");
    refreshPenaltyItemBatchStatus(batch);
    await batch.save();

    return res.status(200).json({ message: "Penalty deleted successfully." });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || "Failed to delete late penalty." });
  }
};
