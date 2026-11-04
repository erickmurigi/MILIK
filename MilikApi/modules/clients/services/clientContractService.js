// Contract business rules shared by the contracts controller and the daily lifecycle cron:
// line normalisation, approval rules, version snapshots/diffs, amendments, escalation, renewal
// and expiry. Controllers stay thin; anything a cron also does lives here.
import mongoose from "mongoose";
import ClientContract from "../models/ClientContract.js";
import ClientContractVersion from "../models/ClientContractVersion.js";
import ClientQuote from "../models/ClientQuote.js";
import CompanySettings from "../../../models/CompanySettings.js";
import { round2 } from "../../../utils/math.js";
import { createError } from "../../../utils/error.js";
import { logAuditEvent } from "../../../utils/auditLogger.js";
import { emitToCompany } from "../../../utils/socketManager.js";
import { nextContractNumber } from "./clientSequenceService.js";
import { validateIncomeAccount } from "./clientAccountingService.js";
import { getClientTaxContext, resolveClientLineTax } from "./clientTaxService.js";
import { syncContractSchedule } from "./clientScheduleService.js";
import {
  BILLING_TIMINGS,
  REVENUE_RECOGNITION_METHODS,
  addDaysUTC,
  computeContractMetrics,
  effectiveContractLines,
  isoDay,
  lineKeyOf,
  normalizeFrequency,
  toUTCDate,
} from "./clientLineMath.js";
import { addMonthsPreservingDayUTC } from "../../../services/billingPeriodService.js";

export const CLIENT_BILLING_DEFAULTS = Object.freeze({
  approvalThreshold: null,
  maxDiscountWithoutApproval: null,
  escalationRequiresApproval: false,
  billingRunPostsAsDraft: false,
  defaultPaymentTermsDays: 30,
  invoicePrefix: "CINV",
  creditNotePrefix: "CN",
  debitNotePrefix: "DN",
  quotePrefix: "QUO",
  invoiceTerms: "",
  mpesaPaybill: "",
  bankDetails: {},
});

export const getClientBillingSettings = async (business) => {
  const settings = await CompanySettings.findOne({ company: business }).select("clientBilling").lean();
  return { ...CLIENT_BILLING_DEFAULTS, ...(settings?.clientBilling || {}) };
};

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const dateOrNull = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

// Normalises contract/quote lines. An incoming lineKey is kept only if it belongs to the existing
// line set, so a client can't forge a key that collides with another line's billing history.
export const sanitizeContractLines = async ({ business, lines, existingLines = [], taxCtx = null }) => {
  if (!Array.isArray(lines)) return [];
  const ctx = taxCtx || (await getClientTaxContext(business));
  const knownKeys = new Set(existingLines.map(lineKeyOf));
  const used = new Set();
  const result = [];
  for (const raw of lines) {
    if (!raw) continue;
    const itemName = String(raw.itemName || raw.description || "").trim();
    if (!itemName) throw createError(400, "Each contract line needs an item/service name");
    let lineKey = String(raw.lineKey || "").trim();
    if (!lineKey || !knownKeys.has(lineKey) || used.has(lineKey)) lineKey = new mongoose.Types.ObjectId().toString();
    used.add(lineKey);

    const startDate = dateOrNull(raw.startDate);
    const endDate = dateOrNull(raw.endDate);
    if (startDate && endDate && endDate < startDate) throw createError(400, `Line "${itemName}" ends before it starts`);
    const revenueRecognition = REVENUE_RECOGNITION_METHODS.includes(raw.revenueRecognition) ? raw.revenueRecognition : "on_invoice";
    const billingFrequency = normalizeFrequency(raw.billingFrequency, "monthly");
    if (revenueRecognition === "straight_line" && billingFrequency === "one_off" && !(startDate && endDate)) {
      throw createError(400, `One-off line "${itemName}" recognised straight-line needs a start and end date (the service period)`);
    }
    const tax = resolveClientLineTax(ctx, raw.taxCodeKey || ctx.defaultCodeKey);
    result.push({
      lineKey,
      itemName,
      description: String(raw.description || "").trim(),
      quantity: Math.max(0, num(raw.quantity, 1)),
      unitPrice: Math.max(0, num(raw.unitPrice, 0)),
      discountPercent: Math.min(100, Math.max(0, num(raw.discountPercent, 0))),
      ...tax,
      billingFrequency,
      billingTiming: BILLING_TIMINGS.includes(raw.billingTiming) ? raw.billingTiming : "advance",
      revenueRecognition,
      incomeAccount: raw.incomeAccount ? (await validateIncomeAccount(business, raw.incomeAccount))._id : null,
      startDate,
      endDate,
    });
  }
  return result;
};

// ─── Approval rules ──────────────────────────────────────────────────────────
export const evaluateApprovalReasons = (contractLike, billingSettings) => {
  const reasons = [];
  const threshold = billingSettings?.approvalThreshold;
  const metrics = computeContractMetrics(contractLike);
  if (threshold !== null && threshold !== undefined && Number(threshold) > 0 && metrics.tcv > Number(threshold)) {
    reasons.push(`Contract value ${metrics.tcv} exceeds the approval threshold of ${Number(threshold)}`);
  }
  const maxDiscount = billingSettings?.maxDiscountWithoutApproval;
  if (maxDiscount !== null && maxDiscount !== undefined) {
    for (const line of effectiveContractLines(contractLike)) {
      if (Number(line.discountPercent || 0) > Number(maxDiscount)) {
        reasons.push(`Line "${line.itemName}" discount ${line.discountPercent}% exceeds the ${Number(maxDiscount)}% allowed without approval`);
      }
    }
  }
  return reasons;
};

// ─── Snapshots & diffs ───────────────────────────────────────────────────────
export const SNAPSHOT_FIELDS = [
  "startDate", "endDate", "openEnded", "billingDay", "prorationRule", "taxMode", "paymentTermsDays",
  "escalationPercent", "escalationPeriodYears", "currency", "poNumber", "minimumTermMonths", "autoRenew",
  "renewalTermMonths", "latePaymentInterestPercent", "latePaymentInterestBasis", "latePaymentGraceDays",
  "depositAmount", "terms", "slaText", "noticePeriodDays",
];
export const AMENDABLE_FIELDS = SNAPSHOT_FIELDS.filter((f) => f !== "startDate");
const LINE_DIFF_FIELDS = [
  "itemName", "description", "quantity", "unitPrice", "discountPercent", "taxCodeKey", "billingFrequency",
  "billingTiming", "revenueRecognition", "incomeAccount", "startDate", "endDate",
];

const plainLine = (line) => {
  const l = line?.toObject ? line.toObject() : { ...line };
  delete l._id;
  return { ...l, lineKey: lineKeyOf(line), incomeAccount: l.incomeAccount ? String(l.incomeAccount) : null };
};

export const snapshotContract = (contract) => {
  const source = contract?.toObject ? contract.toObject() : contract;
  const snapshot = { lines: effectiveContractLines(source).map(plainLine) };
  for (const field of SNAPSHOT_FIELDS) snapshot[field] = source[field] ?? null;
  const metrics = computeContractMetrics({ ...source, lines: snapshot.lines });
  return { ...snapshot, tcv: metrics.tcv, acv: metrics.acv, mrr: metrics.mrr };
};

const comparable = (v) => (v instanceof Date ? v.toISOString() : v === undefined ? null : v);
const differs = (a, b) => JSON.stringify(comparable(a)) !== JSON.stringify(comparable(b));

export const diffSnapshots = (prev = {}, next = {}) => {
  const fieldChanges = [];
  for (const field of [...SNAPSHOT_FIELDS, "tcv", "acv", "mrr"]) {
    const from = prev[field] instanceof Date ? prev[field].toISOString() : prev[field] ?? null;
    const to = next[field] instanceof Date ? next[field].toISOString() : next[field] ?? null;
    if (differs(from, to)) fieldChanges.push({ field, from, to });
  }
  const prevLines = new Map((prev.lines || []).map((l) => [l.lineKey, l]));
  const nextLines = new Map((next.lines || []).map((l) => [l.lineKey, l]));
  const lineDiffs = [];
  for (const [key, line] of nextLines) {
    const before = prevLines.get(key);
    if (!before) {
      lineDiffs.push({ lineKey: key, itemName: line.itemName, change: "added", fields: [] });
      continue;
    }
    const fields = LINE_DIFF_FIELDS
      .filter((f) => differs(before[f] instanceof Date ? before[f].toISOString() : before[f] ?? null, line[f] instanceof Date ? line[f].toISOString() : line[f] ?? null))
      .map((f) => ({ field: f, from: before[f] ?? null, to: line[f] ?? null }));
    if (fields.length) lineDiffs.push({ lineKey: key, itemName: line.itemName, change: "modified", fields });
  }
  for (const [key, line] of prevLines) {
    if (!nextLines.has(key)) lineDiffs.push({ lineKey: key, itemName: line.itemName, change: "removed", fields: [] });
  }
  return { fieldChanges, lineDiffs };
};

// Contracts activated before versioning existed get their current terms recorded as version 1.
export const ensureOriginalVersion = async (contract, userId = null) => {
  const exists = await ClientContractVersion.exists({ contract: contract._id });
  if (exists) return null;
  try {
    return await ClientContractVersion.create({
      business: contract.business,
      contract: contract._id,
      version: contract.version || 1,
      versionType: "original",
      status: "applied",
      effectiveDate: contract.startDate,
      changeSummary: "Original contract terms",
      snapshot: snapshotContract(contract),
      createdBy: userId,
      approvedBy: contract.approvedBy || userId,
      approvedAt: contract.approvedAt || new Date(),
    });
  } catch (error) {
    if (error?.code === 11000) return null;
    throw error;
  }
};

// ─── Activation ──────────────────────────────────────────────────────────────
export const activateContractRecord = async ({ contract, userId, req = null }) => {
  contract.status = "active";
  contract.activatedAt = contract.activatedAt || new Date();
  contract.updatedBy = userId;
  await contract.save();
  await ensureOriginalVersion(contract, userId);
  const schedule = await syncContractSchedule({ contract });
  await logAuditEvent({
    req, company: contract.business, action: "client_contract.activated", category: "finance",
    targetType: "ClientContract", targetId: contract._id, targetName: contract.contractNumber,
    message: `Contract ${contract.contractNumber} activated`, metadata: { schedule },
  });
  emitToCompany(String(contract.business), "clients:contract:updated", { contractId: String(contract._id), status: contract.status });
  return contract;
};

// ─── Versions: apply / amend ────────────────────────────────────────────────
const nextVersionNumber = async (contract) => {
  const latest = await ClientContractVersion.findOne({ contract: contract._id }).sort({ version: -1 }).select("version").lean();
  return Math.max(Number(latest?.version || 0), Number(contract.version || 1)) + 1;
};

export const applyContractVersion = async ({ contract, version, userId, req = null }) => {
  const snap = version.snapshot || {};
  contract.lines = (snap.lines || []).map((l) => ({ ...l, incomeAccount: l.incomeAccount || null }));
  for (const field of AMENDABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(snap, field)) contract[field] = snap[field];
  }
  contract.version = version.version;
  contract.updatedBy = userId;
  await contract.save();

  await ClientContractVersion.updateMany(
    { contract: contract._id, status: "applied", _id: { $ne: version._id } },
    { $set: { status: "superseded" } }
  );
  if (version.status !== "applied") {
    version.status = "applied";
    version.approvedBy = version.approvedBy || userId;
    version.approvedAt = version.approvedAt || new Date();
    await version.save();
  }
  await syncContractSchedule({ contract });
  emitToCompany(String(contract.business), "clients:contract:updated", { contractId: String(contract._id), version: version.version });
  return contract;
};

const AMENDABLE_STATUSES = ["active", "suspended", "pending_renewal"];

export const amendContract = async ({ contract, input = {}, userId, req = null, versionType = "amendment", sourceKey = null, forceApproval = null }) => {
  if (!AMENDABLE_STATUSES.includes(contract.status)) {
    throw createError(400, `A ${contract.status} contract cannot be amended${contract.status === "draft" ? " — edit the draft instead" : ""}`);
  }
  const effectiveDate = toUTCDate(input.effectiveDate || new Date());
  if (!effectiveDate) throw createError(400, "A valid effectiveDate is required");
  if (effectiveDate < toUTCDate(contract.startDate)) throw createError(400, "effectiveDate cannot be before the contract start date");

  await ensureOriginalVersion(contract, userId);
  const pending = await ClientContractVersion.exists({ contract: contract._id, status: "pending_approval" });
  if (pending && versionType === "amendment") throw createError(409, "This contract already has an amendment awaiting approval");

  const prev = snapshotContract(contract);
  const next = { ...prev };
  if (Array.isArray(input.lines)) {
    next.lines = (await sanitizeContractLines({ business: contract.business, lines: input.lines, existingLines: prev.lines })).map(plainLine);
  }
  for (const field of AMENDABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) next[field] = input[field];
  }
  for (const f of ["endDate"]) if (next[f]) next[f] = new Date(next[f]);
  if (next.openEnded) next.endDate = null;
  if (!next.openEnded && next.endDate && toUTCDate(next.endDate) <= toUTCDate(contract.startDate)) throw createError(400, "endDate must be after startDate");
  Object.assign(next, computeContractMetrics({ ...contract.toObject(), ...next }));
  delete next.termMonths;

  const { fieldChanges, lineDiffs } = diffSnapshots(prev, next);
  if (!fieldChanges.length && !lineDiffs.length) throw createError(400, "The amendment does not change anything");

  const settings = await getClientBillingSettings(contract.business);
  const reasons = forceApproval === null ? evaluateApprovalReasons({ ...contract.toObject(), ...next }, settings) : [];
  const needsApproval = forceApproval === null ? reasons.length > 0 : Boolean(forceApproval);

  const version = await ClientContractVersion.create({
    business: contract.business,
    contract: contract._id,
    version: await nextVersionNumber(contract),
    versionType,
    status: needsApproval ? "pending_approval" : "applied",
    effectiveDate,
    changeSummary: String(input.changeSummary || "").trim() || (versionType === "escalation" ? "Scheduled price escalation" : "Contract amendment"),
    sourceKey,
    snapshot: next,
    fieldChanges,
    lineDiffs,
    createdBy: userId,
    ...(needsApproval ? {} : { approvedBy: userId, approvedAt: new Date() }),
  });

  if (!needsApproval) await applyContractVersion({ contract, version, userId, req });

  await logAuditEvent({
    req, company: contract.business, action: `client_contract.${versionType}`, category: "finance",
    targetType: "ClientContract", targetId: contract._id, targetName: contract.contractNumber,
    message: `Contract ${contract.contractNumber} v${version.version} ${needsApproval ? "submitted for approval" : "applied"} (${version.changeSummary})`,
    metadata: { version: version.version, effectiveDate, fieldChanges, lineDiffs, approvalReasons: reasons },
  });
  return { version, contract, needsApproval, approvalReasons: reasons };
};

export const decideContractVersion = async ({ contract, versionId, decision, reason = "", userId, req = null }) => {
  const version = await ClientContractVersion.findOne({ _id: versionId, contract: contract._id, status: "pending_approval" });
  if (!version) throw createError(404, "No pending version found");
  if (decision === "approve") {
    if (version.createdBy && userId && String(version.createdBy) === String(userId)) {
      throw createError(403, "The person who raised an amendment cannot approve it");
    }
    version.approvedBy = userId;
    version.approvedAt = new Date();
    version.status = "applied";
    await version.save();
    await applyContractVersion({ contract, version, userId, req });
  } else {
    if (!String(reason || "").trim()) throw createError(400, "A rejection reason is required");
    version.status = "rejected";
    version.rejectedBy = userId;
    version.rejectedAt = new Date();
    version.rejectionReason = String(reason).trim();
    await version.save();
  }
  await logAuditEvent({
    req, company: contract.business, action: `client_contract.version_${decision === "approve" ? "approved" : "rejected"}`, category: "finance",
    targetType: "ClientContract", targetId: contract._id, targetName: contract.contractNumber,
    message: `Contract ${contract.contractNumber} v${version.version} ${decision === "approve" ? "approved" : `rejected: ${reason}`}`,
  });
  return { version, contract };
};

// ─── Escalation ──────────────────────────────────────────────────────────────
export const upliftLines = (lines, percent) =>
  lines.map((line) => {
    const plain = plainLine(line);
    if (normalizeFrequency(plain.billingFrequency) === "one_off") return plain;
    return { ...plain, unitPrice: round2(Number(plain.unitPrice || 0) * (1 + Number(percent || 0) / 100)) };
  });

const addYearsUTC = (date, years) => addMonthsPreservingDayUTC(toUTCDate(date), 12 * Number(years || 1));

// Applies (or queues for approval) every escalation that has fallen due. The contract's
// nextEscalationDate is advanced with a compare-and-set first and the version carries a unique
// sourceKey ("escalation:<date>"), so an escalation date is applied once however often this runs.
export const runContractEscalations = async ({ business = null, asOf = new Date(), userId = null, contractId = null } = {}) => {
  const filter = {
    status: { $in: ["active", "pending_renewal", "suspended"] },
    nextEscalationDate: { $lte: asOf },
    escalationPercent: { $gt: 0 },
  };
  if (business) filter.business = business;
  if (contractId) filter._id = contractId;
  const due = await ClientContract.find(filter).select("_id nextEscalationDate escalationPeriodYears").lean();
  const result = { escalated: 0, pendingApproval: 0, skipped: 0, failures: [] };

  for (const item of due) {
    const dueDate = item.nextEscalationDate;
    const claimed = await ClientContract.findOneAndUpdate(
      { _id: item._id, nextEscalationDate: dueDate },
      { $set: { nextEscalationDate: addYearsUTC(dueDate, item.escalationPeriodYears || 2), lastEscalatedAt: new Date() } },
      { new: true }
    );
    if (!claimed) { result.skipped += 1; continue; }

    try {
      const settings = await getClientBillingSettings(claimed.business);
      const lines = upliftLines(effectiveContractLines(claimed.toObject()), claimed.escalationPercent);
      const { needsApproval } = await amendContract({
        contract: claimed,
        input: { effectiveDate: dueDate, lines, changeSummary: `Escalation of ${claimed.escalationPercent}% due ${isoDay(dueDate)}` },
        userId,
        versionType: "escalation",
        sourceKey: `escalation:${isoDay(dueDate)}`,
        forceApproval: Boolean(settings.escalationRequiresApproval),
      });
      if (needsApproval) result.pendingApproval += 1;
      else result.escalated += 1;
    } catch (error) {
      if (error?.code === 11000) { result.skipped += 1; continue; }
      // Put the date back so the next run retries instead of silently losing the escalation.
      await ClientContract.updateOne({ _id: item._id, nextEscalationDate: claimed.nextEscalationDate }, { $set: { nextEscalationDate: dueDate } });
      result.failures.push({ contract: item._id, message: error.message });
    }
  }
  return result;
};

// ─── Renewal ─────────────────────────────────────────────────────────────────
export const renewContractRecord = async ({ oldContract, startDate, endDate, notes = "", userId, activate = false, req = null }) => {
  const lines = upliftLines(effectiveContractLines(oldContract.toObject()), oldContract.escalationPercent);
  const contractNumber = await nextContractNumber(oldContract.business);
  const copy = oldContract.toObject();
  const newContract = new ClientContract({
    business: oldContract.business,
    client: oldContract.client,
    contractNumber,
    description: copy.description,
    contractType: copy.contractType,
    owner: copy.owner,
    property: copy.property,
    startDate,
    endDate,
    openEnded: false,
    minimumTermMonths: copy.minimumTermMonths,
    noticePeriodDays: copy.noticePeriodDays,
    autoRenew: copy.autoRenew,
    renewalTermMonths: copy.renewalTermMonths,
    lines: lines.map((l) => ({ ...l, startDate: null, endDate: null })),
    taxMode: copy.taxMode,
    billingCycle: copy.billingCycle,
    billingDay: copy.billingDay,
    prorationRule: copy.prorationRule,
    autoBill: copy.autoBill,
    poNumber: copy.poNumber,
    currency: copy.currency,
    escalationPercent: copy.escalationPercent,
    escalationPeriodYears: copy.escalationPeriodYears,
    paymentTermsDays: copy.paymentTermsDays,
    latePaymentInterestPercent: copy.latePaymentInterestPercent,
    latePaymentInterestBasis: copy.latePaymentInterestBasis,
    latePaymentGraceDays: copy.latePaymentGraceDays,
    depositAmount: 0,
    terms: copy.terms,
    slaText: copy.slaText,
    status: "draft",
    approvalStatus: activate ? "not_required" : "none",
    supersedesContractId: oldContract._id,
    notes,
    createdBy: userId,
    updatedBy: userId,
  });
  await newContract.save();

  oldContract.status = "renewed";
  oldContract.supersededByContractId = newContract._id;
  oldContract.renewalStage = "renewed";
  oldContract.updatedBy = userId;
  await oldContract.save();

  if (activate) await activateContractRecord({ contract: newContract, userId, req });
  await logAuditEvent({
    req, company: oldContract.business, action: "client_contract.renewed", category: "finance",
    targetType: "ClientContract", targetId: oldContract._id, targetName: oldContract.contractNumber,
    message: `Contract ${oldContract.contractNumber} renewed as ${newContract.contractNumber}${activate ? " (auto-renewal)" : ""}`,
  });
  return newContract;
};

// ─── Daily lifecycle job ─────────────────────────────────────────────────────
// Expires (or auto-renews) contracts past their end date and expires stale quotes.
export const processContractLifecycle = async ({ asOf = new Date() } = {}) => {
  const today = toUTCDate(asOf);
  const result = { expired: 0, autoRenewed: 0, quotesExpired: 0, failures: [] };
  const ended = await ClientContract.find({
    status: { $in: ["active", "pending_renewal"] },
    openEnded: { $ne: true },
    endDate: { $lt: today },
  });
  for (const contract of ended) {
    try {
      if (contract.autoRenew) {
        const startDate = addDaysUTC(toUTCDate(contract.endDate), 1);
        const endDate = addDaysUTC(addMonthsPreservingDayUTC(startDate, contract.renewalTermMonths || 12), -1);
        await renewContractRecord({ oldContract: contract, startDate, endDate, userId: null, activate: true, notes: "Auto-renewed" });
        result.autoRenewed += 1;
      } else {
        await ClientContract.updateOne({ _id: contract._id, status: contract.status }, { $set: { status: "expired", expiredAt: new Date() } });
        result.expired += 1;
      }
    } catch (error) {
      result.failures.push({ contract: contract._id, message: error.message });
    }
  }
  const quotes = await ClientQuote.updateMany(
    { status: { $in: ["draft", "sent"] }, validUntil: { $lt: today } },
    { $set: { status: "expired", expiredAt: new Date() } }
  );
  result.quotesExpired = quotes.modifiedCount || 0;
  return result;
};
