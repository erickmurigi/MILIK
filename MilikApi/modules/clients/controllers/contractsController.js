import { createError } from "../../../utils/error.js";
import ClientContract from "../models/ClientContract.js";
import Client from "../models/Client.js";
import { resolveActiveBusinessId, currentUserId } from "../services/businessScope.js";
import { nextContractNumber } from "../services/clientSequenceService.js";

// ─── Sanitizers ──────────────────────────────────────────────────────────────

const ALLOWED_STATUSES      = ["draft", "active", "pending_renewal", "renewed", "terminated"];
const ALLOWED_BILLING_CYCLES = ["monthly", "quarterly", "annually"];
const ALLOWED_RENEWAL_STAGES = ["due", "contacted", "negotiating", "renewed", "lost"];

const sanitizeContractPayload = (body = {}) => {
  const baseValue    = Math.max(0, Number(body.baseValue || 0));
  const currentValue = body.currentValue != null ? Math.max(0, Number(body.currentValue)) : undefined;

  return {
    client:               String(body.client || "").trim(),
    description:          String(body.description || "").trim(),
    startDate:            body.startDate ? new Date(body.startDate) : null,
    endDate:              body.endDate   ? new Date(body.endDate)   : null,
    noticePeriodDays:     Math.max(0, Number(body.noticePeriodDays ?? 30)),
    baseValue,
    currentValue:         currentValue !== undefined ? currentValue : baseValue,
    billingCycle:         ALLOWED_BILLING_CYCLES.includes(body.billingCycle) ? body.billingCycle : "monthly",
    currency:             String(body.currency || "KES").trim().toUpperCase() || "KES",
    escalationPercent:    Math.min(100, Math.max(0, Number(body.escalationPercent ?? 10))),
    escalationPeriodYears: Math.max(1, Number(body.escalationPeriodYears ?? 2)),
    paymentTermsDays:     Math.max(0, Number(body.paymentTermsDays ?? 30)),
    status:               ALLOWED_STATUSES.includes(body.status) ? body.status : "draft",
    documentUrl:          String(body.documentUrl || "").trim(),
    notes:                String(body.notes || "").trim(),
  };
};

// Compute nextEscalationDate from startDate + escalationPeriodYears
const computeNextEscalationDate = (startDate, escalationPeriodYears) => {
  if (!startDate) return null;
  const d = new Date(startDate);
  if (Number.isNaN(d.getTime())) return null;
  d.setFullYear(d.getFullYear() + Number(escalationPeriodYears || 2));
  return d;
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

    // Expiring within N days
    if (req.query.expiringDays) {
      const days = Math.max(1, Number(req.query.expiringDays));
      const now  = new Date();
      const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
      filter.endDate = { $gte: now, $lte: cutoff };
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
      .populate("client", "name clientCode email phone")
      .lean();
    if (!contract) return next(createError(404, "Contract not found"));
    res.status(200).json({ success: true, data: contract, contract });
  } catch (error) {
    next(error);
  }
};

export const createContract = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const payload  = sanitizeContractPayload(req.body);

    if (!payload.client) return next(createError(400, "Client is required"));
    if (!payload.startDate || Number.isNaN(payload.startDate.getTime())) {
      return next(createError(400, "Valid startDate is required"));
    }
    if (!payload.endDate || Number.isNaN(payload.endDate.getTime())) {
      return next(createError(400, "Valid endDate is required"));
    }
    if (payload.endDate <= payload.startDate) {
      return next(createError(400, "endDate must be after startDate"));
    }

    // Verify client belongs to this business
    const clientExists = await Client.exists({ _id: payload.client, business });
    if (!clientExists) return next(createError(404, "Client not found"));

    const contractNumber = await nextContractNumber(business);
    const nextEscalationDate = computeNextEscalationDate(payload.startDate, payload.escalationPeriodYears);

    const contract = await ClientContract.create({
      ...payload,
      contractNumber,
      nextEscalationDate,
      business,
      createdBy: userId,
      updatedBy: userId,
    });

    res.status(201).json({ success: true, data: contract, contract, message: "Contract created" });
  } catch (error) {
    next(error);
  }
};

export const updateContract = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);

    const existing = await ClientContract.findOne({ _id: req.params.id, business });
    if (!existing) return next(createError(404, "Contract not found"));

    if (existing.status === "terminated") {
      return next(createError(400, "Cannot update a terminated contract"));
    }

    const payload = sanitizeContractPayload(req.body);
    if (payload.endDate && payload.startDate && payload.endDate <= payload.startDate) {
      return next(createError(400, "endDate must be after startDate"));
    }

    const nextEscalationDate = computeNextEscalationDate(
      payload.startDate || existing.startDate,
      payload.escalationPeriodYears || existing.escalationPeriodYears
    );

    const contract = await ClientContract.findOneAndUpdate(
      { _id: req.params.id, business },
      { ...payload, nextEscalationDate, updatedBy: userId },
      { new: true, runValidators: true }
    );

    res.status(200).json({ success: true, data: contract, contract, message: "Contract updated" });
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

    res.status(200).json({ success: true, data: contract, contract, message: "Renewal stage updated" });
  } catch (error) {
    next(error);
  }
};

export const renewContract = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);

    const oldContract = await ClientContract.findOne({ _id: req.params.id, business });
    if (!oldContract) return next(createError(404, "Contract not found"));

    if (oldContract.status === "terminated") {
      return next(createError(400, "Cannot renew a terminated contract"));
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

    // New value with escalation
    const newValue = Math.round(
      Number(oldContract.currentValue || oldContract.baseValue) *
        (1 + Number(oldContract.escalationPercent || 0) / 100) *
        100
    ) / 100;

    const contractNumber = await nextContractNumber(business);
    const nextEscalationDate = computeNextEscalationDate(startDate, oldContract.escalationPeriodYears);

    // Create new contract copying all relevant fields
    const newContract = await ClientContract.create({
      business,
      client:                 oldContract.client,
      contractNumber,
      description:            oldContract.description,
      startDate,
      endDate,
      noticePeriodDays:       oldContract.noticePeriodDays,
      baseValue:              newValue,
      currentValue:           newValue,
      billingCycle:           oldContract.billingCycle,
      currency:               oldContract.currency,
      escalationPercent:      oldContract.escalationPercent,
      escalationPeriodYears:  oldContract.escalationPeriodYears,
      nextEscalationDate,
      paymentTermsDays:       oldContract.paymentTermsDays,
      status:                 "draft",
      documentUrl:            "",
      supersedesContractId:   oldContract._id,
      notes,
      createdBy: userId,
      updatedBy: userId,
    });

    // Mark old contract as renewed
    oldContract.status                = "renewed";
    oldContract.supersededByContractId = newContract._id;
    oldContract.renewalStage          = "renewed";
    oldContract.updatedBy             = userId;
    await oldContract.save();

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

export const activateContract = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);

    const contract = await ClientContract.findOneAndUpdate(
      { _id: req.params.id, business, status: "draft" },
      { status: "active", updatedBy: userId },
      { new: true, runValidators: true }
    );

    if (!contract) {
      const existing = await ClientContract.findOne({ _id: req.params.id, business }).lean();
      if (!existing) return next(createError(404, "Contract not found"));
      return next(createError(400, `Contract is already '${existing.status}' and cannot be activated`));
    }

    res.status(200).json({ success: true, data: contract, contract, message: "Contract activated" });
  } catch (error) {
    next(error);
  }
};

export const terminateContract = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);

    const lostReason = String(req.body.lostReason || "").trim();

    const contract = await ClientContract.findOneAndUpdate(
      { _id: req.params.id, business, status: { $nin: ["terminated", "renewed"] } },
      {
        status:       "terminated",
        renewalStage: "lost",
        lostReason,
        updatedBy:    userId,
      },
      { new: true, runValidators: true }
    );

    if (!contract) {
      const existing = await ClientContract.findOne({ _id: req.params.id, business }).lean();
      if (!existing) return next(createError(404, "Contract not found"));
      return next(createError(400, `Contract is already ${existing.status} and cannot be terminated`));
    }

    res.status(200).json({ success: true, data: contract, contract, message: "Contract terminated" });
  } catch (error) {
    next(error);
  }
};
