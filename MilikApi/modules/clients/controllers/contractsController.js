import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import { logAuditEvent } from "../../../utils/auditLogger.js";
import { emitToCompany } from "../../../utils/socketManager.js";
import ClientContract, { CONTRACT_STATUSES, CONTRACT_TYPES } from "../models/ClientContract.js";
import ClientContractVersion from "../models/ClientContractVersion.js";
import ClientBillingSchedule from "../models/ClientBillingSchedule.js";
import ClientInvoice from "../models/ClientInvoice.js";
import Client from "../models/Client.js";
import { resolveActiveBusinessId, currentUserId, escapeRegex } from "../services/businessScope.js";
import { nextContractNumber, nextInvoiceNumberForSeries } from "../services/clientSequenceService.js";
import {
  activateContractRecord,
  amendContract as amendContractRecord,
  decideContractVersion,
  evaluateApprovalReasons,
  getClientBillingSettings,
  renewContractRecord,
  runContractEscalations,
  sanitizeContractLines,
} from "../services/clientContractService.js";
import {
  changeScheduleRowStatus,
  holdScheduleForSuspension,
  releaseScheduleAfterSuspension,
  syncContractSchedule,
} from "../services/clientScheduleService.js";
import { getClientTaxContext, resolveClientLineTax } from "../services/clientTaxService.js";
import { addDaysUTC, monthsBetweenInclusive, toUTCDate } from "../services/clientLineMath.js";
import { round2 } from "../../../utils/math.js";

// ─── Sanitizers ──────────────────────────────────────────────────────────────

const ALLOWED_STATUSES      = CONTRACT_STATUSES;
const ALLOWED_BILLING_CYCLES = ["monthly", "quarterly", "annually"];
const ALLOWED_RENEWAL_STAGES = ["due", "contacted", "negotiating", "renewed", "lost"];

const has = (body, key) => Object.prototype.hasOwnProperty.call(body || {}, key);
const toBool = (v) => v === true || v === "true";
const objectIdOrNull = (v) => (v && mongoose.Types.ObjectId.isValid(String(v)) ? String(v) : null);

const sanitizeContractPayload = (body = {}) => {
  const baseValue    = Math.max(0, Number(body.baseValue || 0));
  const currentValue = body.currentValue != null ? Math.max(0, Number(body.currentValue)) : undefined;
  const openEnded    = toBool(body.openEnded);
  const billingDay   = Number(body.billingDay);

  return {
    client:               String(body.client || "").trim(),
    description:          String(body.description || "").trim(),
    contractType:         CONTRACT_TYPES.includes(body.contractType) ? body.contractType : "retainer",
    owner:                objectIdOrNull(body.owner),
    property:             objectIdOrNull(body.property),
    startDate:            body.startDate ? new Date(body.startDate) : null,
    endDate:              openEnded ? null : (body.endDate ? new Date(body.endDate) : null),
    openEnded,
    minimumTermMonths:    Math.max(0, Number(body.minimumTermMonths || 0)),
    noticePeriodDays:     Math.max(0, Number(body.noticePeriodDays ?? 30)),
    autoRenew:            toBool(body.autoRenew),
    renewalTermMonths:    Math.max(1, Number(body.renewalTermMonths || 12)),
    baseValue,
    currentValue:         currentValue !== undefined ? currentValue : baseValue,
    billingCycle:         ALLOWED_BILLING_CYCLES.includes(body.billingCycle) ? body.billingCycle : "monthly",
    taxMode:              body.taxMode === "inclusive" ? "inclusive" : "exclusive",
    billingDay:           billingDay >= 1 && billingDay <= 28 ? Math.trunc(billingDay) : null,
    prorationRule:        body.prorationRule === "daily" ? "daily" : "none",
    autoBill:             toBool(body.autoBill),
    poNumber:             String(body.poNumber || "").trim(),
    currency:             String(body.currency || "KES").trim().toUpperCase() || "KES",
    escalationPercent:    Math.min(100, Math.max(0, Number(body.escalationPercent ?? 10))),
    escalationPeriodYears: Math.max(1, Number(body.escalationPeriodYears ?? 2)),
    paymentTermsDays:     Math.max(0, Number(body.paymentTermsDays ?? 30)),
    latePaymentInterestPercent: Math.min(100, Math.max(0, Number(body.latePaymentInterestPercent || 0))),
    latePaymentInterestBasis: body.latePaymentInterestBasis === "annual" ? "annual" : "monthly",
    latePaymentGraceDays: Math.max(0, Math.trunc(Number(body.latePaymentGraceDays || 0))),
    depositAmount:        Math.max(0, Number(body.depositAmount || 0)),
    terms:                String(body.terms || "").trim(),
    slaText:              String(body.slaText || "").trim(),
    documentUrl:          String(body.documentUrl || "").trim(),
    notes:                String(body.notes || "").trim(),
  };
};

// Fields an active contract can still change without an amendment — they don't alter what is billed.
const NON_COMMERCIAL_FIELDS = [
  "description", "notes", "owner", "property", "contractType", "noticePeriodDays", "autoRenew",
  "renewalTermMonths", "autoBill", "documentUrl", "terms", "slaText", "poNumber",
];
const COMMERCIAL_FIELDS = [
  "startDate", "endDate", "openEnded", "baseValue", "currentValue", "billingCycle", "taxMode", "billingDay",
  "prorationRule", "currency", "escalationPercent", "escalationPeriodYears", "paymentTermsDays",
  "minimumTermMonths", "latePaymentInterestPercent", "latePaymentInterestBasis", "latePaymentGraceDays", "depositAmount",
];

const audit = (req, contract, action, message, metadata = {}) =>
  logAuditEvent({
    req,
    company: contract.business,
    action: `client_contract.${action}`,
    category: "finance",
    targetType: "ClientContract",
    targetId: contract._id,
    targetName: contract.contractNumber,
    message,
    metadata,
  });

const emitContract = (contract) =>
  emitToCompany(String(contract.business), "clients:contract:updated", { contractId: String(contract._id), status: contract.status });

const loadContract = async (req) => {
  const business = resolveActiveBusinessId(req);
  const contract = await ClientContract.findOne({ _id: req.params.id, business });
  if (!contract) throw createError(404, "Contract not found");
  return { business, contract };
};

// ─── Controllers ─────────────────────────────────────────────────────────────

export const listContracts = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter   = { business };

    if (req.query.clientId) filter.client = String(req.query.clientId).trim();
    if (req.query.status && ALLOWED_STATUSES.includes(req.query.status)) {
      filter.status = req.query.status;
    }
    if (req.query.contractType && CONTRACT_TYPES.includes(req.query.contractType)) filter.contractType = req.query.contractType;
    if (req.query.owner && mongoose.Types.ObjectId.isValid(String(req.query.owner))) filter.owner = String(req.query.owner);
    if (req.query.search) {
      const s = escapeRegex(String(req.query.search).trim());
      filter.$or = [
        { contractNumber: new RegExp(s, "i") },
        { description:   new RegExp(s, "i") },
        { poNumber:      new RegExp(s, "i") },
      ];
    }

    // Expiring within N days — always excludes open-ended contracts
    if (req.query.expiringDays) {
      const days = Math.max(1, Number(req.query.expiringDays));
      const now  = new Date();
      const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
      filter.openEnded = { $ne: true };
      filter.endDate   = { $gte: now, $lte: cutoff };
      if (!req.query.status) {
        filter.status = { $in: ["active", "pending_renewal"] };
      }
    }

    const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 200);
    const page  = Math.max(Number(req.query.page || 1), 1);
    const skip  = (page - 1) * limit;

    const [contracts, total] = await Promise.all([
      ClientContract.find(filter)
        .populate("client", "name clientCode email phone")
        .populate("owner", "surname otherNames")
        .sort({ endDate: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ClientContract.countDocuments(filter),
    ]);

    const pagination = { page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) };
    res.status(200).json({ success: true, data: { contracts, pagination }, contracts, pagination });
  } catch (error) {
    next(error);
  }
};

export const getContract = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const contract = await ClientContract.findOne({ _id: req.params.id, business })
      .populate("client", "name clientCode email phone taxPin")
      .populate("owner", "surname otherNames email")
      .populate("property", "propertyName propertyCode")
      .lean();
    if (!contract) return next(createError(404, "Contract not found"));
    const [pendingVersion, scheduleSummary] = await Promise.all([
      ClientContractVersion.findOne({ contract: contract._id, status: "pending_approval" }).select("_id version versionType effectiveDate changeSummary createdBy").lean(),
      ClientBillingSchedule.aggregate([
        { $match: { business: contract.business, contract: contract._id } },
        { $group: { _id: "$status", count: { $sum: 1 }, total: { $sum: "$totalAmount" } } },
      ]),
    ]);
    const enriched = { ...contract, pendingVersion, scheduleSummary };
    res.status(200).json({ success: true, data: enriched, contract: enriched });
  } catch (error) {
    next(error);
  }
};

const validateDates = (payload) => {
  if (!payload.startDate || Number.isNaN(payload.startDate.getTime())) {
    throw createError(400, "Valid startDate is required");
  }
  if (!payload.openEnded) {
    if (!payload.endDate || Number.isNaN(payload.endDate.getTime())) {
      throw createError(400, "endDate is required unless the contract is open-ended");
    }
    if (payload.endDate <= payload.startDate) {
      throw createError(400, "endDate must be after startDate");
    }
  }
};

export const createContract = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const payload  = sanitizeContractPayload(req.body);

    if (!payload.client) return next(createError(400, "Client is required"));
    validateDates(payload);

    // Verify client belongs to this business
    const clientExists = await Client.exists({ _id: payload.client, business });
    if (!clientExists) return next(createError(404, "Client not found"));

    const lines = await sanitizeContractLines({ business, lines: req.body.lines });
    if (!lines.length && !(payload.baseValue > 0)) {
      return next(createError(400, "Add at least one contract line (or a contract value)"));
    }

    const contractNumber = await nextContractNumber(business);
    const contract = await ClientContract.create({
      ...payload,
      lines,
      contractNumber,
      owner: payload.owner || userId,
      status: "draft",
      business,
      createdBy: userId,
      updatedBy: userId,
    });

    await audit(req, contract, "created", `Contract ${contractNumber} created (TCV ${contract.tcv})`);
    emitContract(contract);
    res.status(201).json({ success: true, data: contract, contract, message: "Contract created" });
  } catch (error) {
    next(error);
  }
};

export const updateContract = async (req, res, next) => {
  try {
    const { business, contract: existing } = await loadContract(req);
    const userId = currentUserId(req);

    if (["terminated", "cancelled", "expired", "renewed"].includes(existing.status)) {
      return next(createError(400, `Cannot update a ${existing.status} contract`));
    }

    // Drafts (and contracts sent back from approval) are fully editable.
    if (["draft", "pending_approval"].includes(existing.status)) {
      const payload = sanitizeContractPayload({ ...existing.toObject(), ...req.body, client: req.body.client || String(existing.client) });
      validateDates(payload);
      if (String(payload.client) !== String(existing.client) && !(await Client.exists({ _id: payload.client, business }))) {
        return next(createError(404, "Client not found"));
      }
      const lines = has(req.body, "lines")
        ? await sanitizeContractLines({ business, lines: req.body.lines, existingLines: existing.lines })
        : existing.lines;
      Object.assign(existing, payload, { lines, updatedBy: userId });
      if (existing.status === "pending_approval") {
        // Editing a contract under approval withdraws it — the approver must see the final terms.
        existing.status = "draft";
        existing.approvalStatus = "none";
      }
      await existing.save();
      await audit(req, existing, "updated", `Contract ${existing.contractNumber} updated`);
      emitContract(existing);
      return res.status(200).json({ success: true, data: existing, contract: existing, message: "Contract updated" });
    }

    // Live contracts: only fields that don't change billing; commercial changes go through /amend.
    const sanitized = sanitizeContractPayload({ ...existing.toObject(), ...req.body });
    const commercialChanges = COMMERCIAL_FIELDS.filter((field) => {
      if (!has(req.body, field)) return false;
      const a = sanitized[field];
      const b = existing[field];
      return a instanceof Date || b instanceof Date
        ? new Date(a || 0).getTime() !== new Date(b || 0).getTime()
        : String(a ?? "") !== String(b ?? "");
    });
    if (commercialChanges.length || has(req.body, "lines")) {
      return next(createError(400, `A ${existing.status} contract's commercial terms (${[...commercialChanges, ...(has(req.body, "lines") ? ["lines"] : [])].join(", ")}) can only change through an amendment (POST /:id/amend)`));
    }
    for (const field of NON_COMMERCIAL_FIELDS) {
      if (has(req.body, field)) existing[field] = sanitized[field];
    }
    existing.updatedBy = userId;
    await existing.save();
    await audit(req, existing, "updated", `Contract ${existing.contractNumber} details updated`);
    emitContract(existing);
    res.status(200).json({ success: true, data: existing, contract: existing, message: "Contract updated" });
  } catch (error) {
    next(error);
  }
};

export const updateRenewalStage = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);

    const renewalStage = req.body.renewalStage;
    if (renewalStage !== null && !ALLOWED_RENEWAL_STAGES.includes(renewalStage)) {
      return next(createError(400, `Invalid renewalStage. Must be one of: ${ALLOWED_RENEWAL_STAGES.join(", ")}`));
    }

    const lostReason = renewalStage === "lost" ? String(req.body.lostReason || "").trim() : undefined;
    const updateFields = { renewalStage, updatedBy: userId };
    if (lostReason !== undefined) updateFields.lostReason = lostReason;

    const contract = await ClientContract.findOneAndUpdate(
      { _id: req.params.id, business },
      updateFields,
      { new: true, runValidators: true }
    );
    if (!contract) return next(createError(404, "Contract not found"));

    await audit(req, contract, "renewal_stage", `Contract ${contract.contractNumber} renewal stage set to ${renewalStage}`);
    res.status(200).json({ success: true, data: contract, contract, message: "Renewal stage updated" });
  } catch (error) {
    next(error);
  }
};

export const renewContract = async (req, res, next) => {
  try {
    const { contract: oldContract } = await loadContract(req);
    const userId = currentUserId(req);

    if (["terminated", "cancelled", "draft", "pending_approval"].includes(oldContract.status)) {
      return next(createError(400, `Cannot renew a ${oldContract.status} contract`));
    }
    if (oldContract.status === "renewed") {
      return next(createError(400, "Contract has already been renewed"));
    }

    const startDate = req.body.startDate ? new Date(req.body.startDate) : null;
    const endDate   = req.body.endDate   ? new Date(req.body.endDate)   : null;
    const notes     = String(req.body.notes || "").trim();

    if (!startDate || Number.isNaN(startDate.getTime())) {
      return next(createError(400, "Valid startDate is required for renewal"));
    }
    if (!endDate || Number.isNaN(endDate.getTime())) {
      return next(createError(400, "Valid endDate is required for renewal"));
    }
    if (endDate <= startDate) {
      return next(createError(400, "endDate must be after startDate"));
    }

    const newContract = await renewContractRecord({ oldContract, startDate, endDate, notes, userId, req });
    res.status(201).json({
      success: true,
      data: newContract,
      contract: newContract,
      message: "Contract renewed successfully",
    });
  } catch (error) {
    next(error);
  }
};

// ─── Approval & lifecycle ────────────────────────────────────────────────────

export const submitContract = async (req, res, next) => {
  try {
    const { business, contract } = await loadContract(req);
    const userId = currentUserId(req);
    if (contract.status !== "draft") return next(createError(400, `Only a draft can be submitted (this contract is ${contract.status})`));

    const reasons = evaluateApprovalReasons(contract.toObject(), await getClientBillingSettings(business));
    contract.submittedBy = userId;
    contract.submittedAt = new Date();
    contract.approvalReasons = reasons;

    if (reasons.length) {
      contract.status = "pending_approval";
      contract.approvalStatus = "pending";
      contract.rejectionReason = "";
      contract.updatedBy = userId;
      await contract.save();
      await audit(req, contract, "submitted", `Contract ${contract.contractNumber} submitted for approval`, { reasons });
      emitContract(contract);
      return res.status(200).json({ success: true, data: contract, contract, requiresApproval: true, approvalReasons: reasons, message: "Submitted for approval" });
    }

    contract.approvalStatus = "not_required";
    await activateContractRecord({ contract, userId, req });
    res.status(200).json({ success: true, data: contract, contract, requiresApproval: false, approvalReasons: [], message: "Contract activated (no approval required)" });
  } catch (error) {
    next(error);
  }
};

export const approveContract = async (req, res, next) => {
  try {
    const { contract } = await loadContract(req);
    const userId = currentUserId(req);
    if (contract.status !== "pending_approval") return next(createError(400, `Contract is ${contract.status}, not awaiting approval`));
    if (userId && [contract.createdBy, contract.submittedBy].some((id) => id && String(id) === String(userId))) {
      return next(createError(403, "A contract must be approved by someone other than the person who created or submitted it"));
    }
    contract.approvalStatus = "approved";
    contract.approvedBy = userId;
    contract.approvedAt = new Date();
    await audit(req, contract, "approved", `Contract ${contract.contractNumber} approved`, { reasons: contract.approvalReasons });
    await activateContractRecord({ contract, userId, req });
    res.status(200).json({ success: true, data: contract, contract, message: "Contract approved and activated" });
  } catch (error) {
    next(error);
  }
};

export const rejectContract = async (req, res, next) => {
  try {
    const { contract } = await loadContract(req);
    const userId = currentUserId(req);
    const reason = String(req.body?.reason || "").trim();
    if (contract.status !== "pending_approval") return next(createError(400, `Contract is ${contract.status}, not awaiting approval`));
    if (!reason) return next(createError(400, "A rejection reason is required"));
    contract.status = "draft";
    contract.approvalStatus = "rejected";
    contract.rejectedBy = userId;
    contract.rejectedAt = new Date();
    contract.rejectionReason = reason;
    contract.updatedBy = userId;
    await contract.save();
    await audit(req, contract, "rejected", `Contract ${contract.contractNumber} rejected: ${reason}`);
    emitContract(contract);
    res.status(200).json({ success: true, data: contract, contract, message: "Contract rejected" });
  } catch (error) {
    next(error);
  }
};

export const activateContract = async (req, res, next) => {
  try {
    const { business, contract } = await loadContract(req);
    const userId = currentUserId(req);
    if (contract.status !== "draft") {
      return next(createError(400, `Contract is already '${contract.status}' and cannot be activated`));
    }
    const reasons = evaluateApprovalReasons(contract.toObject(), await getClientBillingSettings(business));
    if (reasons.length && contract.approvalStatus !== "approved") {
      return next(createError(400, `This contract needs approval before it can be activated: ${reasons.join("; ")}. Submit it for approval.`));
    }
    if (!reasons.length && contract.approvalStatus === "none") contract.approvalStatus = "not_required";
    await activateContractRecord({ contract, userId, req });
    res.status(200).json({ success: true, data: contract, contract, message: "Contract activated" });
  } catch (error) {
    next(error);
  }
};

export const suspendContract = async (req, res, next) => {
  try {
    const { contract } = await loadContract(req);
    const userId = currentUserId(req);
    const reason = String(req.body?.reason || "").trim();
    if (!["active", "pending_renewal"].includes(contract.status)) return next(createError(400, `A ${contract.status} contract cannot be suspended`));
    if (!reason) return next(createError(400, "A suspension reason is required"));
    const from = toUTCDate(req.body?.effectiveDate || new Date());
    if (!from) return next(createError(400, "Invalid effectiveDate"));

    contract.status = "suspended";
    contract.suspendedAt = from;
    contract.suspensionReason = reason;
    contract.updatedBy = userId;
    await contract.save();
    const held = await holdScheduleForSuspension({ contract, from });
    await audit(req, contract, "suspended", `Contract ${contract.contractNumber} suspended: ${reason}`, { from, heldPeriods: held.modifiedCount });
    emitContract(contract);
    res.status(200).json({ success: true, data: contract, contract, heldPeriods: held.modifiedCount, message: "Contract suspended" });
  } catch (error) {
    next(error);
  }
};

export const resumeContract = async (req, res, next) => {
  try {
    const { contract } = await loadContract(req);
    const userId = currentUserId(req);
    if (contract.status !== "suspended") return next(createError(400, "Only a suspended contract can be resumed"));
    const resumeDate = toUTCDate(req.body?.effectiveDate || new Date());
    if (!resumeDate) return next(createError(400, "Invalid effectiveDate"));

    contract.status = "active";
    contract.resumedAt = resumeDate;
    contract.updatedBy = userId;
    await contract.save();
    const released = await releaseScheduleAfterSuspension({ contract, resumeDate, userId });
    await syncContractSchedule({ contract });
    await audit(req, contract, "resumed", `Contract ${contract.contractNumber} resumed`, released);
    emitContract(contract);
    res.status(200).json({ success: true, data: contract, contract, ...released, message: "Contract resumed" });
  } catch (error) {
    next(error);
  }
};

export const terminateContract = async (req, res, next) => {
  try {
    const { business, contract } = await loadContract(req);
    const userId = currentUserId(req);

    if (["terminated", "renewed", "cancelled", "expired"].includes(contract.status)) {
      return next(createError(400, `Contract is already ${contract.status} and cannot be terminated`));
    }

    const reason = String(req.body?.reason || req.body?.lostReason || "").trim();
    const effectiveDate = toUTCDate(req.body?.effectiveDate || new Date());
    if (!effectiveDate) return next(createError(400, "Invalid effectiveDate"));
    if (effectiveDate < toUTCDate(contract.startDate)) return next(createError(400, "effectiveDate cannot be before the contract start date"));
    const fee = round2(Math.max(0, Number(req.body?.earlyTerminationFee || 0)));

    // Billed-in-advance periods beyond the termination date stay invoiced (credit them if refunding).
    const wasLive = !["draft", "pending_approval"].includes(contract.status);
    contract.status = "terminated";
    contract.renewalStage = "lost";
    contract.lostReason = reason;
    contract.terminationReason = reason;
    contract.terminatedAt = new Date();
    contract.terminationEffectiveDate = effectiveDate;
    contract.earlyTerminationFee = fee;
    contract.updatedBy = userId;
    await contract.save();
    if (wasLive) await syncContractSchedule({ contract });

    let terminationInvoice = null;
    if (fee > 0) {
      const [settings, taxCtx] = await Promise.all([getClientBillingSettings(business), getClientTaxContext(business)]);
      const tax = resolveClientLineTax(taxCtx, req.body?.feeTaxCodeKey || taxCtx.defaultCodeKey);
      terminationInvoice = await ClientInvoice.create({
        business,
        client: contract.client,
        contract: contract._id,
        contractVersion: contract.version,
        invoiceNumber: await nextInvoiceNumberForSeries(business, settings.invoicePrefix),
        series: String(settings.invoicePrefix || "CINV").toUpperCase(),
        poNumber: contract.poNumber,
        currency: contract.currency,
        taxCalculation: "line",
        taxMode: contract.taxMode,
        issueDate: new Date(),
        dueDate: addDaysUTC(toUTCDate(new Date()), Number(contract.paymentTermsDays ?? 30)),
        lineItems: [{ itemName: "Early termination fee", description: `Early termination fee — contract ${contract.contractNumber}`, quantity: 1, unitPrice: fee, ...tax }],
        notes: reason ? `Termination: ${reason}` : "",
        terms: settings.invoiceTerms || "",
        createdBy: userId,
      });
      contract.terminationInvoice = terminationInvoice._id;
      await contract.save();
    }

    const minimumTermMonths = Number(contract.minimumTermMonths || 0);
    const servedMonths = monthsBetweenInclusive(contract.startDate, addDaysUTC(effectiveDate, -1));
    await audit(req, contract, "terminated", `Contract ${contract.contractNumber} terminated effective ${effectiveDate.toISOString().slice(0, 10)}${reason ? `: ${reason}` : ""}`, {
      effectiveDate, earlyTerminationFee: fee, terminationInvoice: terminationInvoice?._id || null,
    });
    emitContract(contract);
    res.status(200).json({
      success: true,
      data: contract,
      contract,
      terminationInvoice,
      belowMinimumTerm: minimumTermMonths > 0 && servedMonths < minimumTermMonths,
      message: "Contract terminated",
    });
  } catch (error) {
    next(error);
  }
};

export const cancelContract = async (req, res, next) => {
  try {
    const { contract } = await loadContract(req);
    const userId = currentUserId(req);
    if (!["draft", "pending_approval"].includes(contract.status)) {
      return next(createError(400, `Only draft contracts can be cancelled — terminate a ${contract.status} contract instead`));
    }
    contract.status = "cancelled";
    contract.cancelledAt = new Date();
    contract.cancellationReason = String(req.body?.reason || "").trim();
    contract.updatedBy = userId;
    await contract.save();
    await audit(req, contract, "cancelled", `Contract ${contract.contractNumber} cancelled`);
    emitContract(contract);
    res.status(200).json({ success: true, data: contract, contract, message: "Contract cancelled" });
  } catch (error) {
    next(error);
  }
};

// ─── Amendments & versions ───────────────────────────────────────────────────

export const amendContract = async (req, res, next) => {
  try {
    const { contract } = await loadContract(req);
    const result = await amendContractRecord({ contract, input: req.body || {}, userId: currentUserId(req), req });
    res.status(result.needsApproval ? 202 : 200).json({
      success: true,
      data: result,
      contract: result.contract,
      version: result.version,
      requiresApproval: result.needsApproval,
      approvalReasons: result.approvalReasons,
      message: result.needsApproval ? "Amendment submitted for approval" : "Amendment applied",
    });
  } catch (error) {
    next(error);
  }
};

export const listContractVersions = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const exists = await ClientContract.exists({ _id: req.params.id, business });
    if (!exists) return next(createError(404, "Contract not found"));
    const versions = await ClientContractVersion.find({ business, contract: req.params.id })
      .populate("createdBy", "surname otherNames")
      .populate("approvedBy", "surname otherNames")
      .sort({ version: -1 })
      .lean();
    res.status(200).json({ success: true, data: versions, versions });
  } catch (error) {
    next(error);
  }
};

const decideVersion = (decision) => async (req, res, next) => {
  try {
    const { contract } = await loadContract(req);
    const result = await decideContractVersion({
      contract, versionId: req.params.versionId, decision, reason: req.body?.reason, userId: currentUserId(req), req,
    });
    res.status(200).json({ success: true, data: result, contract: result.contract, version: result.version });
  } catch (error) {
    next(error);
  }
};
export const approveContractVersion = decideVersion("approve");
export const rejectContractVersion = decideVersion("reject");

// ─── Billing schedule ────────────────────────────────────────────────────────

export const getContractSchedule = async (req, res, next) => {
  try {
    const { business, contract } = await loadContract(req);
    if (req.query.refresh === "true") await syncContractSchedule({ contract });
    const filter = { business, contract: contract._id };
    if (req.query.status) filter.status = String(req.query.status);
    const rows = await ClientBillingSchedule.find(filter).sort({ from: 1, lineKey: 1 }).lean();
    const summary = rows.reduce((acc, r) => {
      const s = acc[r.status] || { count: 0, net: 0, tax: 0, total: 0 };
      s.count += 1;
      s.net = round2(s.net + r.netAmount);
      s.tax = round2(s.tax + r.taxAmount);
      s.total = round2(s.total + r.totalAmount);
      acc[r.status] = s;
      return acc;
    }, {});
    res.status(200).json({ success: true, data: { rows, summary }, rows, summary });
  } catch (error) {
    next(error);
  }
};

export const changeSchedulePeriod = (action) => async (req, res, next) => {
  try {
    const { business, contract } = await loadContract(req);
    const row = await changeScheduleRowStatus({
      business, contractId: contract._id, rowId: req.params.rowId, action, reason: req.body?.reason, userId: currentUserId(req),
    });
    await audit(req, contract, `schedule_${action}`, `Contract ${contract.contractNumber} period ${row.periodKey} (${row.itemName}) ${action === "release" ? "released" : action === "hold" ? "held" : "skipped"}${row.statusReason ? `: ${row.statusReason}` : ""}`, { rowId: row._id, periodKey: row.periodKey });
    res.status(200).json({ success: true, data: row, row });
  } catch (error) {
    next(error);
  }
};

// ─── Escalation (manual trigger of the daily run) ────────────────────────────

export const runEscalations = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const asOf = req.body?.asOf ? new Date(req.body.asOf) : new Date();
    if (Number.isNaN(asOf.getTime())) return next(createError(400, "Invalid asOf date"));
    const contractId = objectIdOrNull(req.body?.contractId);
    const result = await runContractEscalations({ business, asOf, userId: currentUserId(req), contractId });
    await logAuditEvent({
      req, company: business, action: "client_contract.escalation_run", category: "finance",
      message: `Escalation run: ${result.escalated} applied, ${result.pendingApproval} awaiting approval`, metadata: result,
    });
    res.status(200).json({ success: true, data: result, ...result });
  } catch (error) {
    next(error);
  }
};
