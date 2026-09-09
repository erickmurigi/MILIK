import mongoose from "mongoose";
import { getFieldOfficerPropertyIds } from "../../utils/fieldOfficerScope.js";
import Tenant from "../../models/Tenant.js";
import Unit from "../../models/Unit.js";
import Property from "../../models/Property.js";
import RentPayment from "../../models/RentPayment.js";
import TenantInvoice from "../../models/TenantInvoice.js";
import TenantInvoiceNote from "../../models/TenantInvoiceNote.js";
import Lease from "../../models/Lease.js";
import Receipt from "../../models/Receipts.js";
import LatePenaltyBatch from "../../models/LatePenaltyBatch.js";
import MpesaCollection from "../../models/MpesaCollection.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import SequenceCounter from "../../models/SequenceCounter.js";
import LandlordStatementLine from "../../models/LandlordStatementLine.js";
import Landlord from "../../models/Landlord.js";
import Maintenance from "../../models/Maintenance.js";
import Inspection from "../../models/Inspection.js";
import MeterReading from "../../models/MeterReading.js";
import { createTenantInvoiceRecord, resolveLeaseAgreementFeeIncomeAccount } from "./tenantInvoices.js";
import { isAgreementNumberDuplicateError, saveLeaseWithUniqueAgreementNumber } from "../../services/agreementNumberService.js";
import { logAuditEvent } from "../../utils/auditLogger.js";
import { resolveBusinessId } from "../../utils/requestContext.js";
import { createError } from "../../utils/error.js";


const ACTIVE_TENANT_STATUSES = ["active", "overdue"];
const VALID_PAYMENT_METHODS = ["bank_transfer", "mobile_money", "cash", "check", "credit_card"];

const normalizePropertyServiceMode = (value = "Managing") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "letting") return "Letting";
  if (normalized === "both") return "Both";
  return "Managing";
};

const hasLettingFee = (mode) => {
  const v = String(mode || "").trim().toLowerCase();
  return v === "letting" || v === "both";
};

const tenantLabel = (tenant = {}) => tenant?.name || tenant?.tenantCode || String(tenant?._id || "tenant");

const getPrimaryLandlordIdFromProperty = (propertyDoc = {}) => {
  const landlords = Array.isArray(propertyDoc?.landlords) ? propertyDoc.landlords : [];
  const primary = landlords.find((item) => item?.isPrimary && item?.landlordId);
  const fallback = landlords.find((item) => item?.landlordId);
  return String(primary?.landlordId || fallback?.landlordId || "");
};

const buildLeaseAgreementFeeIdempotencyKey = ({ businessId, tenantId, unitId, propertyId, moveInDate = null, amount = 0 }) => {
  const keyParts = [
    "lease_agreement_fee",
    String(businessId || "").trim(),
    String(tenantId || "").trim(),
    String(unitId || "").trim(),
    String(propertyId || "").trim(),
    String(moveInDate || "").trim(),
    Number(amount || 0).toFixed(2),
  ].filter(Boolean);

  return keyParts.join(":");
};

const isValidObjectIdString = (value) =>
  typeof value === "string" && mongoose.Types.ObjectId.isValid(value);

const toObjectIdString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const uniqueUnitIds = (values = []) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [values])
        .map((item) => toObjectIdString(item))
        .filter((item) => isValidObjectIdString(item))
    )
  );

const getTenantAssignedUnitIds = (tenant = {}) => {
  const primary = toObjectIdString(tenant?.unit);
  const additional = uniqueUnitIds(tenant?.additionalUnits || []).filter((item) => item !== primary);
  return primary ? [primary, ...additional] : additional;
};

const buildRequestedTenantUnits = ({ primaryUnitId, additionalUnits = [] } = {}) => {
  const primary = toObjectIdString(primaryUnitId);
  const normalizedAdditional = uniqueUnitIds(additionalUnits).filter((item) => item !== primary);
  return {
    primary,
    additional: normalizedAdditional,
    all: primary ? [primary, ...normalizedAdditional] : normalizedAdditional,
  };
};

const PROPERTY_SELECT = "propertyName propertyCode address name propertyType depositHeldBy";
const UNIT_SELECT     = "unitNumber property rent status utilities";

const populateTenantQuery = (query) =>
  query
    .populate({ path: "unit",            select: UNIT_SELECT,     populate: { path: "property", select: PROPERTY_SELECT } })
    .populate({ path: "additionalUnits", select: UNIT_SELECT,     populate: { path: "property", select: PROPERTY_SELECT } });

const calculateTenantAssignedRent = (unitDocs = [], fallback = 0) => {
  const total = unitDocs.reduce((sum, unit) => sum + Number(unit?.rent || 0), 0);
  return total > 0 ? total : Number(fallback || 0);
};

const ensureUnitsBelongToBusiness = async ({ businessId, unitIds = [] } = {}) => {
  const normalizedIds = uniqueUnitIds(unitIds);
  const unitDocs = await Unit.find({
    _id: { $in: normalizedIds },
    business: businessId,
  }).populate("property", "depositHeldBy landlords letManage lettingFeeMode lettingFeeValue").lean();

  if (unitDocs.length !== normalizedIds.length) {
    const error = new Error("One or more selected units were not found for the selected company");
    error.statusCode = 404;
    throw error;
  }

  return unitDocs;
};

const ensureUnitsAvailableForTenant = async ({
  businessId,
  unitDocs = [],
  currentTenantId = null,
  currentlyAssignedUnitIds = [],
} = {}) => {
  const currentlyAssigned = new Set(uniqueUnitIds(currentlyAssignedUnitIds));

  const conflictingTenant = await Tenant.findOne({
    business: businessId,
    _id: currentTenantId ? { $ne: currentTenantId } : { $exists: true },
    status: { $in: ACTIVE_TENANT_STATUSES },
    $or: [
      { unit: { $in: unitDocs.map((unit) => unit._id) } },
      { additionalUnits: { $in: unitDocs.map((unit) => unit._id) } },
    ],
  })
    .select("name tenantCode unit additionalUnits")
    .lean();

  if (conflictingTenant) {
    const error = new Error("One or more selected units are already assigned to another active tenant");
    error.statusCode = 400;
    throw error;
  }

  for (const unit of unitDocs) {
    const unitId = String(unit._id);
    if (currentlyAssigned.has(unitId)) continue;

    const normalizedStatus = String(unit.status || "").trim().toLowerCase();
    const normalizedIsVacant = unit.isVacant !== false;
    if (normalizedStatus !== "vacant" || !normalizedIsVacant) {
      const error = new Error(`Unit ${unit.unitNumber || unitId} is not available`);
      error.statusCode = 400;
      throw error;
    }
  }
};

const syncTenantAssignedUnitOccupancy = async ({
  previousUnitIds = [],
  nextUnitIds = [],
  tenantId,
  effectiveDate = new Date(),
} = {}) => {
  const previous = new Set(uniqueUnitIds(previousUnitIds));
  const next = new Set(uniqueUnitIds(nextUnitIds));

  const toVacate = Array.from(previous).filter((unitId) => !next.has(unitId));
  const toOccupy = Array.from(next).filter((unitId) => !previous.has(unitId));

  const units = await Promise.all([
    ...toVacate.map((unitId) => setUnitVacant(unitId, tenantId, effectiveDate)),
    ...toOccupy.map((unitId) => setUnitOccupied(unitId, tenantId)),
  ]);

  // Update property counts once per unique property rather than once per unit.
  const propertyIds = new Set(units.filter(Boolean).map((u) => u.property && String(u.property)).filter(Boolean));
  await Promise.all([...propertyIds].map((id) => updatePropertyUnitCounts(id)));
};



const normalizeString = (value) => (typeof value === "string" ? value.trim() : value);

// Normalise Kenyan phone numbers to the local 0XXXXXXXXX (10-digit) format for storage.
// Handles: +254712345678 / 254712345678 / 0712345678 / 712345678 (9 digits missing leading 0)
const normalizeKenyanPhoneForStorage = (value) => {
  // Normalize each segment so both display correctly (e.g. "79060740/0724383809" → "079060740/0724383809")
  // SMS sending uses only the first segment — see normalizePhoneNumber in communicationService.js
  const segments = String(value || "").trim().split(/[\/,]/).map((seg) => {
    const raw = seg.trim().replace(/\D/g, "");
    if (!raw) return null;
    if (raw.startsWith("254") && raw.length === 12) return `0${raw.slice(3)}`; // 254712345678 → 0712345678
    if (raw.startsWith("0") && raw.length === 10) return raw;                  // already correct
    if (raw.length === 9) return `0${raw}`;                                    // 712345678 → 0712345678
    return raw;                                                                 // unknown format — store as-is
  }).filter(Boolean);
  return segments.length ? segments.join("/") : null;
};

const isPlaceholder = (value) => {
  if (value === null || value === undefined) return true;
  const s = String(value).trim().toLowerCase();
  return s === "" || s === "-" || s === "--" || s === "n/a" || s === "na" || s === "none";
};

const normalizeLower = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : value;


const normalizeTenantStatus = (value, fallback = "active") => {
  const normalized = normalizeLower(value || fallback) || fallback;

  if (normalized === "moved_out") {
    return "terminated";
  }

  if (["active", "inactive", "terminated", "evicted", "overdue"].includes(normalized)) {
    return normalized;
  }

  return normalizeLower(fallback || "active") || "active";
};

const normalizeDepositHolder = (value, propertyFallback = "propertyManager") => {
  const raw = String(value || "").trim().toLowerCase();

  if (raw === "management company" || raw === "propertymanager" || raw === "property_manager") {
    return "Management Company";
  }

  if (raw === "landlord") {
    return "Landlord";
  }

  return propertyFallback === "landlord" ? "Landlord" : "Management Company";
};

const computeOperationalTenantStatus = ({ tenant = {} }) => {
  const currentStatus = String(tenant?.status || "active").trim().toLowerCase();

  if (["terminated", "moved_out"].includes(currentStatus)) {
    return "terminated";
  }

  if (["inactive", "evicted"].includes(currentStatus)) {
    return currentStatus;
  }

  return "active";
};

const resolvePrimaryLandlordIdFromProperty = (property = null) => {
  const landlords = Array.isArray(property?.landlords) ? property.landlords : [];
  const primary = landlords.find((entry) => entry?.isPrimary && entry?.landlordId) || landlords[0] || null;
  return primary?.landlordId ? String(primary.landlordId) : null;
};

const shouldTenantOccupyUnits = (tenantOrStatus) => {
  const normalizedStatus = normalizeTenantStatus(
    typeof tenantOrStatus === "string" ? tenantOrStatus : tenantOrStatus?.status || "active"
  );
  return ACTIVE_TENANT_STATUSES.includes(normalizedStatus);
};


const addDays = (dateValue, days = 0) => {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + Number(days || 0));
  return date;
};

const syncTenantLeaseRecord = async ({
  tenantDoc,
  unitDoc = null,
  action = "upsert",
  effectiveDate = null,
  terminationReason = "",
} = {}) => {
  if (!tenantDoc?._id || !tenantDoc?.business) return null;

  const tenantId = tenantDoc._id;
  const businessId = tenantDoc.business;
  const normalizedLeaseType = normalizeLower(tenantDoc.leaseType || "at_will");
  const normalizedTenantStatus = normalizeTenantStatus(tenantDoc.status || "active");
  const activeLease = await Lease.findOne({
    business: businessId,
    tenant: tenantId,
    status: { $in: ["draft", "pending_signature", "active"] },
  }).sort({ createdAt: -1 });

  if (action === "terminate" || normalizedTenantStatus === "terminated") {
    if (!activeLease) return null;

    const terminationDate = effectiveDate
      ? new Date(effectiveDate)
      : tenantDoc.moveOutDate
        ? new Date(tenantDoc.moveOutDate)
        : new Date();

    activeLease.status = "terminated";
    activeLease.endDate = terminationDate;
    activeLease.terminatedAt = terminationDate;
    activeLease.terminationReason = terminationReason || tenantDoc.terminationReason || activeLease.terminationReason || "";
    return saveLeaseWithUniqueAgreementNumber(activeLease, { businessId });
  }

  const resolvedUnit =
    unitDoc ||
    (tenantDoc.unit ? await Unit.findById(tenantDoc.unit).populate("property", "landlords").lean() : null);
  if (!resolvedUnit?._id) return activeLease || null;

  const startDate = tenantDoc.moveInDate ? new Date(tenantDoc.moveInDate) : new Date(tenantDoc.createdAt || Date.now());
  if (Number.isNaN(startDate.getTime())) {
    return activeLease || null;
  }

  const endDate = normalizedLeaseType === "fixed"
    ? (tenantDoc.moveOutDate ? new Date(tenantDoc.moveOutDate) : addDays(startDate, 365))
    : null;

  if (normalizedLeaseType === "fixed") {
    if (!endDate || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
      return activeLease || null;
    }
  }

  const payload = {
    tenant: tenantId,
    unit: resolvedUnit._id,
    landlord: resolvePrimaryLandlordIdFromProperty(resolvedUnit?.property) || null,
    business: businessId,
    leaseType: normalizedLeaseType === "fixed" ? "fixed" : "at_will",
    startDate,
    endDate,
    rentAmount: Number(tenantDoc.rent || resolvedUnit.rent || 0),
    depositAmount: Number(tenantDoc.depositAmount || 0),
    paymentDueDay: 5,
    noticePeriodDays: 30,
    lateFee: Number(activeLease?.lateFee || 0),
    terms: normalizeString(activeLease?.terms || ""),
    status: "active",
    activatedAt: activeLease?.activatedAt || new Date(),
    autoCreatedFromTenant: true,
  };

  if (activeLease) {
    Object.assign(activeLease, payload);
    return saveLeaseWithUniqueAgreementNumber(activeLease, { businessId });
  }

  // On restore, re-activate the terminated lease rather than creating a duplicate record
  if (action === "restore") {
    const terminatedLease = await Lease.findOne({ business: businessId, tenant: tenantId, status: "terminated" }).sort({ createdAt: -1 });
    if (terminatedLease) {
      Object.assign(terminatedLease, { ...payload, terminatedAt: null, terminationReason: "" });
      return saveLeaseWithUniqueAgreementNumber(terminatedLease, { businessId });
    }
  }

  const newLease = new Lease(payload);
  return saveLeaseWithUniqueAgreementNumber(newLease, { businessId, dateValue: startDate });
};

const sanitizeUtilities = (utilities = []) => {
  if (!Array.isArray(utilities)) return [];

  const mergedUtilities = new Map();

  utilities.forEach((item) => {
    const utility = normalizeString(item?.utility) || normalizeString(item?.utilityLabel) || "";
    const utilityLabel = normalizeString(item?.utilityLabel) || utility;
    const unitCharge = Number(item?.unitCharge || 0);
    const isIncluded = !!item?.isIncluded;

    if (!utility && !utilityLabel) {
      return;
    }

    const signature = [String(utility || "").toLowerCase(), String(utilityLabel || "").toLowerCase(), isIncluded ? "1" : "0"].join("|");
    const current = mergedUtilities.get(signature) || {
      utility,
      utilityLabel,
      unitCharge: 0,
      isIncluded,
    };

    current.unitCharge = Number(current.unitCharge || 0) + unitCharge;
    if (!current.utility && utility) current.utility = utility;
    if (!current.utilityLabel && utilityLabel) current.utilityLabel = utilityLabel;

    mergedUtilities.set(signature, current);
  });

  return Array.from(mergedUtilities.values()).map((item) => ({
    utility: item.utility || item.utilityLabel || "",
    utilityLabel: item.utilityLabel || item.utility || "",
    unitCharge: Number(item.unitCharge || 0),
    isIncluded: !!item.isIncluded,
  }));
};

const deriveAssignedUtilitiesFromUnitDocs = (unitDocs = []) =>
  sanitizeUtilities(
    (Array.isArray(unitDocs) ? unitDocs : []).flatMap((unit) =>
      (Array.isArray(unit?.utilities) ? unit.utilities : []).map((item) => ({
        utility: normalizeString(item?.utility) || "",
        utilityLabel: normalizeString(item?.utilityLabel) || normalizeString(item?.utility) || "",
        unitCharge: Number(item?.unitCharge || 0),
        isIncluded: !!item?.isIncluded,
      }))
    )
  );

const normalizePaymentMethod = (value) => {
  const normalized = normalizeLower(value || "bank_transfer") || "bank_transfer";
  return VALID_PAYMENT_METHODS.includes(normalized) ? normalized : "bank_transfer";
};

const normalizeImportedAdditionalUnitNumbers = (record = {}) => {
  if (Array.isArray(record?.additionalUnitNumbers)) {
    return Array.from(new Set(record.additionalUnitNumbers.map((item) => normalizeString(item)).filter(Boolean)));
  }

  const rawValue =
    record?.additionalUnits ||
    record?.additionalUnitNumbers ||
    record?.additionalUnitNumbersCsv ||
    "";

  return Array.from(
    new Set(
      String(rawValue || "")
        .split(/[;,|]/)
        .map((item) => normalizeString(item))
        .filter(Boolean)
    )
  );
};

const sanitizeDocuments = (documents = []) => {
  if (!Array.isArray(documents)) return [];
  return documents.map((doc) => ({
    name: normalizeString(doc?.name) || "",
    url: normalizeString(doc?.url) || "",
    uploadedAt: doc?.uploadedAt || new Date(),
  }));
};

const sanitizeEmergencyContact = (contact = {}) => ({
  name: normalizeString(contact?.name) || "",
  phone: normalizeString(contact?.phone) || "",
  relationship: normalizeString(contact?.relationship) || "",
});

const authorizeTenantAccess = (req, tenant) => {
  if (!tenant) {
    return { allowed: false, status: 404, message: "Tenant not found" };
  }

  if (req.user?.isSystemAdmin) {
    return { allowed: true };
  }

  const businessId = resolveBusinessId(req);
  if (!businessId || String(tenant.business) !== String(businessId)) {
    return {
      allowed: false,
      status: 403,
      message: "Not authorized to access this tenant",
    };
  }

  return { allowed: true };
};

const generateNextTenantCode = async (businessId) => {
  const counter = await SequenceCounter.findOneAndUpdate(
    { business: String(businessId), key: "tenant_code" },
    { $inc: { sequence: 1 } },
    { upsert: true, new: true }
  ).lean();
  return `TT${String(counter.sequence).padStart(4, "0")}`;
};

// On a tenantCode E11000, resync the counter to the actual highest code in the
// DB so subsequent retries skip any gap left by imports or previously failed saves.
const resyncTenantCodeCounter = async (businessId) => {
  const latest = await Tenant.findOne(
    { business: String(businessId), tenantCode: { $regex: /^TT\d+$/i } },
    { tenantCode: 1 }
  ).sort({ tenantCode: -1 }).lean();

  const maxSeq = latest?.tenantCode
    ? parseInt(String(latest.tenantCode).replace(/^TT/i, ""), 10) || 0
    : 0;

  if (maxSeq > 0) {
    await SequenceCounter.updateOne(
      { business: String(businessId), key: "tenant_code", sequence: { $lt: maxSeq } },
      { $set: { sequence: maxSeq } }
    );
  }
};

const updatePropertyUnitCounts = async (propertyId) => {
  try {
    const [agg] = await Unit.aggregate([
      { $match: { property: new mongoose.Types.ObjectId(String(propertyId)) } },
      {
        $group: {
          _id: null,
          totalCount: { $sum: 1 },
          occupiedCount: { $sum: { $cond: [{ $eq: ["$status", "occupied"] }, 1, 0] } },
          vacantCount: { $sum: { $cond: [{ $eq: ["$status", "vacant"] }, 1, 0] } },
        },
      },
    ]);

    const totalCount = agg?.totalCount ?? 0;
    const occupiedCount = agg?.occupiedCount ?? 0;
    const vacantCount = agg?.vacantCount ?? 0;

    await Property.findByIdAndUpdate(propertyId, {
      totalUnits: totalCount,
      occupiedUnits: occupiedCount,
      vacantUnits: vacantCount,
    });

    return { totalCount, occupiedCount, vacantCount };
  } catch (error) {
    console.error("Error updating property unit counts:", error);
    throw error;
  }
};

const setUnitOccupied = async (unitId, tenantId) => {
  // Atomic: only update if the unit isn't already occupied, preventing double-occupancy races.
  const unit = await Unit.findOneAndUpdate(
    { _id: unitId, isVacant: { $ne: false } },
    { $set: { status: "occupied", isVacant: false, vacantSince: null, daysVacant: 0, lastTenant: tenantId } },
    { new: false, runValidators: false }
  );

  if (!unit) {
    // Pre-validation in ensureUnitsBelongToBusiness guarantees the unit exists and is vacant —
    // a null result here means a concurrent request already occupied it.
    const err = new Error(`Unit is already occupied and cannot be assigned to another tenant.`);
    err.statusCode = 409;
    throw err;
  }

  return unit;
};


const setUnitVacant = async (unitId, tenantId, effectiveDate = new Date()) => {
  const unit = await Unit.findById(unitId).lean();
  if (!unit) return null;

  const replacementOccupant = await Tenant.findOne({
    business: unit.business,
    _id: tenantId ? { $ne: tenantId } : { $exists: true },
    status: { $in: ACTIVE_TENANT_STATUSES },
    $or: [{ unit: unit._id }, { additionalUnits: unit._id }],
  })
    .select("_id")
    .lean();

  const resolvedVacantSince = effectiveDate ? new Date(effectiveDate) : new Date();
  const safeVacantSince = Number.isNaN(resolvedVacantSince.getTime()) ? new Date() : resolvedVacantSince;

  if (replacementOccupant?._id) {
    await Unit.findByIdAndUpdate(unitId, {
      status: "occupied",
      isVacant: false,
      vacantSince: null,
      daysVacant: 0,
      lastTenant: replacementOccupant._id,
    });
  } else {
    await Unit.findByIdAndUpdate(unitId, {
      status: "vacant",
      isVacant: true,
      vacantSince: safeVacantSince,
      daysVacant: 0,
      lastTenant: tenantId || unit.lastTenant || null,
    });
  }

  return unit;
};

const getTenantDependencySummary = async (tenant) => {
  if (!tenant?._id) {
    return { summary: {}, hasDependencies: false };
  }

  const tenantId = tenant._id;
  const businessId = tenant.business;

  const [
    rentPayments,
    receipts,
    invoices,
    invoiceNotes,
    leases,
    latePenaltyBatches,
    mpesaCollections,
    ledgerEntries,
    landlordStatementLines,
    maintenance,
    inspections,
    meterReadings,
  ] = await Promise.all([
    RentPayment.countDocuments({ tenant: tenantId, business: businessId }),
    Receipt.countDocuments({ tenant: tenantId, business: businessId }),
    TenantInvoice.countDocuments({ tenant: tenantId, business: businessId }),
    TenantInvoiceNote.countDocuments({ tenant: tenantId, business: businessId }),
    Lease.countDocuments({ tenant: tenantId, business: businessId }),
    LatePenaltyBatch.countDocuments({ tenant: tenantId, business: businessId }),
    MpesaCollection.countDocuments({ tenant: tenantId, business: businessId }),
    FinancialLedgerEntry.countDocuments({
      tenant: tenantId,
      business: businessId,
      status: { $nin: ["void", "draft"] },
    }),
    LandlordStatementLine.countDocuments({ tenant: tenantId, business: businessId }),
    Maintenance.countDocuments({ tenant: tenantId, business: businessId }),
    Inspection.countDocuments({ tenant: tenantId, business: businessId }),
    MeterReading.countDocuments({ tenant: tenantId, business: businessId }),
  ]);

  const summary = {
    rentPayments,
    receipts,
    invoices,
    invoiceNotes,
    leases,
    latePenaltyBatches,
    mpesaCollections,
    ledgerEntries,
    landlordStatementLines,
    maintenance,
    inspections,
    meterReadings,
  };

  // Leases are auto-created system records — not user-entered transaction data.
  // They are cleaned up automatically on delete, so they must not block deletion.
  const financialKeys = ["rentPayments", "receipts", "invoices", "invoiceNotes", "latePenaltyBatches", "mpesaCollections", "ledgerEntries", "landlordStatementLines"];

  return {
    summary,
    hasDependencies: financialKeys.some((key) => Number(summary[key] || 0) > 0),
  };
};

const formatTenantDependencySummary = (summary = {}) => {
  const labels = {
    rentPayments: "rent payments",
    receipts: "receipts",
    invoices: "invoices",
    invoiceNotes: "invoice notes",
    leases: "leases",
    latePenaltyBatches: "late penalty batches",
    mpesaCollections: "M-Pesa collections",
    ledgerEntries: "ledger entries",
    landlordStatementLines: "statement lines",
    maintenance: "maintenance records",
    inspections: "inspections",
    meterReadings: "meter readings",
  };

  return Object.entries(summary)
    .filter(([, count]) => Number(count || 0) > 0)
    .map(([key, count]) => `${count} ${labels[key] || key}`)
    .slice(0, 6)
    .join(", ");
};

// Create tenant
export const createTenant = async (req, res, next) => {
  try {
    const leaseType = normalizeLower(req.body.leaseType || "at_will");

    if (!["at_will", "fixed"].includes(leaseType)) {
      return next(createError(400, "Invalid lease type. Use at_will or fixed"));
    }

    if (leaseType === "fixed") {
      if (!req.body.moveOutDate) {
        return next(createError(400, "Move-out date is required for fixed leases"));
      }

      const moveInDate = new Date(req.body.moveInDate);
      const moveOutDate = new Date(req.body.moveOutDate);

      if (
        Number.isNaN(moveInDate.getTime()) ||
        Number.isNaN(moveOutDate.getTime()) ||
        moveOutDate <= moveInDate
      ) {
        return next(createError(400, "Move-out date must be after move-in date for fixed leases"));
      }
    }

    const businessId = resolveBusinessId(req);

    if (!businessId) {
      return next(createError(400, "Business context is required to create a tenant. Please ensure you are logged in with a company account."));
    }

    if (!req.body.unit || !mongoose.Types.ObjectId.isValid(req.body.unit)) {
      return next(createError(400, "A valid unit is required"));
    }

    const requestedUnits = buildRequestedTenantUnits({
      primaryUnitId: req.body.unit,
      additionalUnits: req.body.additionalUnits,
    });

    const unitDocs = await ensureUnitsBelongToBusiness({
      businessId,
      unitIds: requestedUnits.all,
    });

    await ensureUnitsAvailableForTenant({
      businessId,
      unitDocs,
    });

    const unit = unitDocs.find((item) => String(item._id) === requestedUnits.primary) || null;
    const propertyServiceMode = normalizePropertyServiceMode(unit?.property?.letManage);
    const isPropertyLettingOnly = propertyServiceMode === "Letting";
    const isPropertyWithLettingFee = hasLettingFee(propertyServiceMode);

    // Only pure Letting forces deposit to landlord — the agent steps away after placement.
    // Both and Managing use the property's own depositHeldBy setting.
    const effectivePropertyDepositHolder = isPropertyLettingOnly
      ? "landlord"
      : (unit?.property?.depositHeldBy || "propertyManager");

    const normalizedName = normalizeString(req.body.name);
    const normalizedPhone = isPlaceholder(req.body.phone) ? null : normalizeKenyanPhoneForStorage(req.body.phone);
    const normalizedIdNumber = isPlaceholder(req.body.idNumber) ? null : normalizeString(req.body.idNumber);
    const normalizedPaymentMethod = normalizePaymentMethod(req.body.paymentMethod);
    const normalizedTenantCode = normalizeString(req.body.tenantCode);

    if (!normalizedName) {
      return next(createError(400, "Tenant name is required"));
    }

    const tenantDuplicateOr = [
      ...(normalizedIdNumber ? [{ idNumber: normalizedIdNumber }] : []),
      ...(normalizedTenantCode ? [{ tenantCode: normalizedTenantCode }] : []),
    ];
    const duplicateTenant = tenantDuplicateOr.length
      ? await Tenant.findOne({ business: businessId, $or: tenantDuplicateOr }).lean()
      : null;

    if (duplicateTenant) {
      if (duplicateTenant.idNumber === normalizedIdNumber) {
        return next(createError(400, "Tenant ID number already exists in this company"));
      }

      if (normalizedTenantCode && duplicateTenant.tenantCode === normalizedTenantCode) {
        return next(createError(400, "Tenant code already exists in this company"));
      }
    }

    const defaultDepositAmount = Number(
      req.body.depositAmount ?? unit.deposit ?? req.body.rent ?? unit.rent ?? 0
    );

    const createLeaseFeeInvoice = req.body.createLeaseFeeInvoice === true || String(req.body.createLeaseFeeInvoice || "").trim().toLowerCase() === "true";
    const leaseFeeAmount = Number(req.body.leaseFeeAmount || 0);
    const leaseFeeDescription = String(req.body.leaseFeeDescription || "").trim();

    if (createLeaseFeeInvoice && leaseFeeAmount > 0) {
      const landlordId = getPrimaryLandlordIdFromProperty(unit?.property);
      if (!landlordId) {
        return next(createError(400, "Cannot create lease/agreement fee because the property has no assigned landlord."));
      }

      const requestedChartAccountValue =
        req.body?.chartAccount ||
        req.body?.chartAccountCode ||
        req.body?.accountCode ||
        req.body?.account ||
        null;

      try {
        await resolveLeaseAgreementFeeIncomeAccount({
          businessId,
          chartAccountValue: requestedChartAccountValue,
        });
      } catch (accountError) {
        return next(createError(accountError?.statusCode || 400, accountError?.message || "Lease/agreement fee income account not found. Configure Lease / Agreement Fee Income Account under Accounting Defaults."));
      }
    }

    const assignedRent = calculateTenantAssignedRent(unitDocs, req.body.rent || unit.rent || 0);

    const computedLettingFeeAmount = (() => {
      if (!isPropertyWithLettingFee) return 0;
      const feeMode = unit?.property?.lettingFeeMode || "percentage";
      const feeValue = Math.max(0, parseFloat(unit?.property?.lettingFeeValue ?? 100) || 0);
      if (feeMode === "fixed") return feeValue;
      return Math.round((feeValue / 100) * assignedRent * 100) / 100;
    })();

    // Strip internal fields before spreading — prevents _id injection, portal credential bypass, etc.
    const { _id: _stripId, __v: _stripV, portalPassword: _stripPwd, portalAccessPasswordHash: _stripHash, balance: _stripBal, ...safeBody } = req.body || {};
    const tenantBase = {
      ...safeBody,
      name: normalizedName,
      phone: normalizedPhone,
      idNumber: normalizedIdNumber,
      paymentMethod: normalizedPaymentMethod,
      leaseType,
      moveOutDate: leaseType === "fixed" ? req.body.moveOutDate : null,
      business: businessId,
      unit: unit._id,
      additionalUnits: requestedUnits.additional,
      rent: assignedRent,
      depositAmount: defaultDepositAmount,
      depositHeldBy: normalizeDepositHolder(req.body.depositHeldBy, effectivePropertyDepositHolder),
      status: normalizeTenantStatus(req.body.status || "active"),
      depositRefundStatus: defaultDepositAmount > 0 ? "pending" : "not_applicable",
      depositRefundAmount: defaultDepositAmount,
      lettingFeeAmount: computedLettingFeeAmount,
      documents: sanitizeDocuments(req.body.documents),
      utilities: sanitizeUtilities(
        Array.isArray(req.body.utilities) && req.body.utilities.length > 0
          ? req.body.utilities
          : deriveAssignedUtilitiesFromUnitDocs(unitDocs)
      ),
      emergencyContact: sanitizeEmergencyContact(req.body.emergencyContact),
    };

    let savedTenant;
    for (let attempt = 0; attempt < 10; attempt++) {
      const tenantCode = normalizedTenantCode || (await generateNextTenantCode(businessId));
      try {
        savedTenant = await new Tenant({ ...tenantBase, tenantCode }).save();
        break;
      } catch (err) {
        if (err.code === 11000 && err.keyPattern?.tenantCode && !normalizedTenantCode && attempt < 9) {
          // On the first collision resync the counter to the actual DB max so the
          // next increment lands above any gap left by imports or failed saves.
          if (attempt === 0) await resyncTenantCodeCounter(businessId);
          continue;
        }
        throw err;
      }
    }

    const [populatedTenant] = await Promise.all([
      populateTenantQuery(Tenant.findById(savedTenant._id).lean()),
      syncTenantAssignedUnitOccupancy({
        previousUnitIds: [],
        nextUnitIds: shouldTenantOccupyUnits(savedTenant) ? getTenantAssignedUnitIds(savedTenant) : [],
        tenantId: savedTenant._id,
        effectiveDate: new Date(),
      }),
    ]);

    // Lease sync is isolated: if it fails the tenant is already committed and must
    // not be rolled back. Return a warning instead of a 409 that misleads the caller
    // into thinking the tenant was never created (which causes a re-submit loop).
    let leaseWarning = null;
    try {
      await syncTenantLeaseRecord({
        tenantDoc: populatedTenant,
        unitDoc: unit,
        action: "upsert",
      });
    } catch (leaseErr) {
      console.error(`Auto-lease creation failed for tenant ${savedTenant._id}:`, leaseErr);
      leaseWarning = "Tenant created but lease agreement could not be generated automatically. Please create it from the Agreements page.";
    }

    if (createLeaseFeeInvoice && leaseFeeAmount > 0) {
      const landlordId = getPrimaryLandlordIdFromProperty(unit?.property);

      const feeDate = req.body.moveInDate ? new Date(req.body.moveInDate) : new Date();
      const defaultDescription = `Lease / Agreement Fee for ${populatedTenant?.name || normalizedName}`;

      const leaseFeeMoveInDate = req.body.moveInDate
        ? new Date(req.body.moveInDate).toISOString().split("T")[0]
        : feeDate.toISOString().split("T")[0];
      const leaseFeeIdempotencyKey = buildLeaseAgreementFeeIdempotencyKey({
        businessId,
        tenantId: savedTenant._id,
        unitId: unit._id,
        propertyId: String(unit.property?._id || unit.property || ""),
        moveInDate: leaseFeeMoveInDate,
        amount: leaseFeeAmount,
      });

      await createTenantInvoiceRecord({
        req,
        payload: {
          business: businessId,
          property: String(unit.property?._id || unit.property || ""),
          landlord: landlordId,
          tenant: String(savedTenant._id),
          unit: String(unit._id),
          category: "OTHER_CHARGE",
          amount: leaseFeeAmount,
          description: leaseFeeDescription || defaultDescription,
          invoiceDate: feeDate,
          bookingDate: feeDate,
          dueDate: feeDate,
          createdBy: req.body?.createdBy,
          idempotencyKey: leaseFeeIdempotencyKey,
          metadata: {
            sourceTransactionType: "lease_agreement_fee",
            sourceKey: leaseFeeIdempotencyKey,
            statementClassification: "manager_service_income",
            includeInLandlordStatement: false,
            includeInCategoryTotals: false,
            billItemKey: "lease_agreement_fee",
            billItemLabel: "Lease / Agreement Fee",
            invoicePriorityCategory: "other",
            propertyServiceMode: propertyServiceMode.toLowerCase(),
          },
        },
      });
    }

    try {
      await logAuditEvent({
        req,
        company: businessId,
        action: "tenants.create",
        category: "property",
        severity: "important",
        targetType: "Tenant",
        targetId: savedTenant._id,
        targetName: tenantLabel(savedTenant),
        message: `Created tenant ${tenantLabel(savedTenant)}`,
        metadata: {
          tenantCode: savedTenant.tenantCode,
          unit: savedTenant.unit,
          additionalUnits: savedTenant.additionalUnits,
          rent: savedTenant.rent,
        },
      });
    } catch (err) {
      console.error("Audit log failed:", err);
    }

    return res.status(201).json({
      success: true,
      data: populatedTenant,
      message: leaseWarning || "Tenant created successfully",
      ...(leaseWarning ? { warning: leaseWarning } : {}),
    });
  } catch (err) {
    console.error("Create tenant error:", err);

    if (err?.code === 11000) {
      if (isAgreementNumberDuplicateError(err)) {
        return next(createError(409, "Tenant could not be created because the lease agreement number already exists. Please try again."));
      }

      const duplicateField = Object.keys(err.keyPattern || {})[0] || "field";

      if (duplicateField === "idNumber") {
        return next(createError(400, "Tenant ID number already exists in this company"));
      }

      if (duplicateField === "tenantCode") {
        return next(createError(400, "Tenant code already exists in this company"));
      }
    }

    if (err?.name === "ValidationError") {
      return next(createError(400, Object.values(err.errors || {}).map((error) => error?.message).filter(Boolean).join("; ") || "Tenant validation failed"));
    }

    next(err);
  }
};

// Get all tenants
export const getTenants = async (req, res, next) => {
  try {
    const { status, unit, search: rawSearch, tenantName: rawTenantName, tenantCode: rawTenantCode, property: propertyId } = req.query;
    const businessId = resolveBusinessId(req);

    if (!businessId) {
      return next(createError(400, "Business context is required to fetch tenants"));
    }

    const filter = { business: businessId };

    if (status) {
      if (status === "active") {
        // "active" is a computed status — any tenant not explicitly terminated/inactive maps to active
        filter.status = { $nin: ["terminated", "moved_out", "inactive", "evicted"] };
      } else if (status === "terminated") {
        filter.status = { $in: ["terminated", "moved_out"] };
      } else {
        filter.status = status;
      }
    }

    if (unit) {
      const unitDoc = await Unit.findOne({ _id: unit, business: businessId }).select("_id").lean();
      if (!unitDoc) {
        return next(createError(404, "Selected unit was not found"));
      }
      filter.unit = unit;
    } else if (propertyId && mongoose.Types.ObjectId.isValid(String(propertyId))) {
      const propertyUnits = await Unit.find({ property: propertyId, business: businessId }).select("_id").limit(5000).lean();
      filter.unit = { $in: propertyUnits.map((u) => u._id) };
    }

    const foPropertyIds = await getFieldOfficerPropertyIds(req);
    if (foPropertyIds !== null) {
      const foUnits = foPropertyIds.length > 0
        ? await Unit.find({ property: { $in: foPropertyIds }, business: businessId }, { _id: 1 }).limit(5000).lean()
        : [];
      const foUnitSet = new Set(foUnits.map((u) => String(u._id)));

      if (filter.unit) {
        if (typeof filter.unit === 'string') {
          if (!foUnitSet.has(filter.unit)) filter.unit = { $in: [] };
        } else if (filter.unit.$in) {
          filter.unit = { $in: filter.unit.$in.filter((id) => foUnitSet.has(String(id))) };
        }
      } else {
        filter.unit = { $in: [...foUnitSet] };
      }
    }

    const search = rawSearch ? rawSearch.trim() : "";
    const tenantName = rawTenantName ? rawTenantName.trim() : "";
    const tenantCode = rawTenantCode ? rawTenantCode.trim() : "";

    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [
        { name: re },
        { phone: re },
        { email: re },
        { tenantCode: re },
        { idNumber: re },
      ];
    } else if (tenantName) {
      filter.name = { $regex: tenantName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    } else if (tenantCode) {
      filter.tenantCode = { $regex: tenantCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    }

    if (req.query.hasBalance === "true") {
      // 0.009 guards against floating-point noise: smallest real balance after round2() is 0.01
      filter.balance = { $gt: 0.009 };
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));
    const skip = (page - 1) * limit;

    const [tenants, total] = await Promise.all([
      populateTenantQuery(
        Tenant.find(filter)
          // Keep only the most recent transfer entry — enough for the list/menu to know
          // whether a "Rollback Transfer" action is available, without shipping the tenant's
          // full transfer history on every row.
          .select({ unitTransferHistory: { $slice: -1 } })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
      ).lean(),
      Tenant.countDocuments(filter),
    ]);

    const enrichedTenants = tenants.map((tenantDoc) => ({
      ...tenantDoc,
      status: computeOperationalTenantStatus({ tenant: tenantDoc }),
    }));

    // Count invoices and payments for current-page tenants only
    const pageIds = tenants.map((t) => t._id);
    if (pageIds.length > 0) {
      const [invCounts, paymentCounts, noteCounts, depositReceipts] = await Promise.all([
        TenantInvoice.aggregate([
          { $match: { business: new mongoose.Types.ObjectId(String(businessId)), tenant: { $in: pageIds }, status: { $nin: ["cancelled", "reversed"] } } },
          { $group: { _id: "$tenant", count: { $sum: 1 } } },
        ]),
        RentPayment.aggregate([
          { $match: { business: new mongoose.Types.ObjectId(String(businessId)), tenant: { $in: pageIds }, isReversed: { $ne: true }, isCancelled: { $ne: true } } },
          { $group: { _id: "$tenant", count: { $sum: 1 } } },
        ]),
        TenantInvoiceNote.aggregate([
          { $match: { business: new mongoose.Types.ObjectId(String(businessId)), tenant: { $in: pageIds }, status: { $nin: ["cancelled", "reversed"] } } },
          { $group: { _id: "$tenant", count: { $sum: 1 } } },
        ]),
        RentPayment.aggregate([
          { $match: { business: new mongoose.Types.ObjectId(String(businessId)), tenant: { $in: pageIds }, paymentType: "deposit", isReversed: { $ne: true }, isCancelled: { $ne: true } } },
          { $group: { _id: "$tenant", total: { $sum: "$amount" } } },
        ]),
      ]);
      const invCountMap = new Map(invCounts.map((r) => [String(r._id), r.count]));
      const payCountMap = new Map(paymentCounts.map((r) => [String(r._id), r.count]));
      const noteCountMap = new Map(noteCounts.map((r) => [String(r._id), r.count]));
      const depositReceiptedMap = new Map(depositReceipts.map((r) => [String(r._id), r.total]));
      enrichedTenants.forEach((t) => {
        t.invoiceCount = invCountMap.get(String(t._id)) || 0;
        t.paymentCount = payCountMap.get(String(t._id)) || 0;
        t.invoiceNoteCount = noteCountMap.get(String(t._id)) || 0;
        t.depositReceipted = depositReceiptedMap.get(String(t._id)) || 0;
      });
    }

    return res.status(200).json({
      success: true,
      data: enrichedTenants,
      count: enrichedTenants.length,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
};

// Get single tenant
export const getTenant = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    const filter = req.user?.isSystemAdmin
      ? { _id: req.params.id }
      : { _id: req.params.id, business: businessId };

    const tenant = await Tenant.findOne(filter)
      .populate({ path: "unit",            select: "unitNumber property rent amenities status utilities", populate: { path: "property", select: PROPERTY_SELECT } })
      .populate({ path: "additionalUnits", select: UNIT_SELECT, populate: { path: "property", select: PROPERTY_SELECT } })
      .lean();

    if (!tenant) {
      return next(createError(404, "Tenant not found"));
    }

    const foPropertyIds = await getFieldOfficerPropertyIds(req);
    if (foPropertyIds !== null) {
      const foSet = new Set(foPropertyIds.map(String));
      // unit.property is already populated in the query above — use it directly
      const propId = tenant.unit?.property?._id || tenant.unit?.property;
      if (!propId || !foSet.has(String(propId))) {
        return next(createError(403, "Not authorized to access this tenant"));
      }
    }

    return res.status(200).json({ success: true, data: tenant });
  } catch (err) {
    next(err);
  }
};

// Update tenant
export const updateTenant = async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.params.id).lean();

    const access = authorizeTenantAccess(req, tenant);
    if (!access.allowed) {
      return next(createError(access.status, access.message.replace("access", "update")));
    }

    const normalizedPayload = { ...req.body };
    delete normalizedPayload.business;
    delete normalizedPayload._id;
    delete normalizedPayload.createdAt;
    delete normalizedPayload.updatedAt;

    // A terminated tenant is a historical record — plain data corrections (name, phone,
    // email, etc.) stay allowed here, but unit/status changes must go through the
    // dedicated Restore/Transfer flows instead, which correctly clear termination fields,
    // check the target unit's availability, and sync occupancy. Letting this generic edit
    // form touch unit/status directly is what let a terminated tenant's `unit` field drift
    // out of sync with reality — which the landlord statement (and other reports keyed off
    // tenant.unit) then trusted at face value.
    if (String(tenant.status || "").toLowerCase() === "terminated") {
      const blockedFields = ["unit", "additionalUnits", "status"].filter((field) =>
        Object.prototype.hasOwnProperty.call(normalizedPayload, field)
      );
      if (blockedFields.length > 0) {
        return next(
          createError(
            400,
            `Cannot change ${blockedFields.join("/")} on a terminated tenant from this form. Use "Restore" to reactivate them, or the Transfer flow to reassign their unit.`
          )
        );
      }
    }

    if (normalizedPayload.name !== undefined) {
      normalizedPayload.name = normalizeString(normalizedPayload.name);
    }

    if (normalizedPayload.phone !== undefined) {
      normalizedPayload.phone = isPlaceholder(normalizedPayload.phone) ? null : normalizeKenyanPhoneForStorage(normalizedPayload.phone);
    }

    if (normalizedPayload.idNumber !== undefined) {
      normalizedPayload.idNumber = isPlaceholder(normalizedPayload.idNumber) ? null : normalizeString(normalizedPayload.idNumber);
    }

    if (normalizedPayload.email !== undefined) {
      const emailRaw = String(normalizedPayload.email || "").trim().toLowerCase();
      normalizedPayload.email = isPlaceholder(emailRaw) ? null : emailRaw;
    }

    if (normalizedPayload.tenantCode !== undefined) {
      normalizedPayload.tenantCode = normalizeString(normalizedPayload.tenantCode);
    }

    if (normalizedPayload.paymentMethod !== undefined) {
      normalizedPayload.paymentMethod = normalizePaymentMethod(normalizedPayload.paymentMethod);
    }

    if (normalizedPayload.leaseType !== undefined) {
      normalizedPayload.leaseType = normalizeLower(normalizedPayload.leaseType);
    }

    if (normalizedPayload.status !== undefined) {
      normalizedPayload.status = normalizeTenantStatus(normalizedPayload.status);
    }

    if (normalizedPayload.depositAmount !== undefined) {
      const depositAmount = Number(normalizedPayload.depositAmount || 0);
      if (depositAmount < 0) {
        return next(createError(400, "Deposit amount cannot be negative"));
      }
      normalizedPayload.depositAmount = depositAmount;
    }

    if (normalizedPayload.depositRefundAmount !== undefined) {
      normalizedPayload.depositRefundAmount = Math.max(0, Number(normalizedPayload.depositRefundAmount || 0));
    }

    if (normalizedPayload.documents !== undefined) {
      normalizedPayload.documents = sanitizeDocuments(normalizedPayload.documents);
    }

    if (normalizedPayload.utilities !== undefined) {
      normalizedPayload.utilities = sanitizeUtilities(normalizedPayload.utilities);
    }

    if (normalizedPayload.emergencyContact !== undefined) {
      normalizedPayload.emergencyContact = sanitizeEmergencyContact(
        normalizedPayload.emergencyContact
      );
    }

    const currentAssignedUnitIds = getTenantAssignedUnitIds(tenant);
    const currentUnitId = tenant.unit ? String(tenant.unit) : "";
    let targetUnit = null;
    const requestedUnitId =
      normalizedPayload.unit !== undefined && normalizedPayload.unit !== null
        ? String(normalizedPayload.unit)
        : currentUnitId;
    const requestedAdditionalUnits =
      normalizedPayload.additionalUnits !== undefined
        ? uniqueUnitIds(normalizedPayload.additionalUnits)
        : uniqueUnitIds(tenant.additionalUnits || []);
    const requestedUnits = buildRequestedTenantUnits({
      primaryUnitId: requestedUnitId,
      additionalUnits: requestedAdditionalUnits,
    });
    const isChangingUnit = !!requestedUnitId && requestedUnitId !== currentUnitId;
    const isChangingAdditionalUnits =
      requestedUnits.additional.join(",") !== uniqueUnitIds(tenant.additionalUnits || []).join(",");

    if (normalizedPayload.unit !== undefined || normalizedPayload.additionalUnits !== undefined) {
      if (!mongoose.Types.ObjectId.isValid(requestedUnitId)) {
        return next(createError(400, "A valid unit is required"));
      }

      const requestedUnitDocs = await ensureUnitsBelongToBusiness({
        businessId: tenant.business,
        unitIds: requestedUnits.all,
      });

      await ensureUnitsAvailableForTenant({
        businessId: tenant.business,
        unitDocs: requestedUnitDocs,
        currentTenantId: tenant._id,
        currentlyAssignedUnitIds: currentAssignedUnitIds,
      });

      targetUnit =
        requestedUnitDocs.find((item) => String(item._id) === requestedUnits.primary) || null;

      normalizedPayload.unit = requestedUnits.primary;
      normalizedPayload.additionalUnits = requestedUnits.additional;

      if (normalizedPayload.rent === undefined) {
        normalizedPayload.rent = calculateTenantAssignedRent(requestedUnitDocs, tenant.rent || 0);
      }

      if (normalizedPayload.utilities === undefined) {
        normalizedPayload.utilities = deriveAssignedUtilitiesFromUnitDocs(requestedUnitDocs);
      }

      if (isChangingUnit) {
        normalizedPayload.unitTransferHistory = [
          ...(Array.isArray(tenant.unitTransferHistory) ? tenant.unitTransferHistory : []),
          {
            fromUnit: tenant.unit || null,
            toUnit: requestedUnits.primary || null,
            effectiveDate: new Date(),
            reason: normalizedPayload.transferReason || "Unit reassigned from tenant profile update",
            transferredBy:
              req.user?.id && mongoose.Types.ObjectId.isValid(String(req.user.id))
                ? req.user.id
                : null,
            previousAdditionalUnits: uniqueUnitIds(tenant.additionalUnits || []),
            nextAdditionalUnits: requestedUnits.additional,
          },
        ];
      }
    }

    if (Object.prototype.hasOwnProperty.call(normalizedPayload, "depositHeldBy")) {
      const unit =
        targetUnit ||
        (tenant.unit ? await Unit.findById(tenant.unit).populate("property", "depositHeldBy").lean() : null);

      normalizedPayload.depositHeldBy = normalizeDepositHolder(
        normalizedPayload.depositHeldBy,
        unit?.property?.depositHeldBy
      );
    }

    const requestedStatus =
      normalizedPayload.status !== undefined
        ? normalizeTenantStatus(normalizedPayload.status)
        : normalizeTenantStatus(tenant.status || "active");
    const currentOccupiesUnits = shouldTenantOccupyUnits(tenant);
    const nextOccupiesUnits = shouldTenantOccupyUnits(requestedStatus);

    if (!isChangingUnit && !isChangingAdditionalUnits && nextOccupiesUnits && !currentOccupiesUnits) {
      const requestedUnitDocs = await ensureUnitsBelongToBusiness({
        businessId: tenant.business,
        unitIds: currentAssignedUnitIds,
      });

      await ensureUnitsAvailableForTenant({
        businessId: tenant.business,
        unitDocs: requestedUnitDocs,
        currentTenantId: tenant._id,
      });
    }

    const duplicateQuery = {
      business: tenant.business,
      _id: { $ne: tenant._id },
      $or: [],
    };

    if (normalizedPayload.idNumber) {
      duplicateQuery.$or.push({ idNumber: normalizedPayload.idNumber });
    }

    if (normalizedPayload.tenantCode) {
      duplicateQuery.$or.push({ tenantCode: normalizedPayload.tenantCode });
    }

    if (duplicateQuery.$or.length > 0) {
      const duplicateTenant = await Tenant.findOne(duplicateQuery).lean();

      if (duplicateTenant) {
        if (
          normalizedPayload.idNumber &&
          duplicateTenant.idNumber === normalizedPayload.idNumber
        ) {
          return next(createError(400, "Tenant ID number already exists in this company"));
        }

        if (
          normalizedPayload.tenantCode &&
          duplicateTenant.tenantCode === normalizedPayload.tenantCode
        ) {
          return next(createError(400, "Tenant code already exists in this company"));
        }
      }
    }

    delete normalizedPayload.transferReason;

    const updatedTenant = await populateTenantQuery(
      Tenant.findByIdAndUpdate(
        req.params.id,
        { $set: normalizedPayload },
        { new: true, runValidators: true }
      ).lean()
    );

    if (isChangingUnit || isChangingAdditionalUnits || currentOccupiesUnits !== nextOccupiesUnits) {
      await syncTenantAssignedUnitOccupancy({
        previousUnitIds: currentOccupiesUnits ? currentAssignedUnitIds : [],
        nextUnitIds: nextOccupiesUnits ? getTenantAssignedUnitIds(updatedTenant) : [],
        tenantId: tenant._id,
        effectiveDate: new Date(),
      });
    }

    await syncTenantLeaseRecord({
      tenantDoc: updatedTenant,
      unitDoc: targetUnit || updatedTenant.unit || null,
      action: "upsert",
    });

    const criticalFields = [
      "unit",
      "additionalUnits",
      "rent",
      "depositAmount",
      "depositHeldBy",
      "paymentMethod",
      "status",
      "moveInDate",
      "moveOutDate",
    ].filter((field) => Object.prototype.hasOwnProperty.call(normalizedPayload, field));

    if (criticalFields.length) {
      await logAuditEvent({
        req,
        company: tenant.business,
        action: "tenants.update",
        category: "property",
        severity: criticalFields.some((field) => ["unit", "additionalUnits", "status"].includes(field)) ? "critical" : "important",
        targetType: "Tenant",
        targetId: tenant._id,
        targetName: tenantLabel(updatedTenant),
        message: `Updated tenant ${tenantLabel(updatedTenant)}`,
        metadata: {
          fields: criticalFields,
          previousStatus: tenant.status,
          nextStatus: updatedTenant.status,
          previousUnit: tenant.unit,
          nextUnit: updatedTenant.unit?._id || updatedTenant.unit,
        },
      });
    }

    return res.status(200).json({
      success: true,
      data: updatedTenant,
    });
  } catch (err) {
    if (err?.code === 11000) {
      if (isAgreementNumberDuplicateError(err)) {
        return next(createError(409, "Tenant could not be updated because a lease agreement number conflict was detected. Please try again."));
      }

      const duplicateField = Object.keys(err.keyPattern || {})[0] || "field";

      if (duplicateField === "idNumber") {
        return next(createError(400, "Tenant ID number already exists in this company"));
      }

      if (duplicateField === "tenantCode") {
        return next(createError(400, "Tenant code already exists in this company"));
      }
    }

    if (err?.statusCode === 409 && String(err?.message || "").includes("agreement number")) {
      return next(createError(409, err.message));
    }

    next(err);
  }
};

// Delete tenant
export const deleteTenant = async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.params.id).lean();

    const access = authorizeTenantAccess(req, tenant);
    if (!access.allowed) {
      return next(createError(access.status, access.message.replace("access", "delete")));
    }

    const { summary, hasDependencies } = await getTenantDependencySummary(tenant);

    if (hasDependencies) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete tenant with historical records (${formatTenantDependencySummary(summary)}). Terminate or archive the tenant instead.`,
        data: {
          dependencySummary: summary,
        },
      });
    }

    await syncTenantAssignedUnitOccupancy({
      previousUnitIds: getTenantAssignedUnitIds(tenant),
      nextUnitIds: [],
      tenantId: tenant._id,
      effectiveDate: new Date(),
    });

    // Clean up auto-created lease records before deleting the tenant
    await Promise.all([
      Lease.deleteMany({ tenant: tenant._id, business: tenant.business }),
      Tenant.findByIdAndDelete(req.params.id),
    ]);
    await logAuditEvent({
      req,
      company: tenant.business,
      action: "tenants.delete",
      category: "property",
      severity: "critical",
      targetType: "Tenant",
      targetId: tenant._id,
      targetName: tenantLabel(tenant),
      message: `Deleted tenant ${tenantLabel(tenant)}`,
      metadata: {
        unit: tenant.unit,
        additionalUnits: tenant.additionalUnits,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Tenant deleted successfully",
    });
  } catch (err) {
    next(err);
  }
};

const invokeDeleteForTenant = ({ req, tenantId }) => {
  return new Promise((resolve, reject) => {
    let settled = false;
    const response = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        if (!settled) {
          settled = true;
          resolve({ statusCode: this.statusCode || 200, payload });
        }
        return this;
      },
    };
    const nextFn = (err) => {
      if (!settled) {
        settled = true;
        reject(err || new Error("Failed to delete tenant."));
      }
    };

    Promise.resolve(
      deleteTenant({ ...req, params: { ...(req.params || {}), id: String(tenantId) } }, response, nextFn)
    ).catch((err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
};

// Batch delete tenants: single client round trip, per-row processing preserved
export const batchDeleteTenants = async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const validIds = Array.from(
      new Set(ids.map((id) => String(id || "").trim()).filter((id) => mongoose.Types.ObjectId.isValid(id)))
    );

    if (!validIds.length) {
      return next(createError(400, "At least one tenant id is required."));
    }

    const succeeded = [];
    const failed = [];

    for (const tenantId of validIds) {
      try {
        const { statusCode, payload } = await invokeDeleteForTenant({ req, tenantId });
        if (Number(statusCode || 200) >= 400) {
          failed.push({ id: tenantId, reason: payload?.message || payload?.error || "Failed to delete tenant." });
          continue;
        }
        succeeded.push({ id: tenantId, message: payload?.message || "Tenant deleted successfully" });
      } catch (error) {
        failed.push({ id: tenantId, reason: error?.message || "Failed to delete tenant." });
      }
    }

    return res.status(200).json({
      succeeded,
      failed,
      succeededCount: succeeded.length,
      failedCount: failed.length,
    });
  } catch (error) {
    next(error);
  }
};

// Update tenant status
export const updateTenantStatus = async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.params.id).lean();

    const access = authorizeTenantAccess(req, tenant);
    if (!access.allowed) {
      return next(createError(access.status, access.message));
    }

    const requestedStatus = String(req.body?.status || "").toLowerCase();
    const status = requestedStatus === "moved_out" ? "terminated" : requestedStatus;
    const terminationDate = req.body?.terminationDate || req.body?.moveOutDate || null;
    const terminationReason = String(req.body?.terminationReason || "").trim();
    const depositRefundAmount = Number(
      req.body?.depositRefundAmount ?? tenant.depositRefundAmount ?? tenant.depositAmount ?? 0
    );
    const depositRefundReference = String(
      req.body?.depositRefundReference || tenant.depositRefundReference || ""
    ).trim();

    if (!status) {
      return next(createError(400, "Tenant status is required"));
    }

    const currentAssignedUnitIds = getTenantAssignedUnitIds(tenant);
    const previousOccupiedUnitIds = shouldTenantOccupyUnits(tenant) ? currentAssignedUnitIds : [];
    const nextOccupiedUnitIds = shouldTenantOccupyUnits(status) ? currentAssignedUnitIds : [];
    const updateData = { status };

    if (status === "terminated") {
      const effectiveTerminationDate = terminationDate ? new Date(terminationDate) : new Date();
      if (Number.isNaN(effectiveTerminationDate.getTime())) {
        return next(createError(400, "A valid termination date is required"));
      }

      const today = new Date();
      today.setHours(23, 59, 59, 999);
      if (effectiveTerminationDate.getTime() > today.getTime()) {
        return next(createError(400, "Future-dated termination is not supported. Use today or an earlier date."));
      }

      updateData.moveOutDate = effectiveTerminationDate;
      updateData.terminationDate = effectiveTerminationDate;
      updateData.terminationReason = terminationReason;
      updateData.depositRefundAmount = depositRefundAmount;
      updateData.depositRefundReference = depositRefundReference;
      updateData.depositRefundStatus =
        depositRefundAmount > 0 ? req.body?.depositRefundStatus || "pending" : "not_applicable";
    } else if (
      shouldTenantOccupyUnits(status) &&
      !shouldTenantOccupyUnits(tenant)
    ) {
      if (!currentAssignedUnitIds.length) {
        return next(createError(400, "Cannot activate tenant because no unit is assigned"));
      }

      const requestedUnitDocs = await ensureUnitsBelongToBusiness({
        businessId: tenant.business,
        unitIds: currentAssignedUnitIds,
      });

      await ensureUnitsAvailableForTenant({
        businessId: tenant.business,
        unitDocs: requestedUnitDocs,
        currentTenantId: tenant._id,
      });

      updateData.terminationDate = null;
      updateData.terminationReason = "";
      updateData.moveOutDate = null;
    }

    const updatedTenantDoc = await populateTenantQuery(
      Tenant.findByIdAndUpdate(
        req.params.id,
        { $set: updateData },
        { new: true, runValidators: true }
      ).lean()
    );

    if (
      previousOccupiedUnitIds.join(",") !== nextOccupiedUnitIds.join(",") ||
      status === "terminated" ||
      (shouldTenantOccupyUnits(status) && !shouldTenantOccupyUnits(tenant))
    ) {
      await syncTenantAssignedUnitOccupancy({
        previousUnitIds: previousOccupiedUnitIds,
        nextUnitIds: nextOccupiedUnitIds,
        tenantId: tenant._id,
        effectiveDate: updateData.terminationDate || updateData.moveOutDate || new Date(),
      });
    }

    const isRestore = shouldTenantOccupyUnits(status) && !shouldTenantOccupyUnits(tenant);
    await syncTenantLeaseRecord({
      tenantDoc: updatedTenantDoc,
      action: status === "terminated" ? "terminate" : isRestore ? "restore" : "upsert",
      effectiveDate: updateData.terminationDate || updateData.moveOutDate || null,
      terminationReason,
    });

    const updatedTenant = updatedTenantDoc;

    await logAuditEvent({
      req,
      company: tenant.business,
      action: status === "terminated" ? "tenants.terminate" : "tenants.status.update",
      category: "property",
      severity: "critical",
      targetType: "Tenant",
      targetId: tenant._id,
      targetName: tenantLabel(updatedTenant),
      message: status === "terminated"
        ? `Terminated tenant ${tenantLabel(updatedTenant)}`
        : `Changed tenant ${tenantLabel(updatedTenant)} status to ${status}`,
      metadata: {
        previousStatus: tenant.status,
        nextStatus: status,
        terminationDate: updateData.terminationDate || null,
        terminationReason,
        depositRefundAmount: updateData.depositRefundAmount,
        depositRefundStatus: updateData.depositRefundStatus,
        previousUnits: previousOccupiedUnitIds,
        nextUnits: nextOccupiedUnitIds,
      },
    });

    if (!updatedTenant) {
      return next(createError(404, "Tenant not found"));
    }

    // updatedTenant is a plain object (the findByIdAndUpdate query above is .lean()'d for
    // performance) — it has no .toObject() method, so calling it here threw a TypeError on
    // every single status change (terminate included), which surfaced to the user as a
    // generic 500 "Internal Server Error" even though the update itself had already
    // succeeded. The Tenant schema defines no virtuals, so there's nothing .toObject({
    // virtuals: true }) was actually adding — a plain shallow copy is equivalent.
    const tenantObj = { ...updatedTenant };
    tenantObj.status = computeOperationalTenantStatus({ tenant: updatedTenant });
    return res.status(200).json({ success: true, data: tenantObj, message: status === "terminated" ? "Tenant terminated successfully" : "Tenant status updated successfully" });
  } catch (err) {
    next(err);
  }
};

// Get tenant payments
export const getTenantPayments = async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.params.id).lean();

    const access = authorizeTenantAccess(req, tenant);
    if (!access.allowed) {
      return next(createError(access.status, access.message));
    }

    const foPropertyIds = await getFieldOfficerPropertyIds(req);
    if (foPropertyIds !== null) {
      const foSet = new Set(foPropertyIds.map(String));
      const unitDoc = tenant.unit ? await Unit.findById(tenant.unit, { property: 1 }).lean() : null;
      if (!unitDoc || !foSet.has(String(unitDoc.property))) {
        return next(createError(403, "Not authorized to access this tenant"));
      }
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const [payments, total] = await Promise.all([
      RentPayment.find({ tenant: req.params.id, business: tenant.business })
        .sort({ paymentDate: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      RentPayment.countDocuments({ tenant: req.params.id, business: tenant.business }),
    ]);

    return res.status(200).json({
      success: true,
      data: payments,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
};

// Get tenant balance
export const getTenantBalance = async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.params.id).lean();

    const access = authorizeTenantAccess(req, tenant);
    if (!access.allowed) {
      return next(createError(access.status, access.message));
    }

    const foPropertyIds = await getFieldOfficerPropertyIds(req);
    if (foPropertyIds !== null) {
      const foSet = new Set(foPropertyIds.map(String));
      const unitDoc = tenant.unit ? await Unit.findById(tenant.unit, { property: 1 }).lean() : null;
      if (!unitDoc || !foSet.has(String(unitDoc.property))) {
        return next(createError(403, "Not authorized to access this tenant"));
      }
    }

    const [totalAgg] = await RentPayment.aggregate([
      { $match: { tenant: tenant._id, business: tenant.business, paymentType: { $in: ["rent", "utility", "deposit"] }, isConfirmed: true } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const totalPaid = totalAgg?.total || 0;

    return res.status(200).json({
      success: true,
      data: {
        tenant: tenant.name,
        currentBalance: tenant.balance,
        totalPaid,
        unit: tenant.unit,
        depositHeldBy: tenant.depositHeldBy || "Management Company",
        depositAmount: Number(tenant.depositAmount || 0),
      },
    });
  } catch (err) {
    next(err);
  }
};

// Statement bundle — returns tenant + leases + receipts + invoices + notes in one request,
// replacing 5 separate API calls with a single parallel fetch.
export const getTenantStatementBundle = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    const tenantId = req.params.id;
    const filter = req.user?.isSystemAdmin
      ? { _id: tenantId }
      : { _id: tenantId, business: businessId };

    // Auth check — fast lean query
    const tenantBase = await Tenant.findOne(filter).select("_id business unit").lean();
    if (!tenantBase) return next(createError(404, "Tenant not found"));

    const foPropertyIds = await getFieldOfficerPropertyIds(req);
    if (foPropertyIds !== null) {
      const foSet = new Set(foPropertyIds.map(String));
      const unitDoc = tenantBase.unit ? await Unit.findById(tenantBase.unit, { property: 1 }).lean() : null;
      if (!unitDoc || !foSet.has(String(unitDoc.property))) {
        return next(createError(403, "Not authorized to access this tenant"));
      }
    }

    const bId = tenantBase.business;

    const [tenant, leases, receipts, invoices, invoiceNotes] = await Promise.all([
      // Full tenant with unit/property populate
      Tenant.findOne(filter)
        .populate({ path: "unit",            select: "unitNumber property rent amenities status utilities", populate: { path: "property", select: PROPERTY_SELECT } })
        .populate({ path: "additionalUnits", select: UNIT_SELECT, populate: { path: "property", select: PROPERTY_SELECT } })
        .lean(),

      // Leases for this tenant
      Lease.find({ business: bId, tenant: tenantId })
        .sort({ startDate: -1, createdAt: -1 })
        .limit(50)
        .populate("tenant", "name tenantCode email phone idNumber leaseType moveInDate moveOutDate status")
        .populate({ path: "unit", select: "unitNumber unitName property rent status", populate: { path: "property", select: "propertyName propertyCode name address landlords" } })
        .populate("landlord", "landlordName landlordCode phoneNumber email")
        .lean(),

      // Active receipts (limit 500 — same as frontend calls)
      RentPayment.find({ business: bId, tenant: tenantId, ledgerType: "receipts", isConfirmed: true, isCancelled: { $ne: true }, isReversed: { $ne: true }, reversalOf: null })
        .sort({ paymentDate: -1, createdAt: -1 })
        .limit(500)
        .lean(),

      // Invoices (pending / paid / partially_paid)
      TenantInvoice.find({ business: bId, tenant: tenantId, status: { $in: ["pending", "paid", "partially_paid"] } })
        .sort({ invoiceDate: -1, createdAt: -1 })
        .lean(),

      // Invoice notes
      TenantInvoiceNote.find({ business: bId, tenant: tenantId, status: { $nin: ["cancelled", "reversed"] } })
        .sort({ noteDate: -1, createdAt: -1 })
        .lean(),
    ]);

    return res.status(200).json({
      success: true,
      tenant,
      leases,
      receipts: { items: receipts, total: receipts.length },
      invoices,
      invoiceNotes,
    });
  } catch (err) {
    next(err);
  }
};

// Get tenant total due

export const getTenantTotalDue = async (tenantId) => {
  try {
    const tenant = await Tenant.findById(tenantId).select("unit additionalUnits rent balance").lean();
    if (!tenant) return { rent: 0, utilities: [], total: 0 };

    const assignedUnitIds = getTenantAssignedUnitIds(tenant);
    if (!assignedUnitIds.length) return { rent: 0, utilities: [], total: 0 };

    const units = await Unit.find({ _id: { $in: assignedUnitIds } })
      .populate("utilities.utility", "name unitCost billingCycle")
      .lean();

    if (!units.length) return { rent: 0, utilities: [], total: 0 };

    let totalRent = 0;
    let total = 0;
    const utilities = [];

    units.forEach((unit) => {
      const unitRent = Number(unit.rent || 0);
      totalRent += unitRent;
      total += unitRent;

      (unit.utilities || []).forEach((item) => {
        const utility = item.utility;
        if (!utility || item.isIncluded) return;

        let charge = 0;
        switch (utility.billingCycle) {
          case "monthly":
            charge = item.unitCharge || utility.unitCost || 0;
            break;
          case "quarterly":
            charge = (item.unitCharge || utility.unitCost || 0) / 3;
            break;
          case "yearly":
            charge = (item.unitCharge || utility.unitCost || 0) / 12;
            break;
          default:
            charge = item.unitCharge || utility.unitCost || 0;
        }

        utilities.push({
          unit: unit.unitNumber,
          utility: utility.name,
          amount: charge,
        });
        total += charge;
      });
    });

    return {
      rent: totalRent,
      utilities,
      total,
      tenantBalance: Number(tenant.balance || 0),
    };
  } catch (error) {
    console.error("Error calculating tenant total due:", error);
    return { rent: 0, utilities: [], total: 0, tenantBalance: 0 };
  }
};



export const transferTenantUnit = async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.params.id).lean();

    const access = authorizeTenantAccess(req, tenant);
    if (!access.allowed) {
      return next(createError(access.status, access.message.replace("access", "transfer")));
    }

    const nextPrimaryUnitId = toObjectIdString(req.body?.newUnit || req.body?.unit);
    if (!isValidObjectIdString(nextPrimaryUnitId)) {
      return next(createError(400, "A valid destination unit is required"));
    }

    const keepPreviousUnitAssigned = Boolean(req.body?.keepPreviousUnitAssigned);
    const reason = normalizeString(req.body?.reason) || "Tenant transferred to a new unit";
    const effectiveDate = req.body?.effectiveDate ? new Date(req.body.effectiveDate) : new Date();
    const depositTopUpAmount = Math.max(0, Number(req.body?.depositTopUpAmount || 0));
    const reduceDepositToNewUnit = Boolean(req.body?.reduceDepositToNewUnit);
    const previousPrimaryUnitId = toObjectIdString(tenant.unit);
    const previousAdditionalUnitIds = uniqueUnitIds(tenant.additionalUnits || []);

    // A transfer must not leave an unpaid invoice sitting against a unit the tenant no
    // longer occupies — that invoice keeps showing up on the landlord statement for a
    // unit that's now someone else's, misleadingly merged into the moved tenant's row.
    // Require the manager to cancel/resolve it first, so the statement stays clean.
    if (previousPrimaryUnitId && previousPrimaryUnitId !== nextPrimaryUnitId && !keepPreviousUnitAssigned) {
      const effectiveDayStart = new Date(effectiveDate);
      effectiveDayStart.setHours(0, 0, 0, 0);

      const openInvoicesAtPreviousUnit = await TenantInvoice.find({
        tenant: tenant._id,
        unit: previousPrimaryUnitId,
        business: tenant.business,
        status: { $in: ["pending", "partially_paid"] },
        invoiceDate: { $gte: effectiveDayStart },
      })
        .select("_id invoiceNumber amount invoiceDate category")
        .limit(20)
        .lean();

      if (openInvoicesAtPreviousUnit.length > 0) {
        const err = new Error(
          `This tenant has ${openInvoicesAtPreviousUnit.length} unpaid invoice(s) at their current unit dated on or after the transfer date (e.g. ${openInvoicesAtPreviousUnit[0].invoiceNumber || openInvoicesAtPreviousUnit[0]._id}). Cancel or resolve them before transferring, so the landlord statement doesn't keep showing charges for a unit they no longer occupy.`
        );
        err.statusCode = 409;
        err.code = "OPEN_INVOICES_AT_PREVIOUS_UNIT";
        err.openInvoiceIds = openInvoicesAtPreviousUnit.map((inv) => String(inv._id));
        return next(err);
      }
    }

    const nextAdditionalUnits = keepPreviousUnitAssigned && previousPrimaryUnitId && previousPrimaryUnitId !== nextPrimaryUnitId
      ? uniqueUnitIds([...previousAdditionalUnitIds, previousPrimaryUnitId]).filter((item) => item !== nextPrimaryUnitId)
      : previousAdditionalUnitIds.filter((item) => item !== nextPrimaryUnitId);

    const requestedUnits = buildRequestedTenantUnits({
      primaryUnitId: nextPrimaryUnitId,
      additionalUnits: nextAdditionalUnits,
    });

    const requestedUnitDocs = await ensureUnitsBelongToBusiness({
      businessId: tenant.business,
      unitIds: requestedUnits.all,
    });

    await ensureUnitsAvailableForTenant({
      businessId: tenant.business,
      unitDocs: requestedUnitDocs,
      currentTenantId: tenant._id,
      currentlyAssignedUnitIds: getTenantAssignedUnitIds(tenant),
    });

    const newUnitDeposit = Number(requestedUnitDocs.find((u) => String(u._id) === nextPrimaryUnitId)?.deposit || 0);
    const currentDepositAmount = Number(tenant.depositAmount || 0);

    let resolvedDepositAmount;
    if (depositTopUpAmount > 0) {
      resolvedDepositAmount = currentDepositAmount + depositTopUpAmount;
    } else if (reduceDepositToNewUnit && newUnitDeposit < currentDepositAmount) {
      resolvedDepositAmount = newUnitDeposit;
    }

    const updatedTenant = await populateTenantQuery(
      Tenant.findByIdAndUpdate(
        tenant._id,
        {
          $set: {
            unit: requestedUnits.primary,
            additionalUnits: requestedUnits.additional,
            rent: calculateTenantAssignedRent(requestedUnitDocs, tenant.rent || 0),
            utilities: deriveAssignedUtilitiesFromUnitDocs(requestedUnitDocs),
            ...(resolvedDepositAmount !== undefined && { depositAmount: resolvedDepositAmount }),
          },
          $push: {
            unitTransferHistory: {
              fromUnit: tenant.unit || null,
              toUnit: requestedUnits.primary || null,
              effectiveDate,
              reason,
              transferredBy:
                req.user?.id && mongoose.Types.ObjectId.isValid(String(req.user.id))
                  ? req.user.id
                  : null,
              previousAdditionalUnits: previousAdditionalUnitIds,
              nextAdditionalUnits: requestedUnits.additional,
            },
          },
        },
        { new: true, runValidators: true }
      ).lean()
    );

    // Sync the lease to reflect the new unit and updated rent
    await syncTenantLeaseRecord({ tenantDoc: updatedTenant, action: "upsert" }).catch((err) =>
      console.error("Lease sync after unit transfer failed:", err?.message)
    );

    await syncTenantAssignedUnitOccupancy({
      previousUnitIds: getTenantAssignedUnitIds(tenant),
      nextUnitIds: getTenantAssignedUnitIds(updatedTenant),
      tenantId: tenant._id,
      effectiveDate,
    });

    await logAuditEvent({
      req,
      company: tenant.business,
      action: "tenants.transfer_unit",
      category: "property",
      severity: "critical",
      targetType: "Tenant",
      targetId: tenant._id,
      targetName: tenantLabel(updatedTenant),
      message: `Transferred tenant ${tenantLabel(updatedTenant)} to another unit`,
      metadata: {
        fromUnit: previousPrimaryUnitId,
        toUnit: nextPrimaryUnitId,
        previousAdditionalUnits: previousAdditionalUnitIds,
        nextAdditionalUnits: getTenantAssignedUnitIds(updatedTenant).filter((id) => id !== nextPrimaryUnitId),
        effectiveDate,
        reason,
        depositTopUpAmount: depositTopUpAmount || 0,
        depositReduced: reduceDepositToNewUnit && resolvedDepositAmount !== undefined && resolvedDepositAmount < currentDepositAmount,
        newDepositAmount: resolvedDepositAmount ?? currentDepositAmount,
      },
    });

    return res.status(200).json({
      success: true,
      data: updatedTenant,
      message: "Tenant unit transferred successfully",
    });
  } catch (err) {
    next(err);
  }
};

// Undo the tenant's most recent unit transfer, moving them back to the unit they occupied
// before it. Only the single most recent, not-already-rolled-back transfer is eligible —
// and only while the tenant's current unit still matches where that transfer moved them to,
// so this never silently clobbers a later transfer or manual edit.
export const rollbackTenantTransfer = async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.params.id).lean();

    const access = authorizeTenantAccess(req, tenant);
    if (!access.allowed) {
      return next(createError(access.status, access.message.replace("access", "roll back a transfer for")));
    }

    const history = Array.isArray(tenant.unitTransferHistory) ? tenant.unitTransferHistory : [];
    const lastIndex = history.length - 1;
    const lastEntry = lastIndex >= 0 ? history[lastIndex] : null;

    if (!lastEntry || lastEntry.rolledBack) {
      return next(createError(400, "There is no recent unit transfer to roll back for this tenant."));
    }

    const targetUnitId = toObjectIdString(lastEntry.fromUnit);
    if (!targetUnitId) {
      return next(createError(400, "This transfer has no previous unit on record to roll back to."));
    }

    const currentPrimaryUnitId = toObjectIdString(tenant.unit);
    if (currentPrimaryUnitId !== toObjectIdString(lastEntry.toUnit)) {
      // Something has moved this tenant again since — another transfer or a manual edit.
      // Refuse rather than guess which state to restore.
      return next(
        createError(409, "This tenant's unit has changed since that transfer — rollback is no longer safe. Use Transfer Unit instead.")
      );
    }

    const previousAdditionalUnitIds = uniqueUnitIds(lastEntry.previousAdditionalUnits || []);
    const requestedUnits = buildRequestedTenantUnits({
      primaryUnitId: targetUnitId,
      additionalUnits: previousAdditionalUnitIds,
    });

    const requestedUnitDocs = await ensureUnitsBelongToBusiness({
      businessId: tenant.business,
      unitIds: requestedUnits.all,
    });

    await ensureUnitsAvailableForTenant({
      businessId: tenant.business,
      unitDocs: requestedUnitDocs,
      currentTenantId: tenant._id,
      currentlyAssignedUnitIds: getTenantAssignedUnitIds(tenant),
    });

    const rolledBackByUserId =
      req.user?.id && mongoose.Types.ObjectId.isValid(String(req.user.id)) ? req.user.id : null;

    const updatedTenant = await populateTenantQuery(
      Tenant.findByIdAndUpdate(
        tenant._id,
        {
          $set: {
            unit: requestedUnits.primary,
            additionalUnits: requestedUnits.additional,
            rent: calculateTenantAssignedRent(requestedUnitDocs, tenant.rent || 0),
            utilities: deriveAssignedUtilitiesFromUnitDocs(requestedUnitDocs),
            [`unitTransferHistory.${lastIndex}.rolledBack`]: true,
            [`unitTransferHistory.${lastIndex}.rolledBackAt`]: new Date(),
            [`unitTransferHistory.${lastIndex}.rolledBackBy`]: rolledBackByUserId,
          },
        },
        { new: true, runValidators: true }
      ).lean()
    );

    await syncTenantLeaseRecord({ tenantDoc: updatedTenant, action: "upsert" }).catch((err) =>
      console.error("Lease sync after transfer rollback failed:", err?.message)
    );

    await syncTenantAssignedUnitOccupancy({
      previousUnitIds: getTenantAssignedUnitIds(tenant),
      nextUnitIds: getTenantAssignedUnitIds(updatedTenant),
      tenantId: tenant._id,
      effectiveDate: new Date(),
    });

    await logAuditEvent({
      req,
      company: tenant.business,
      action: "tenants.rollback_transfer",
      category: "property",
      severity: "critical",
      targetType: "Tenant",
      targetId: tenant._id,
      targetName: tenantLabel(updatedTenant),
      message: `Rolled back unit transfer for ${tenantLabel(updatedTenant)} to their previous unit`,
      metadata: {
        rolledBackFromUnit: toObjectIdString(lastEntry.toUnit),
        rolledBackToUnit: targetUnitId,
        previousAdditionalUnits: previousAdditionalUnitIds,
      },
    });

    return res.status(200).json({
      success: true,
      data: updatedTenant,
      message: "Unit transfer rolled back successfully",
    });
  } catch (err) {
    next(err);
  }
};

// Bulk import tenants from Excel
export const bulkImportTenants = async (req, res, next) => {
  try {
    const { tenants: tenantsData } = req.body;
    const businessId = resolveBusinessId(req);

    if (!businessId) {
      return next(createError(400, "Business context is required"));
    }

    if (!Array.isArray(tenantsData) || tenantsData.length === 0) {
      return next(createError(400, "No tenant data provided"));
    }

    if (tenantsData.length > 1000) {
      return next(createError(400, "Maximum 1000 tenants per import"));
    }

    const units = await Unit.find({ business: businessId }).lean().limit(10000).select("_id unitNumber property status isVacant rent deposit utilities").populate("property", "propertyCode landlords depositHeldBy letManage lettingFeeMode lettingFeeValue");
    const unitMap = new Map();

    units.forEach((unit) => {
      const propertyCode = unit.property?.propertyCode?.toLowerCase();
      const unitNumber = unit.unitNumber?.toLowerCase();
      if (propertyCode && unitNumber) {
        unitMap.set(`${propertyCode}|${unitNumber}`, unit);
      }
    });

    const existingTenants = await Tenant.find({ business: businessId }).select("_id idNumber tenantCode").limit(10000).lean();
    const existingIds = new Set(
      existingTenants.map((t) => String(t.idNumber || "").toLowerCase()).filter(Boolean)
    );
    const existingCodes = new Set(
      existingTenants.map((t) => String(t.tenantCode || "").toLowerCase()).filter(Boolean)
    );

    // Pre-compute max tenant code once — avoids one aggregation per tenant row
    const maxCodeResult = await Tenant.aggregate([
      { $match: { business: new mongoose.Types.ObjectId(String(businessId)), tenantCode: { $regex: /^TT\d+$/ } } },
      { $project: { num: { $toInt: { $substr: ["$tenantCode", 2, -1] } } } },
      { $group: { _id: null, maxNum: { $max: "$num" } } },
    ]);
    let nextTenantCodeNum = (maxCodeResult[0]?.maxNum ?? 0) + 1;

    const successful = [];
    const failed = [];
    const docsToInsert = [];

    for (let i = 0; i < tenantsData.length; i++) {
      const record = tenantsData[i];
      const rowIndex = Number(record?.rowNumber || i + 2);

      try {
        const normalizedTenantName = normalizeString(record.tenantName);
        const normalizedPhoneNumber = isPlaceholder(record.phoneNumber) ? null : normalizeKenyanPhoneForStorage(record.phoneNumber);
        const normalizedIdNumber = isPlaceholder(record.idNumber) ? null : normalizeString(record.idNumber);

        if (!normalizedTenantName) {
          failed.push({
            tenantName: record.tenantName,
            error: "Tenant Name is required",
            row: rowIndex,
          });
          continue;
        }

        if (!record.propertyCode) {
          failed.push({
            tenantName: record.tenantName,
            error: "Property Code is required",
            row: rowIndex,
          });
          continue;
        }

        const propertyCode = String(record.propertyCode || "").trim().toLowerCase();
        const primaryUnitNumber = String(record.unitNumber || "").trim().toLowerCase();
        const unitLookupKey = `${propertyCode}|${primaryUnitNumber}`;
        const primaryUnitDoc = unitMap.get(unitLookupKey);

        if (!primaryUnitDoc) {
          failed.push({
            tenantName: record.tenantName,
            error: `Combination not found: Property "${record.propertyCode}" + Unit "${record.unitNumber}"`,
            row: rowIndex,
          });
          continue;
        }

        const additionalUnitNumbers = normalizeImportedAdditionalUnitNumbers(record).filter(
          (unitNumber) => unitNumber.toLowerCase() !== primaryUnitNumber
        );
        const requestedUnitDocs = [primaryUnitDoc];
        let missingAdditionalUnit = null;

        for (const additionalUnitNumber of additionalUnitNumbers) {
          const additionalUnitDoc = unitMap.get(`${propertyCode}|${String(additionalUnitNumber).trim().toLowerCase()}`);
          if (!additionalUnitDoc) {
            missingAdditionalUnit = additionalUnitNumber;
            break;
          }
          requestedUnitDocs.push(additionalUnitDoc);
        }

        if (missingAdditionalUnit) {
          failed.push({
            tenantName: record.tenantName,
            error: `Additional unit "${missingAdditionalUnit}" was not found under property "${record.propertyCode}"`,
            row: rowIndex,
          });
          continue;
        }

        const requestedUnits = buildRequestedTenantUnits({
          primaryUnitId: primaryUnitDoc._id,
          additionalUnits: requestedUnitDocs.slice(1).map((unit) => unit._id),
        });

        const importedTenantStatus = normalizeTenantStatus(record.status || "active");
        const importedTenantOccupiesUnits = shouldTenantOccupyUnits(importedTenantStatus);

        if (importedTenantOccupiesUnits) {
          // In-memory check: unitMap tracks occupancy from initial fetch + within-batch updates
          const unavailableUnit = requestedUnitDocs.find((u) => u.status !== "vacant" || u.isVacant === false);
          if (unavailableUnit) {
            failed.push({
              tenantName: record.tenantName,
              error: `Unit ${unavailableUnit.unitNumber || unavailableUnit._id} is not available`,
              row: rowIndex,
            });
            continue;
          }
        }

        const normalizedIdNumberKey = String(normalizedIdNumber || "").trim().toLowerCase();
        if (normalizedIdNumberKey && existingIds.has(normalizedIdNumberKey)) {
          failed.push({
            tenantName: record.tenantName,
            error: `Duplicate ID number: ${record.idNumber}`,
            row: rowIndex,
          });
          continue;
        }

        const leaseType = normalizeLower(record.leaseType || "at_will");
        if (!["at_will", "fixed"].includes(leaseType)) {
          failed.push({
            tenantName: record.tenantName,
            error: `Invalid lease type: ${record.leaseType}. Must be at_will or fixed`,
            row: rowIndex,
          });
          continue;
        }

        const moveInDate = record.moveInDate ? new Date(record.moveInDate) : null;
        const moveOutDate = record.moveOutDate ? new Date(record.moveOutDate) : null;

        if (!moveInDate || Number.isNaN(moveInDate.getTime())) {
          failed.push({
            tenantName: record.tenantName,
            error: `Invalid move-in date for tenant ${record.tenantName}`,
            row: rowIndex,
          });
          continue;
        }

        if (leaseType === "fixed") {
          if (!moveOutDate || Number.isNaN(moveOutDate.getTime())) {
            failed.push({
              tenantName: record.tenantName,
              error: "Move-out date is required for fixed lease type",
              row: rowIndex,
            });
            continue;
          }

          if (moveOutDate <= moveInDate) {
            failed.push({
              tenantName: record.tenantName,
              error: "Move-out date must be after move-in date for fixed lease type",
              row: rowIndex,
            });
            continue;
          }
        }

        let tenantCode = normalizeString(record.tenantCode);
        if (!tenantCode) {
          tenantCode = `TT${String(nextTenantCodeNum++).padStart(4, "0")}`;
        } else if (existingCodes.has(tenantCode.toLowerCase())) {
          failed.push({
            tenantName: record.tenantName,
            error: `Duplicate tenant code: ${tenantCode}`,
            row: rowIndex,
          });
          continue;
        }

        const propertyServiceMode = normalizePropertyServiceMode(primaryUnitDoc?.property?.letManage);
        const isPropertyLettingOnly = propertyServiceMode === "Letting";
        const isPropertyWithLettingFee = hasLettingFee(propertyServiceMode);
        const propertyDepositHeldBy = isPropertyLettingOnly
          ? "landlord"
          : (primaryUnitDoc?.property?.depositHeldBy || "propertyManager");
        const hasExplicitRent = record.rent !== undefined && record.rent !== null && String(record.rent).trim() !== "";
        const requestedRent = hasExplicitRent ? Number(record.rent || 0) : 0;
        const computedRent = calculateTenantAssignedRent(requestedUnitDocs, primaryUnitDoc.rent || 0);
        const hasExplicitDeposit = record.depositAmount !== undefined && record.depositAmount !== null && String(record.depositAmount).trim() !== "";
        const depositAmount = Number(
          hasExplicitDeposit
            ? record.depositAmount
            : (primaryUnitDoc.deposit ?? (requestedRent > 0 ? requestedRent : computedRent))
        );
        const assignedRent = requestedRent > 0 ? requestedRent : computedRent;
        const computedLettingFeeAmount = (() => {
          if (!isPropertyWithLettingFee) return 0;
          const feeMode = primaryUnitDoc?.property?.lettingFeeMode || "percentage";
          const feeValue = Math.max(0, parseFloat(primaryUnitDoc?.property?.lettingFeeValue ?? 100) || 0);
          if (feeMode === "fixed") return feeValue;
          return Math.round((feeValue / 100) * assignedRent * 100) / 100;
        })();
        const importedUtilities = Array.isArray(record.utilities)
          ? record.utilities
          : Array.isArray(record.additionalUtilities)
          ? record.additionalUtilities
          : [];

        const newTenant = new Tenant({
          name: normalizedTenantName,
          phone: normalizedPhoneNumber,
          idNumber: normalizedIdNumber,
          unit: primaryUnitDoc._id,
          additionalUnits: requestedUnits.additional,
          rent: assignedRent,
          balance: 0,
          status: importedTenantStatus,
          depositAmount,
          depositHeldBy: normalizeDepositHolder(record.depositHeldBy, propertyDepositHeldBy),
          depositRefundStatus: depositAmount > 0 ? "pending" : "not_applicable",
          depositRefundAmount: depositAmount,
          lettingFeeAmount: computedLettingFeeAmount,
          paymentMethod: normalizePaymentMethod(record.paymentMethod),
          leaseType,
          moveInDate,
          moveOutDate: leaseType === "fixed" ? moveOutDate : null,
          tenantCode,
          business: businessId,
          utilities: sanitizeUtilities(importedUtilities.length > 0 ? importedUtilities : deriveAssignedUtilitiesFromUnitDocs(requestedUnitDocs)),
          emergencyContact: {
            name: normalizeString(record.emergencyContactName) || "",
            phone: normalizeString(record.emergencyContactPhone) || "",
            relationship: normalizeString(record.emergencyContactRelationship) || "",
          },
        });

        docsToInsert.push({ doc: newTenant, primaryUnitDoc, requestedUnitDocs, importedTenantOccupiesUnits, rowIndex, record });

        if (normalizedIdNumberKey) existingIds.add(normalizedIdNumberKey);
        existingCodes.add(String(tenantCode).toLowerCase());
        if (importedTenantOccupiesUnits) {
          requestedUnitDocs.forEach((unitDoc) => {
            const code = unitDoc.property?.propertyCode?.toLowerCase();
            const number = unitDoc.unitNumber?.toLowerCase();
            if (code && number) {
              unitMap.set(`${code}|${number}`, { ...unitDoc, status: "occupied", isVacant: false });
            }
          });
        }
      } catch (error) {
        failed.push({
          tenantName: record.tenantName,
          error: error.message || "Unknown error occurred",
          row: rowIndex,
        });
      }
    }

    // Parallel saves — all tenants at once instead of sequential
    if (docsToInsert.length > 0) {
      const saveResults = await Promise.allSettled(docsToInsert.map(item => item.doc.save()));

      const unitBulkOps = [];
      const affectedPropertyIds = new Set();
      // Deferred functions — NOT started yet. Lease syncs must run sequentially to avoid
      // generateAgreementNumber race: parallel calls read the same max sequence and all
      // generate the same AGR-YYYYMM-XXXX, causing 11000 duplicate key collisions.
      const leaseSyncFns = [];

      for (let i = 0; i < docsToInsert.length; i++) {
        const item = docsToInsert[i];
        const result = saveResults[i];

        if (result.status === "rejected") {
          failed.push({
            tenantName: item.record.tenantName,
            error: result.reason?.message || "Failed to save tenant",
            row: item.rowIndex,
          });
          continue;
        }

        const savedTenant = result.value;
        const successEntry = { tenantName: item.record.tenantName, _id: savedTenant._id, tenantCode: savedTenant.tenantCode, agreementNumber: "" };
        successful.push(successEntry);

        if (item.importedTenantOccupiesUnits) {
          for (const unitDoc of item.requestedUnitDocs) {
            unitBulkOps.push({
              updateOne: {
                filter: { _id: unitDoc._id, isVacant: { $ne: false } },
                update: { $set: { status: "occupied", isVacant: false, vacantSince: null, daysVacant: 0, lastTenant: savedTenant._id } },
              },
            });
            const propId = String(unitDoc.property?._id || unitDoc.property || "");
            if (propId && mongoose.Types.ObjectId.isValid(propId)) affectedPropertyIds.add(propId);
          }
        }

        // Capture closure values now; execution is deferred until after unit writes.
        const capturedTenant = savedTenant;
        const capturedEntry = successEntry;
        const capturedUnitDoc = item.primaryUnitDoc;
        leaseSyncFns.push(async () => {
          try {
            const lease = await syncTenantLeaseRecord({ tenantDoc: capturedTenant, unitDoc: capturedUnitDoc, action: "upsert" });
            capturedEntry.agreementNumber = lease?.agreementNumber || "";
          } catch (err) {
            console.error(`Lease sync failed for ${capturedTenant.tenantCode || capturedTenant._id}:`, err);
          }
        });
      }

      // Unit updates and property counts run first, then lease syncs run one-by-one
      // so each generateAgreementNumber call sees the previous lease already committed.
      if (unitBulkOps.length > 0) await Unit.bulkWrite(unitBulkOps, { ordered: false });
      if (affectedPropertyIds.size > 0) {
        await Promise.all([...affectedPropertyIds].map(id => updatePropertyUnitCounts(id)));
      }
      for (const fn of leaseSyncFns) await fn();
    }

    return res.status(200).json({
      success: true,
      data: {
        successful,
        failed,
        totalProcessed: tenantsData.length,
        successCount: successful.length,
        failureCount: failed.length,
      },
    });
  } catch (error) {
    console.error("Bulk import error:", error);
    next(error);
  }
};

// Backfill endpoint: Create lease agreements for tenants that don't have one
export const backfillMissingLeases = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) {
      return next(createError(400, "Business context is required"));
    }

    // Find tenants with no active/pending lease
    const [tenantsWithLease, tenants] = await Promise.all([
      Lease.find({
        business: businessId,
        status: { $in: ["draft", "pending_signature", "active"] },
      }).distinct("tenant"),
      Tenant.find({
        business: businessId,
        status: { $in: ACTIVE_TENANT_STATUSES },
      })
        .populate({ path: "unit", populate: { path: "property", select: "landlords depositHeldBy letManage propertyCode" } })
        .lean(),
    ]);

    const tenantIdsWithLease = new Set(tenantsWithLease.map(String));

    const missing = tenants.filter((t) => !tenantIdsWithLease.has(String(t._id)));

    if (missing.length === 0) {
      return res.status(200).json({
        success: true,
        message: "All active tenants already have lease agreements",
        created: 0,
        failed: 0,
        details: [],
      });
    }

    const results = [];

    // Sequential — avoids generateAgreementNumber race condition
    for (const tenant of missing) {
      try {
        const lease = await syncTenantLeaseRecord({
          tenantDoc: tenant,
          unitDoc: tenant.unit || null,
          action: "upsert",
        });
        results.push({ tenantCode: tenant.tenantCode, name: tenant.name, agreementNumber: lease?.agreementNumber || "", status: "created" });
      } catch (err) {
        results.push({ tenantCode: tenant.tenantCode, name: tenant.name, error: err.message, status: "failed" });
      }
    }

    const created = results.filter((r) => r.status === "created").length;
    const failed = results.filter((r) => r.status === "failed").length;

    return res.status(200).json({
      success: true,
      message: `Backfill complete: ${created} created, ${failed} failed`,
      created,
      failed,
      details: results,
    });
  } catch (err) {
    next(err);
  }
};

// Migration endpoint: Assign tenant codes to existing tenants without codes
export const migrateTenantCodes = async (req, res, next) => {
  try {
    const business = resolveBusinessId(req);

    if (!business) {
      return next(createError(400, "Business context is required"));
    }

    const [tenantsWithoutCodes, tenantsWithCodes] = await Promise.all([
      Tenant.find({
        business,
        $or: [{ tenantCode: { $exists: false } }, { tenantCode: null }, { tenantCode: "" }],
      }).sort({ createdAt: 1 }).lean(),
      Tenant.find({
        business,
        tenantCode: { $regex: /^TT\d+$/ },
      })
        .select("tenantCode")
        .lean(),
    ]);

    if (tenantsWithoutCodes.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No tenants found without codes",
        updated: 0,
      });
    }

    const existingNumbers = tenantsWithCodes
      .map((t) => parseInt(String(t.tenantCode || "").replace("TT", ""), 10))
      .filter((n) => !Number.isNaN(n));

    let nextNumber = existingNumbers.length ? Math.max(...existingNumbers) + 1 : 1;
    const updates = [];
    const bulkOps = [];

    for (const tenant of tenantsWithoutCodes) {
      const tenantCode = `TT${String(nextNumber).padStart(4, "0")}`;
      nextNumber += 1;
      bulkOps.push({ updateOne: { filter: { _id: tenant._id }, update: { $set: { tenantCode } } } });
      updates.push({ tenantId: tenant._id, tenantName: tenant.name, assignedCode: tenantCode });
    }

    let updatedCount = 0;
    if (bulkOps.length > 0) {
      const result = await Tenant.bulkWrite(bulkOps, { ordered: false });
      updatedCount = result.modifiedCount ?? bulkOps.length;
    }

    return res.status(200).json({
      success: true,
      message: `Successfully assigned codes to ${updatedCount} tenants`,
      updated: updatedCount,
      details: updates,
    });
  } catch (err) {
    next(err);
  }
};

