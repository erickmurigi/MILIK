import mongoose from "mongoose";
import LatePenaltyRule from "../../models/LatePenaltyRule.js";
import LatePenaltyBatch from "../../models/LatePenaltyBatch.js";
import TenantInvoice from "../../models/TenantInvoice.js";
import Property from "../../models/Property.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import { createTenantInvoiceRecord, resolveActorUserId, computeTenantInvoiceSnapshots } from "./tenantInvoices.js";
import { ensureSystemChartOfAccounts } from "../../services/chartOfAccountsService.js";
import { getAccessibleCompanyIds } from "../../utils/permissionControl.js";

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
    return category === "RENT_CHARGE" && getMonthKey(invoice?.invoiceDate) === getMonthKey(runDate);
  }
  if (mode === "current_period_bill_balance_only") {
    return getMonthKey(invoice?.invoiceDate) === getMonthKey(runDate);
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

const buildCandidateRows = async ({ businessId, rule, runDate }) => {
  const runAt = startOfDay(runDate);
  assertRuleCanRun(rule, runAt);

  const invoices = await TenantInvoice.find({
    business: businessId,
    status: { $nin: ["cancelled", "reversed", "paid"] },
    dueDate: { $lt: runAt },
    category: { $in: ["RENT_CHARGE", "UTILITY_CHARGE"] },
  })
    .populate("tenant", "name tenantCode")
    .populate("property", "propertyName propertyCode exemptFromLatePenalties")
    .populate("unit", "unitNumber")
    .sort({ dueDate: 1, createdAt: 1 })
    .lean();

  const periodKey = buildPeriodKey(rule, runDate);
  const rows = [];

  for (const invoice of invoices) {
    const property = invoice?.property || {};
    const outstandingBalance = await getOutstandingBalance(invoice, runAt);
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

    let duplicatePenaltyInvoice = null;
    if (!skippedReason) {
      duplicatePenaltyInvoice = await TenantInvoice.findOne({
        business: businessId,
        category: "LATE_PENALTY_CHARGE",
        status: { $nin: ["cancelled", "reversed"] },
        "metadata.penaltyRuleId": String(rule._id),
        "metadata.penaltySourceInvoiceId": String(invoice._id),
        "metadata.penaltyPeriodKey": periodKey,
      })
        .select("_id invoiceNumber amount")
        .lean();

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
    const actorUserId = await resolveActorUserId({ req, business: businessId, fallbackUserId: req.user?.id || req.user?._id });
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
    const actorUserId = await resolveActorUserId({ req, business: businessId, fallbackUserId: req.user?.id || req.user?._id });

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

    const results = [];
    for (const row of rowsToProcess) {
      const duplicate = await TenantInvoice.findOne({
        business: businessId,
        category: "LATE_PENALTY_CHARGE",
        status: { $nin: ["cancelled", "reversed"] },
        "metadata.penaltyRuleId": String(rule._id),
        "metadata.penaltySourceInvoiceId": String(row.sourceInvoiceId),
        "metadata.penaltyPeriodKey": periodKey,
      })
        .select("_id invoiceNumber")
        .lean();

      if (duplicate?._id) {
        results.push({ ...row, status: "duplicate", reason: `Duplicate already exists (${duplicate.invoiceNumber})`, penaltyInvoiceId: String(duplicate._id) });
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
            description: `Late penalty for invoice ${row.sourceInvoiceNumber} under rule ${rule.ruleName}`,
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

        results.push({ ...row, status: "processed", reason: "", penaltyInvoiceId: String(penaltyInvoice._id), penaltyInvoiceNumber: penaltyInvoice.invoiceNumber });
      } catch (error) {
        results.push({ ...row, status: "failed", reason: error.message || "Failed to create penalty invoice" });
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
      status: row.status,
      reason: row.reason || "",
    }));
    batch.invoicesCreatedCount = results.filter((row) => row.status === "processed").length;
    batch.totalPenaltyAmount = round2(results.filter((row) => row.status === "processed").reduce((sum, row) => sum + Number(row.calculatedPenalty || 0), 0));
    if (results.every((row) => row.status === "failed")) batch.status = "failed";
    else if (results.some((row) => row.status === "failed")) batch.status = "partial";
    else batch.status = "processed";
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
      .sort({ runDate: -1, createdAt: -1 })
      .lean();

    return res.status(200).json({ batches: rows });
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

    return res.status(200).json({ batch });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to load late penalty batch." });
  }
};
