// controllers/propertyController/lease.js
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import Lease from "../../models/Lease.js";
import Tenant from "../../models/Tenant.js";
import Unit from "../../models/Unit.js";
import { emitToCompany } from "../../utils/socketManager.js";
import { canonicalizeBillingPeriodKey } from "../../services/billingPeriodService.js";
import { generateLeasePdf } from "../../services/leasePdfService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LEASE_UPLOADS_DIR = path.join(__dirname, "../../uploads/leases");

const ACTIVE_LEASE_STATUSES = ["draft", "pending_signature", "active"];
const TERMINAL_LEASE_STATUSES = ["expired", "terminated", "renewed", "cancelled"];

const resolveBusinessId = (req, fallback = null) =>
  (req.user?.isSystemAdmin && (req.body?.business || req.query?.business)) ||
  fallback ||
  req.user?.company ||
  req.user?.business ||
  null;

const normalizeObjectId = (value) => {
  if (!value) return null;
  const raw = typeof value === "object" && value._id ? value._id : value;
  return mongoose.Types.ObjectId.isValid(String(raw)) ? String(raw) : null;
};

const normalizeString = (value, fallback = "") => {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
};

const normalizeLeaseType = (value, fallback = "fixed") => {
  const raw = String(value || fallback).trim().toLowerCase();
  return raw === "at_will" ? "at_will" : "fixed";
};

const normalizeLeaseStatus = (value, fallback = "active") => {
  const raw = String(value || fallback).trim().toLowerCase();
  return [
    "draft",
    "pending_signature",
    "active",
    "expired",
    "terminated",
    "renewed",
    "cancelled",
  ].includes(raw)
    ? raw
    : fallback;
};

const normalizeDay = (value, fallback = 5) => {
  const numeric = Number(value || fallback);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(28, Math.trunc(numeric)));
};

const normalizeMoney = (value, fallback = 0) => {
  const numeric = Number(value ?? fallback);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const resolvePrimaryLandlordIdFromProperty = (property = null) => {
  const landlords = Array.isArray(property?.landlords) ? property.landlords : [];
  const primary = landlords.find((entry) => entry?.isPrimary && entry?.landlordId) || landlords[0] || null;
  return normalizeObjectId(primary?.landlordId || null);
};

const addDays = (dateValue, days) => {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + Number(days || 0));
  return date;
};


const sanitizeRentReviewRecords = (rows = []) => {
  if (!Array.isArray(rows)) return [];

  return rows
    .filter((row) => row && row.id && row.effectiveDate)
    .map((row) => ({
      id: String(row.id),
      reviewType: ["review", "escalation"].includes(String(row.reviewType || "").trim().toLowerCase())
        ? String(row.reviewType || "").trim().toLowerCase()
        : "review",
      type: ["percentage", "amount"].includes(String(row.type || "").trim().toLowerCase())
        ? String(row.type || "").trim().toLowerCase()
        : "percentage",
      value: Number(row.value || 0),
      frequency: String(row.frequency || "yearly").trim().toLowerCase() || "yearly",
      effectiveDate: new Date(row.effectiveDate),
      note: row.note ? String(row.note) : "",
      status: ["Draft", "Scheduled", "Applied"].includes(String(row.status || "Scheduled"))
        ? String(row.status || "Scheduled")
        : "Scheduled",
      previousRent: Number(row.previousRent || 0),
      resultingRent: Number(row.resultingRent || 0),
      appliedAt: row.appliedAt ? new Date(row.appliedAt) : null,
      createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
      updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date(),
    }))
    .sort((a, b) => new Date(a.effectiveDate) - new Date(b.effectiveDate));
};

const sanitizeBillingScheduleAdjustments = (rows = []) => {
  if (!Array.isArray(rows)) return [];

  return rows
    .filter((row) => row && row.periodKey)
    .map((row) => ({
      periodKey: String(row.periodKey),
      fromDate: row.fromDate ? new Date(row.fromDate) : undefined,
      toDate: row.toDate ? new Date(row.toDate) : undefined,
      rentAmount: Number(row.rentAmount || 0),
      utilityAmount: Number(row.utilityAmount || 0),
      utilityNames: Array.isArray(row.utilityNames)
        ? row.utilityNames.filter(Boolean).map((item) => String(item))
        : [],
      status: ["active", "frozen", "deleted"].includes(String(row.status || "active"))
        ? String(row.status || "active")
        : "active",
      note: row.note ? String(row.note) : "",
      updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date(),
    }));
};

const populateLeaseQuery = (query) =>
  query
    .populate("tenant", "name tenantCode email phone idNumber leaseType moveInDate moveOutDate status")
    .populate("unit", "unitNumber unitName property rent status")
    .populate("unit.property", "propertyName propertyCode name address landlords")
    .populate("landlord", "landlordName landlordCode phoneNumber email");

const buildAgreementNumber = async (businessId) => {
  const year = new Date().getFullYear();
  const prefix = `AGR-${year}-`;
  const latest = await Lease.findOne({
    business: businessId,
    agreementNumber: { $regex: `^${prefix}` },
  })
    .sort({ createdAt: -1, agreementNumber: -1 })
    .select("agreementNumber")
    .lean();

  const lastSequence = latest?.agreementNumber
    ? Number(String(latest.agreementNumber).split("-").pop()) || 0
    : 0;

  return `${prefix}${String(lastSequence + 1).padStart(4, "0")}`;
};

const ensureTenantAndUnitMatchBusiness = async ({ businessId, tenantId, unitId } = {}) => {
  const tenant = await Tenant.findOne({ _id: tenantId, business: businessId })
    .populate("unit", "_id property")
    .lean();
  if (!tenant) {
    return { error: "Tenant not found for the selected company." };
  }

  const unit = await Unit.findOne({ _id: unitId, business: businessId })
    .populate("property", "landlords propertyName propertyCode name")
    .lean();
  if (!unit) {
    return { error: "Unit not found for the selected company." };
  }

  return { tenant, unit };
};

const ensureNoConflictingAgreement = async ({
  businessId,
  tenantId,
  unitId,
  excludeLeaseId = null,
  desiredStatus = "active",
} = {}) => {
  if (!ACTIVE_LEASE_STATUSES.includes(String(desiredStatus || "").toLowerCase())) {
    return null;
  }

  const filter = {
    business: businessId,
    tenant: tenantId,
    unit: unitId,
    status: { $in: ACTIVE_LEASE_STATUSES },
  };

  if (excludeLeaseId) {
    filter._id = { $ne: excludeLeaseId };
  }

  return Lease.findOne(filter).select("_id agreementNumber status").lean();
};

const sanitizeLeasePayload = async ({ req, payload = {}, existingLease = null } = {}) => {
  const businessId = resolveBusinessId(req, existingLease?.business);
  if (!businessId) {
    const error = new Error("Business context is required to manage agreements.");
    error.statusCode = 400;
    throw error;
  }

  const tenantId = normalizeObjectId(payload.tenant ?? existingLease?.tenant);
  const unitId = normalizeObjectId(payload.unit ?? existingLease?.unit);

  if (!tenantId || !unitId) {
    const error = new Error("Tenant and unit are required.");
    error.statusCode = 400;
    throw error;
  }

  const { tenant, unit, error: linkageError } = await ensureTenantAndUnitMatchBusiness({
    businessId,
    tenantId,
    unitId,
  });

  if (linkageError) {
    const error = new Error(linkageError);
    error.statusCode = 404;
    throw error;
  }

  const startDate = payload.startDate ? new Date(payload.startDate) : new Date(existingLease?.startDate || tenant?.moveInDate || Date.now());
  const endDate = payload.endDate ? new Date(payload.endDate) : new Date(existingLease?.endDate || tenant?.moveOutDate || addDays(startDate, 365));

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
    const error = new Error("Agreement end date must be after the start date.");
    error.statusCode = 400;
    throw error;
  }

  const status = normalizeLeaseStatus(payload.status, existingLease?.status || "active");
  const conflictingLease = await ensureNoConflictingAgreement({
    businessId,
    tenantId,
    unitId,
    excludeLeaseId: existingLease?._id,
    desiredStatus: status,
  });

  if (conflictingLease) {
    const error = new Error(
      `Another active agreement already exists for this tenant and unit${
        conflictingLease.agreementNumber ? ` (${conflictingLease.agreementNumber})` : ""
      }.`
    );
    error.statusCode = 400;
    throw error;
  }

  const agreementNumber = normalizeString(payload.agreementNumber || existingLease?.agreementNumber);

  return {
    business: businessId,
    agreementNumber: agreementNumber || (existingLease?.agreementNumber || (await buildAgreementNumber(businessId))),
    tenant: tenantId,
    unit: unitId,
    landlord:
      normalizeObjectId(
        payload.landlord || existingLease?.landlord || resolvePrimaryLandlordIdFromProperty(unit?.property)
      ) || null,
    leaseType: normalizeLeaseType(payload.leaseType, existingLease?.leaseType || tenant?.leaseType || "fixed"),
    startDate,
    endDate,
    rentAmount: normalizeMoney(payload.rentAmount, existingLease?.rentAmount ?? tenant?.rent ?? unit?.rent ?? 0),
    depositAmount: normalizeMoney(payload.depositAmount, existingLease?.depositAmount ?? tenant?.depositAmount ?? 0),
    paymentDueDay: normalizeDay(payload.paymentDueDay, existingLease?.paymentDueDay || 5),
    billingPeriodKey: canonicalizeBillingPeriodKey(
      payload.billingPeriodKey ??
        payload.billingFrequency ??
        existingLease?.billingPeriodKey ??
        existingLease?.billingFrequency ??
        unit?.billingPeriodKey ??
        unit?.billingFrequency ??
        "monthly"
    ),
    noticePeriodDays: Math.max(0, Number(payload.noticePeriodDays ?? existingLease?.noticePeriodDays ?? 30) || 0),
    lateFee: normalizeMoney(payload.lateFee, existingLease?.lateFee ?? 0),
    terms: normalizeString(payload.terms, existingLease?.terms || ""),
    status,
    documentUrl: normalizeString(payload.documentUrl, existingLease?.documentUrl || ""),
    documentName: normalizeString(payload.documentName, existingLease?.documentName || ""),
    signedByTenant: payload.signedByTenant !== undefined ? !!payload.signedByTenant : !!existingLease?.signedByTenant,
    signedByLandlord: payload.signedByLandlord !== undefined ? !!payload.signedByLandlord : !!existingLease?.signedByLandlord,
    signedDate:
      payload.signedDate !== undefined
        ? payload.signedDate
          ? new Date(payload.signedDate)
          : null
        : existingLease?.signedDate || null,
    terminationReason: normalizeString(payload.terminationReason, existingLease?.terminationReason || ""),
    terminatedAt:
      status === "terminated"
        ? payload.terminatedAt
          ? new Date(payload.terminatedAt)
          : existingLease?.terminatedAt || new Date()
        : null,
    activatedAt:
      status === "active"
        ? existingLease?.activatedAt || new Date()
        : existingLease?.activatedAt || null,
    version: Math.max(1, Number(payload.version ?? existingLease?.version ?? 1) || 1),
    renewalOf: normalizeObjectId(payload.renewalOf || existingLease?.renewalOf) || null,
    autoCreatedFromTenant:
      payload.autoCreatedFromTenant !== undefined
        ? !!payload.autoCreatedFromTenant
        : !!existingLease?.autoCreatedFromTenant,
    billingScheduleAdjustments:
      payload.billingScheduleAdjustments !== undefined
        ? sanitizeBillingScheduleAdjustments(payload.billingScheduleAdjustments)
        : existingLease?.billingScheduleAdjustments || [],
    rentReviewRecords:
      payload.rentReviewRecords !== undefined
        ? sanitizeRentReviewRecords(payload.rentReviewRecords)
        : existingLease?.rentReviewRecords || [],
  };
};

export const createLease = async (req, res, next) => {
  try {
    const payload = await sanitizeLeasePayload({ req, payload: req.body || {} });
    const newLease = new Lease(payload);
    const savedDoc = await newLease.save();
    const savedLease = await populateLeaseQuery(Lease.findById(savedDoc._id));

    emitToCompany(payload.business, "lease:new", savedLease);
    return res.status(201).json(savedLease);
  } catch (err) {
    next(err);
  }
};

export const getLeases = async (req, res, next) => {
  try {
    const { status, tenant, unit, property } = req.query;
    const business = resolveBusinessId(req);
    const filter = business ? { business } : {};

    if (status) filter.status = status;
    if (tenant) filter.tenant = tenant;
    if (unit) filter.unit = unit;
    if (property) {
      const propertyUnits = await Unit.find({ business, property }).select("_id").lean();
      filter.unit = { $in: propertyUnits.map((item) => item._id) };
    }

    const leases = await populateLeaseQuery(Lease.find(filter).sort({ startDate: -1, createdAt: -1 }));
    return res.status(200).json(leases);
  } catch (err) {
    next(err);
  }
};

export const getLease = async (req, res, next) => {
  try {
    const business = resolveBusinessId(req);
    const filter = business ? { _id: req.params.id, business } : { _id: req.params.id };
    const lease = await populateLeaseQuery(Lease.findOne(filter));

    if (!lease) return res.status(404).json({ message: "Lease not found" });
    return res.status(200).json(lease);
  } catch (err) {
    next(err);
  }
};

export const updateLease = async (req, res, next) => {
  try {
    const business = resolveBusinessId(req);
    const existingLease = await Lease.findOne(business ? { _id: req.params.id, business } : { _id: req.params.id });

    if (!existingLease) {
      return res.status(404).json({ message: "Lease not found" });
    }

    const updateData = await sanitizeLeasePayload({ req, payload: req.body || {}, existingLease });
    const updatedLease = await populateLeaseQuery(
      Lease.findByIdAndUpdate(existingLease._id, { $set: updateData }, { new: true, runValidators: true })
    );

    emitToCompany(updatedLease.business, "lease:updated", updatedLease);
    return res.status(200).json(updatedLease);
  } catch (err) {
    next(err);
  }
};

export const updateLeaseReviews = async (req, res, next) => {
  try {
    const business = resolveBusinessId(req);
    const lease = await Lease.findOne(business ? { _id: req.params.id, business } : { _id: req.params.id });
    if (!lease) return res.status(404).json({ message: "Lease not found" });

    const updates = {};
    if (req.body.rentReviewRecords !== undefined) {
      updates.rentReviewRecords = sanitizeRentReviewRecords(req.body.rentReviewRecords);
    }
    if (req.body.billingScheduleAdjustments !== undefined) {
      updates.billingScheduleAdjustments = sanitizeBillingScheduleAdjustments(req.body.billingScheduleAdjustments);
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No review fields provided" });
    }

    const updated = await populateLeaseQuery(
      Lease.findByIdAndUpdate(lease._id, { $set: updates }, { new: true, runValidators: true })
    );
    emitToCompany(updated.business, "lease:updated", updated);
    return res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
};

export const deleteLease = async (req, res, next) => {
  try {
    const business = resolveBusinessId(req);
    const filter = business ? { _id: req.params.id, business } : { _id: req.params.id };

    const lease = await Lease.findOne(filter).lean();
    if (!lease) {
      return res.status(404).json({ message: "Lease not found" });
    }

    if (!["draft", "cancelled"].includes(String(lease.status || "").toLowerCase())) {
      return res.status(400).json({ message: "Only draft or cancelled agreements can be deleted. Use terminate or renew to preserve agreement history." });
    }

    if (lease.signedByTenant || lease.signedByLandlord) {
      return res.status(400).json({ message: "Signed agreements cannot be deleted. Cancel the agreement instead to preserve audit history." });
    }

    if (lease.billingScheduleAdjustments?.some((item) => String(item?.status || "") === "active")) {
      return res.status(400).json({ message: "Delete or freeze billing adjustments before deleting the agreement." });
    }

    await Lease.findByIdAndDelete(lease._id);
    emitToCompany(lease.business, "lease:deleted", { _id: lease._id });
    return res.status(200).json({ message: "Lease deleted successfully" });
  } catch (err) {
    next(err);
  }
};

export const signLease = async (req, res, next) => {
  try {
    const business = resolveBusinessId(req);
    const lease = await Lease.findOne(business ? { _id: req.params.id, business } : { _id: req.params.id });

    if (!lease) return res.status(404).json({ message: "Lease not found" });

    const signedBy = String(req.body?.signedBy || "").trim().toLowerCase();
    const currentStatus = String(lease.status || "").toLowerCase();
    if (["renewed", "terminated", "cancelled"].includes(currentStatus)) {
      return res.status(400).json({ message: "This agreement can no longer be signed in its current status." });
    }
    const updateData = {};

    if (signedBy === "tenant") {
      updateData.signedByTenant = true;
    } else if (signedBy === "landlord") {
      updateData.signedByLandlord = true;
    } else {
      return res.status(400).json({ message: "signedBy must be tenant or landlord" });
    }

    const tenantSigned = signedBy === "tenant" ? true : lease.signedByTenant;
    const landlordSigned = signedBy === "landlord" ? true : lease.signedByLandlord;

    if (tenantSigned && landlordSigned) {
      updateData.signedDate = new Date();
      updateData.status = "active";
      updateData.activatedAt = lease.activatedAt || new Date();
    } else if (["draft", "pending_signature"].includes(String(lease.status || "").toLowerCase())) {
      updateData.status = "pending_signature";
    }

    const updatedLease = await populateLeaseQuery(
      Lease.findByIdAndUpdate(lease._id, { $set: updateData }, { new: true, runValidators: true })
    );

    emitToCompany(updatedLease.business, "lease:updated", updatedLease);
    return res.status(200).json(updatedLease);
  } catch (err) {
    next(err);
  }
};

export const getExpiringLeases = async (req, res, next) => {
  const { days = 30 } = req.query;
  try {
    const business = resolveBusinessId(req);
    const today = new Date();
    const futureDate = addDays(today, Number(days || 30));

    const leases = await populateLeaseQuery(
      Lease.find({
        business,
        status: "active",
        endDate: { $gte: today, $lte: futureDate },
      }).sort({ endDate: 1 })
    );

    return res.status(200).json(leases);
  } catch (err) {
    next(err);
  }
};

export const generateLeaseDocument = async (req, res, next) => {
  try {
    const business = resolveBusinessId(req);
    const filter = business ? { _id: req.params.id, business } : { _id: req.params.id };

    const lease = await Lease.findOne(filter)
      .populate("tenant", "name tenantCode email phone idNumber")
      .populate({
        path: "unit",
        select: "unitNumber unitName name property rent status",
        populate: { path: "property", select: "propertyName propertyCode name address" },
      })
      .populate("landlord", "landlordName phoneNumber email")
      .populate("business", "companyName name logo phoneNo phone email postalAddress POBOX roadStreet Street town City country slogan")
      .lean();

    if (!lease) return res.status(404).json({ message: "Lease not found" });

    const pdfBuffer = await generateLeasePdf(lease);

    fs.mkdirSync(LEASE_UPLOADS_DIR, { recursive: true });

    const safeAgreementNo = String(lease.agreementNumber || lease._id).replace(/[^a-zA-Z0-9\-_]/g, "_");
    const filename = `${safeAgreementNo}.pdf`;
    const filePath = path.join(LEASE_UPLOADS_DIR, filename);
    fs.writeFileSync(filePath, pdfBuffer);

    const protocol = req.protocol;
    const host = req.get("host");
    const documentUrl = `${protocol}://${host}/uploads/leases/${filename}`;
    const documentName = `Lease Agreement - ${lease.agreementNumber || "Document"}.pdf`;

    const updated = await populateLeaseQuery(
      Lease.findByIdAndUpdate(
        lease._id,
        { $set: { documentUrl, documentName } },
        { new: true, runValidators: true }
      )
    );

    emitToCompany(String(lease.business?._id || lease.business || ""), "lease:updated", updated);
    return res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
};

export const renewLease = async (req, res, next) => {
  try {
    const business = resolveBusinessId(req);
    const lease = await Lease.findOne(business ? { _id: req.params.id, business } : { _id: req.params.id });

    if (!lease) return res.status(404).json({ message: "Lease not found" });

    if (["renewed", "terminated", "cancelled"].includes(String(lease.status || "").toLowerCase())) {
      return res.status(400).json({ message: "Only active or expired agreements can be renewed." });
    }

    const previousEnd = lease.endDate ? new Date(lease.endDate) : new Date();
    const defaultStart = addDays(previousEnd, 1) || new Date();
    const renewalPayload = await sanitizeLeasePayload({
      req,
      payload: {
        ...req.body,
        tenant: lease.tenant,
        unit: lease.unit,
        landlord: lease.landlord,
        startDate: req.body?.newStartDate || req.body?.startDate || defaultStart,
        endDate: req.body?.newEndDate || req.body?.endDate,
        rentAmount: req.body?.newRentAmount ?? req.body?.rentAmount ?? lease.rentAmount,
        depositAmount: req.body?.depositAmount ?? lease.depositAmount,
        paymentDueDay: req.body?.paymentDueDay ?? lease.paymentDueDay,
        lateFee: req.body?.lateFee ?? lease.lateFee,
        noticePeriodDays: req.body?.noticePeriodDays ?? lease.noticePeriodDays,
        terms: req.body?.terms ?? lease.terms,
        status: req.body?.status || "active",
        signedByTenant: false,
        signedByLandlord: false,
        signedDate: null,
        version: Number(lease.version || 1) + 1,
        renewalOf: lease._id,
        autoCreatedFromTenant: false,
        billingScheduleAdjustments: [],
      },
    });

    await Lease.findByIdAndUpdate(lease._id, {
      $set: {
        status: "renewed",
        terminatedAt: lease.endDate || new Date(),
      },
    });

    const renewedLease = new Lease(renewalPayload);
    const savedDoc = await renewedLease.save();
    const savedLease = await populateLeaseQuery(Lease.findById(savedDoc._id));

    emitToCompany(savedLease.business, "lease:new", savedLease);
    return res.status(200).json(savedLease);
  } catch (err) {
    next(err);
  }
};
