import mongoose from "mongoose";
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
import LandlordStatementLine from "../../models/LandlordStatementLine.js";
import Maintenance from "../../models/Maintenance.js";
import Inspection from "../../models/Inspection.js";
import MeterReading from "../../models/MeterReading.js";
import { createTenantInvoiceRecord, resolveLeaseAgreementFeeIncomeAccount } from "./tenantInvoices.js";
import { isAgreementNumberDuplicateError, saveLeaseWithUniqueAgreementNumber } from "../../services/agreementNumberService.js";
import { logAuditEvent } from "../../utils/auditLogger.js";


const ACTIVE_TENANT_STATUSES = ["active", "overdue"];
const VALID_PAYMENT_METHODS = ["bank_transfer", "mobile_money", "cash", "check", "credit_card"];

const normalizePropertyServiceMode = (value = "Managing") => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "letting" ? "Letting" : "Managing";
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

const populateTenantQuery = (query) =>
  query
    .populate("unit", "unitNumber property rent status utilities")
    .populate("unit.property", "propertyName propertyCode address name propertyType depositHeldBy")
    .populate("additionalUnits", "unitNumber property rent status utilities")
    .populate("additionalUnits.property", "propertyName propertyCode address name propertyType depositHeldBy");

const calculateTenantAssignedRent = (unitDocs = [], fallback = 0) => {
  const total = unitDocs.reduce((sum, unit) => sum + Number(unit?.rent || 0), 0);
  return total > 0 ? total : Number(fallback || 0);
};

const ensureUnitsBelongToBusiness = async ({ businessId, unitIds = [] } = {}) => {
  const normalizedIds = uniqueUnitIds(unitIds);
  const unitDocs = await Unit.find({
    _id: { $in: normalizedIds },
    business: businessId,
  }).populate("property", "depositHeldBy landlords letManage lettingFeeMode lettingFeeValue");

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

  for (const unitId of toVacate) {
    await setUnitVacant(unitId, tenantId, effectiveDate);
  }

  for (const unitId of toOccupy) {
    await setUnitOccupied(unitId, tenantId);
  }
};


const resolveBusinessId = (req) => {
  return (
    (req.user?.isSystemAdmin && (req.body?.business || req.query?.business)) ||
    req.user?.company ||
    req.user?.business ||
    null
  );
};

const normalizeString = (value) => (typeof value === "string" ? value.trim() : value);

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
    (tenantDoc.unit ? await Unit.findById(tenantDoc.unit).populate("property", "landlords") : null);
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
  const existingTenants = await Tenant.find({
    business: businessId,
    tenantCode: { $regex: /^TT\d+$/ },
  })
    .select("tenantCode")
    .lean();

  if (existingTenants.length > 0) {
    const numbers = existingTenants
      .map((t) => parseInt(String(t.tenantCode || "").replace("TT", ""), 10))
      .filter((n) => !Number.isNaN(n));

    const maxNumber = numbers.length ? Math.max(...numbers) : 0;
    return `TT${String(maxNumber + 1).padStart(4, "0")}`;
  }

  return "TT0001";
};

export const updatePropertyUnitCounts = async (propertyId) => {
  try {
    const occupiedCount = await Unit.countDocuments({
      property: propertyId,
      status: "occupied",
    });

    const vacantCount = await Unit.countDocuments({
      property: propertyId,
      status: "vacant",
    });

    const totalCount = await Unit.countDocuments({ property: propertyId });

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
  const unit = await Unit.findById(unitId);
  if (!unit) return null;

  await Unit.findByIdAndUpdate(unitId, {
    status: "occupied",
    isVacant: false,
    vacantSince: null,
    daysVacant: 0,
    lastTenant: tenantId,
  });

  if (unit.property) {
    await updatePropertyUnitCounts(unit.property);
  }

  return unit;
};


const setUnitVacant = async (unitId, tenantId, effectiveDate = new Date()) => {
  const unit = await Unit.findById(unitId);
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

  if (unit.property) {
    await updatePropertyUnitCounts(unit.property);
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
    Receipt.countDocuments({ tenant: tenantId }),
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
    LandlordStatementLine.countDocuments({ tenant: tenantId }),
    Maintenance.countDocuments({ tenant: tenantId }),
    Inspection.countDocuments({ tenant: tenantId }),
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

  return {
    summary,
    hasDependencies: Object.values(summary).some((count) => Number(count || 0) > 0),
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
      return res.status(400).json({
        success: false,
        message: "Invalid lease type. Use at_will or fixed",
      });
    }

    if (leaseType === "fixed") {
      if (!req.body.moveOutDate) {
        return res.status(400).json({
          success: false,
          message: "Move-out date is required for fixed leases",
        });
      }

      const moveInDate = new Date(req.body.moveInDate);
      const moveOutDate = new Date(req.body.moveOutDate);

      if (
        Number.isNaN(moveInDate.getTime()) ||
        Number.isNaN(moveOutDate.getTime()) ||
        moveOutDate <= moveInDate
      ) {
        return res.status(400).json({
          success: false,
          message: "Move-out date must be after move-in date for fixed leases",
        });
      }
    }

    const businessId = resolveBusinessId(req);

    if (!businessId) {
      return res.status(400).json({
        success: false,
        message:
          "Business context is required to create a tenant. Please ensure you are logged in with a company account.",
      });
    }

    if (!req.body.unit || !mongoose.Types.ObjectId.isValid(req.body.unit)) {
      return res.status(400).json({
        success: false,
        message: "A valid unit is required",
      });
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
    const isPropertyLetting = propertyServiceMode === "Letting";

    // In Letting mode the landlord holds deposits; use "landlord" as the fallback
    // when the caller has not explicitly specified a depositHeldBy value.
    const effectivePropertyDepositHolder = isPropertyLetting
      ? "landlord"
      : (unit?.property?.depositHeldBy || "propertyManager");

    const normalizedName = normalizeString(req.body.name);
    const normalizedPhone = normalizeString(req.body.phone);
    const normalizedIdNumber = normalizeString(req.body.idNumber);
    const normalizedPaymentMethod = normalizePaymentMethod(req.body.paymentMethod);
    const normalizedTenantCode = normalizeString(req.body.tenantCode);

    if (!normalizedName || !normalizedPhone || !normalizedIdNumber) {
      return res.status(400).json({
        success: false,
        message: "Tenant name, phone, and ID number are required",
      });
    }

    const duplicateTenant = await Tenant.findOne({
      business: businessId,
      $or: [
        { idNumber: normalizedIdNumber },
        ...(normalizedTenantCode ? [{ tenantCode: normalizedTenantCode }] : []),
      ],
    }).lean();

    if (duplicateTenant) {
      if (duplicateTenant.idNumber === normalizedIdNumber) {
        return res.status(400).json({
          success: false,
          message: "Tenant ID number already exists in this company",
        });
      }

      if (normalizedTenantCode && duplicateTenant.tenantCode === normalizedTenantCode) {
        return res.status(400).json({
          success: false,
          message: "Tenant code already exists in this company",
        });
      }
    }

    const tenantCode = normalizedTenantCode || (await generateNextTenantCode(businessId));
    const defaultDepositAmount = Number(
      req.body.depositAmount ?? unit.deposit ?? req.body.rent ?? unit.rent ?? 0
    );

    const createLeaseFeeInvoice = req.body.createLeaseFeeInvoice === true || String(req.body.createLeaseFeeInvoice || "").trim().toLowerCase() === "true";
    const leaseFeeAmount = Number(req.body.leaseFeeAmount || 0);
    const leaseFeeDescription = String(req.body.leaseFeeDescription || "").trim();

    if (createLeaseFeeInvoice && leaseFeeAmount > 0) {
      const landlordId = getPrimaryLandlordIdFromProperty(unit?.property);
      if (!landlordId) {
        return res.status(400).json({
          success: false,
          message: "Cannot create lease/agreement fee because the property has no assigned landlord.",
        });
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
        return res.status(accountError?.statusCode || 400).json({
          success: false,
          message: accountError?.message || "Lease/agreement fee income account not found. Configure Lease / Agreement Fee Income Account under Accounting Defaults.",
        });
      }
    }

    const assignedRent = calculateTenantAssignedRent(unitDocs, req.body.rent || unit.rent || 0);

    const computedLettingFeeAmount = (() => {
      if (!isPropertyLetting) return 0;
      const feeMode = unit?.property?.lettingFeeMode || "percentage";
      const feeValue = Math.max(0, parseFloat(unit?.property?.lettingFeeValue ?? 100) || 0);
      if (feeMode === "fixed") return feeValue;
      return Math.round((feeValue / 100) * assignedRent * 100) / 100;
    })();

    const newTenant = new Tenant({
      ...req.body,
      name: normalizedName,
      phone: normalizedPhone,
      idNumber: normalizedIdNumber,
      paymentMethod: normalizedPaymentMethod,
      leaseType,
      moveOutDate: leaseType === "fixed" ? req.body.moveOutDate : null,
      tenantCode,
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
    });

    const savedTenant = await newTenant.save();

    await syncTenantAssignedUnitOccupancy({
      previousUnitIds: [],
      nextUnitIds: shouldTenantOccupyUnits(savedTenant) ? getTenantAssignedUnitIds(savedTenant) : [],
      tenantId: savedTenant._id,
      effectiveDate: new Date(),
    });

    const populatedTenant = await populateTenantQuery(Tenant.findById(savedTenant._id));

    await syncTenantLeaseRecord({
      tenantDoc: populatedTenant,
      unitDoc: unit,
      action: "upsert",
    });

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

    return res.status(201).json({
      success: true,
      data: populatedTenant,
      message: "Tenant created successfully",
    });
  } catch (err) {
    console.error("Create tenant error:", err);

    if (err?.code === 11000) {
      if (isAgreementNumberDuplicateError(err)) {
        return res.status(409).json({
          success: false,
          message: "Tenant could not be created because the lease agreement number already exists. Please try again.",
        });
      }

      const duplicateField = Object.keys(err.keyPattern || {})[0] || "field";

      if (duplicateField === "idNumber") {
        return res.status(400).json({
          success: false,
          message: "Tenant ID number already exists in this company",
        });
      }

      if (duplicateField === "tenantCode") {
        return res.status(400).json({
          success: false,
          message: "Tenant code already exists in this company",
        });
      }
    }

    if (err?.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: Object.values(err.errors || {})
          .map((error) => error?.message)
          .filter(Boolean)
          .join("; ") || "Tenant validation failed",
      });
    }

    return res.status(500).json({
      success: false,
      message: err.message || "Failed to create tenant",
    });
  }
};

// Get all tenants
export const getTenants = async (req, res, next) => {
  try {
    const { status, unit } = req.query;
    const businessId = resolveBusinessId(req);

    if (!businessId) {
      return res.status(400).json({
        success: false,
        message: "Business context is required to fetch tenants",
      });
    }

    const filter = { business: businessId };

    if (status) filter.status = status;

    if (unit) {
      const unitDoc = await Unit.findOne({ _id: unit, business: businessId }).select("_id");
      if (!unitDoc) {
        return res.status(404).json({
          success: false,
          message: "Selected unit was not found",
        });
      }
      filter.unit = unit;
    }

    const tenants = await Tenant.find(filter)
      .populate("unit", "unitNumber property rent status utilities")
      .populate("unit.property", "propertyName propertyCode address name propertyType depositHeldBy")
      .populate("additionalUnits", "unitNumber property rent status utilities")
      .populate("additionalUnits.property", "propertyName propertyCode address name propertyType depositHeldBy")
      .sort({ createdAt: -1 });

    const enrichedTenants = tenants.map((tenantDoc) => {
      const tenant = typeof tenantDoc?.toObject === "function" ? tenantDoc.toObject() : tenantDoc;
      return {
        ...tenant,
        status: computeOperationalTenantStatus({ tenant }),
      };
    });

    return res.status(200).json({
      success: true,
      data: enrichedTenants,
      count: enrichedTenants.length,
    });
  } catch (err) {
    next(err);
  }
};

// Get single tenant
export const getTenant = async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.params.id)
      .populate("unit", "unitNumber property rent amenities status utilities")
      .populate("unit.property", "propertyName propertyCode address name propertyType depositHeldBy")
      .populate("additionalUnits", "unitNumber property rent status utilities")
      .populate("additionalUnits.property", "propertyName propertyCode address name propertyType depositHeldBy");

    const access = authorizeTenantAccess(req, tenant);
    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    return res.status(200).json({
      success: true,
      data: tenant,
    });
  } catch (err) {
    next(err);
  }
};

// Update tenant
export const updateTenant = async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.params.id);

    const access = authorizeTenantAccess(req, tenant);
    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message.replace("access", "update"),
      });
    }

    const normalizedPayload = { ...req.body };
    delete normalizedPayload.business;
    delete normalizedPayload._id;
    delete normalizedPayload.createdAt;
    delete normalizedPayload.updatedAt;

    if (normalizedPayload.name !== undefined) {
      normalizedPayload.name = normalizeString(normalizedPayload.name);
    }

    if (normalizedPayload.phone !== undefined) {
      normalizedPayload.phone = normalizeString(normalizedPayload.phone);
    }

    if (normalizedPayload.idNumber !== undefined) {
      normalizedPayload.idNumber = normalizeString(normalizedPayload.idNumber);
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
      normalizedPayload.depositAmount = Number(normalizedPayload.depositAmount || 0);
    }

    if (normalizedPayload.depositRefundAmount !== undefined) {
      normalizedPayload.depositRefundAmount = Number(normalizedPayload.depositRefundAmount || 0);
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
        return res.status(400).json({
          success: false,
          message: "A valid unit is required",
        });
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
        (tenant.unit ? await Unit.findById(tenant.unit).populate("property", "depositHeldBy") : null);

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
          return res.status(400).json({
            success: false,
            message: "Tenant ID number already exists in this company",
          });
        }

        if (
          normalizedPayload.tenantCode &&
          duplicateTenant.tenantCode === normalizedPayload.tenantCode
        ) {
          return res.status(400).json({
            success: false,
            message: "Tenant code already exists in this company",
          });
        }
      }
    }

    delete normalizedPayload.transferReason;

    const updatedTenant = await populateTenantQuery(
      Tenant.findByIdAndUpdate(
        req.params.id,
        { $set: normalizedPayload },
        { new: true, runValidators: true }
      )
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
        return res.status(409).json({
          success: false,
          message: "Tenant could not be created because the lease agreement number already exists. Please try again.",
        });
      }

      const duplicateField = Object.keys(err.keyPattern || {})[0] || "field";

      if (duplicateField === "idNumber") {
        return res.status(400).json({
          success: false,
          message: "Tenant ID number already exists in this company",
        });
      }

      if (duplicateField === "tenantCode") {
        return res.status(400).json({
          success: false,
          message: "Tenant code already exists in this company",
        });
      }
    }

    next(err);
  }
};

// Delete tenant
export const deleteTenant = async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.params.id);

    const access = authorizeTenantAccess(req, tenant);
    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message.replace("access", "delete"),
      });
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

    await Tenant.findByIdAndDelete(req.params.id);
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

// Update tenant status
export const updateTenantStatus = async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.params.id);

    const access = authorizeTenantAccess(req, tenant);
    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
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
      return res.status(400).json({
        success: false,
        message: "Tenant status is required",
      });
    }

    const currentAssignedUnitIds = getTenantAssignedUnitIds(tenant);
    const previousOccupiedUnitIds = shouldTenantOccupyUnits(tenant) ? currentAssignedUnitIds : [];
    const nextOccupiedUnitIds = shouldTenantOccupyUnits(status) ? currentAssignedUnitIds : [];
    const updateData = { status };

    if (status === "terminated") {
      const effectiveTerminationDate = terminationDate ? new Date(terminationDate) : new Date();
      if (Number.isNaN(effectiveTerminationDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "A valid termination date is required",
        });
      }

      const today = new Date();
      today.setHours(23, 59, 59, 999);
      if (effectiveTerminationDate.getTime() > today.getTime()) {
        return res.status(400).json({
          success: false,
          message: "Future-dated termination is not supported. Use today or an earlier date.",
        });
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
        return res.status(400).json({
          success: false,
          message: "Cannot activate tenant because no unit is assigned",
        });
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
    }

    const updatedTenantDoc = await populateTenantQuery(
      Tenant.findByIdAndUpdate(
        req.params.id,
        { $set: updateData },
        { new: true, runValidators: true }
      )
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

    await syncTenantLeaseRecord({
      tenantDoc: updatedTenantDoc,
      action: status === "terminated" ? "terminate" : "upsert",
      effectiveDate: updateData.terminationDate || updateData.moveOutDate || null,
      terminationReason,
    });

    const updatedTenant =
      typeof updatedTenantDoc?.toObject === "function"
        ? updatedTenantDoc.toObject()
        : updatedTenantDoc;

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

    return res.status(200).json({
      ...updatedTenant,
      status: computeOperationalTenantStatus({ tenant: updatedTenant }),
    });
  } catch (err) {
    next(err);
  }
};

// Get tenant payments
export const getTenantPayments = async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.params.id);

    const access = authorizeTenantAccess(req, tenant);
    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    const payments = await RentPayment.find({
      tenant: req.params.id,
      business: tenant.business,
    }).sort({
      paymentDate: -1,
    });

    return res.status(200).json({
      success: true,
      data: payments,
    });
  } catch (err) {
    next(err);
  }
};

// Get tenant balance
export const getTenantBalance = async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.params.id);

    const access = authorizeTenantAccess(req, tenant);
    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    const payments = await RentPayment.find({
      tenant: req.params.id,
      business: tenant.business,
      paymentType: { $in: ["rent", "utility", "deposit"] },
      isConfirmed: true,
    });

    const totalPaid = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

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

// Get tenant total due

export const getTenantTotalDue = async (tenantId) => {
  try {
    const tenant = await Tenant.findById(tenantId).populate("unit additionalUnits");
    if (!tenant) return { rent: 0, utilities: [], total: 0 };

    const assignedUnitIds = getTenantAssignedUnitIds(tenant);
    if (!assignedUnitIds.length) return { rent: 0, utilities: [], total: 0 };

    const units = await Unit.find({ _id: { $in: assignedUnitIds } }).populate(
      "utilities.utility",
      "name unitCost billingCycle"
    );

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
    const tenant = await Tenant.findById(req.params.id);

    const access = authorizeTenantAccess(req, tenant);
    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message.replace("access", "transfer"),
      });
    }

    const nextPrimaryUnitId = toObjectIdString(req.body?.newUnit || req.body?.unit);
    if (!isValidObjectIdString(nextPrimaryUnitId)) {
      return res.status(400).json({
        success: false,
        message: "A valid destination unit is required",
      });
    }

    const keepPreviousUnitAssigned = Boolean(req.body?.keepPreviousUnitAssigned);
    const reason = normalizeString(req.body?.reason) || "Tenant transferred to a new unit";
    const effectiveDate = req.body?.effectiveDate ? new Date(req.body.effectiveDate) : new Date();
    const previousPrimaryUnitId = toObjectIdString(tenant.unit);
    const previousAdditionalUnitIds = uniqueUnitIds(tenant.additionalUnits || []);

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

    const updatedTenant = await populateTenantQuery(
      Tenant.findByIdAndUpdate(
        tenant._id,
        {
          $set: {
            unit: requestedUnits.primary,
            additionalUnits: requestedUnits.additional,
            rent: calculateTenantAssignedRent(requestedUnitDocs, tenant.rent || 0),
            utilities: deriveAssignedUtilitiesFromUnitDocs(requestedUnitDocs),
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
      )
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

// Bulk import tenants from Excel
export const bulkImportTenants = async (req, res, next) => {
  try {
    const { tenants: tenantsData } = req.body;
    const businessId = resolveBusinessId(req);

    if (!businessId) {
      return res.status(400).json({
        success: false,
        message: "Business context is required",
      });
    }

    if (!Array.isArray(tenantsData) || tenantsData.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No tenant data provided",
      });
    }

    if (tenantsData.length > 1000) {
      return res.status(400).json({
        success: false,
        message: "Maximum 1000 tenants per import",
      });
    }

    const units = await Unit.find({ business: businessId }).lean().select("_id unitNumber property status isVacant").populate("property");
    const unitMap = new Map();

    units.forEach((unit) => {
      const propertyCode = unit.property?.propertyCode?.toLowerCase();
      const unitNumber = unit.unitNumber?.toLowerCase();
      if (propertyCode && unitNumber) {
        unitMap.set(`${propertyCode}|${unitNumber}`, unit);
      }
    });

    const existingTenants = await Tenant.find({ business: businessId }).lean().select("_id idNumber tenantCode");
    const existingIds = new Set(
      existingTenants.map((t) => String(t.idNumber || "").toLowerCase()).filter(Boolean)
    );
    const existingCodes = new Set(
      existingTenants.map((t) => String(t.tenantCode || "").toLowerCase()).filter(Boolean)
    );

    const successful = [];
    const failed = [];

    for (let i = 0; i < tenantsData.length; i++) {
      const record = tenantsData[i];
      const rowIndex = Number(record?.rowNumber || i + 2);

      try {
        const normalizedTenantName = normalizeString(record.tenantName);
        const normalizedPhoneNumber = normalizeString(record.phoneNumber);
        const normalizedIdNumber = normalizeString(record.idNumber);

        if (!normalizedTenantName || !normalizedPhoneNumber || !normalizedIdNumber) {
          failed.push({
            tenantName: record.tenantName,
            error: "Tenant name, phone number, and ID number are required",
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
          await ensureUnitsAvailableForTenant({
            businessId,
            unitDocs: requestedUnitDocs,
          });
        }

        const normalizedIdNumberKey = String(normalizedIdNumber || "").trim().toLowerCase();
        if (existingIds.has(normalizedIdNumberKey)) {
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
          tenantCode = await generateNextTenantCode(businessId);
        } else if (existingCodes.has(tenantCode.toLowerCase())) {
          failed.push({
            tenantName: record.tenantName,
            error: `Duplicate tenant code: ${tenantCode}`,
            row: rowIndex,
          });
          continue;
        }

        const propertyDepositHeldBy = primaryUnitDoc?.property?.depositHeldBy || "propertyManager";
        const requestedRent = Number(record.rent || 0);
        const computedRent = calculateTenantAssignedRent(requestedUnitDocs, primaryUnitDoc.rent || 0);
        const depositAmount = Number(record.depositAmount ?? requestedRent ?? primaryUnitDoc.deposit ?? computedRent);
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
          rent: requestedRent > 0 ? requestedRent : computedRent,
          balance: 0,
          status: importedTenantStatus,
          depositAmount,
          depositHeldBy: normalizeDepositHolder(record.depositHeldBy, propertyDepositHeldBy),
          depositRefundStatus: depositAmount > 0 ? "pending" : "not_applicable",
          depositRefundAmount: depositAmount,
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

        await newTenant.save();
        await syncTenantAssignedUnitOccupancy({
          previousUnitIds: [],
          nextUnitIds: shouldTenantOccupyUnits(newTenant) ? getTenantAssignedUnitIds(newTenant) : [],
          tenantId: newTenant._id,
          effectiveDate: moveInDate,
        });

        if (importedTenantOccupiesUnits && moveInDate && !Number.isNaN(moveInDate.getTime())) {
          await syncTenantLeaseRecord({
            tenantDoc: newTenant,
            unitDoc: primaryUnitDoc,
            action: "upsert",
          });
        }

        existingIds.add(normalizedIdNumberKey);
        existingCodes.add(String(tenantCode).toLowerCase());

        successful.push({
          tenantName: record.tenantName,
          _id: newTenant._id,
          tenantCode,
        });
      } catch (error) {
        failed.push({
          tenantName: record.tenantName,
          error: error.message || "Unknown error occurred",
          row: rowIndex,
        });
      }
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
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to process bulk import",
    });
  }
};

// Migration endpoint: Assign tenant codes to existing tenants without codes
export const migrateTenantCodes = async (req, res, next) => {
  try {
    const business = resolveBusinessId(req);

    if (!business) {
      return res.status(400).json({
        success: false,
        message: "Business context is required",
      });
    }

    const tenantsWithoutCodes = await Tenant.find({
      business,
      $or: [{ tenantCode: { $exists: false } }, { tenantCode: null }, { tenantCode: "" }],
    }).sort({ createdAt: 1 });

    if (tenantsWithoutCodes.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No tenants found without codes",
        updated: 0,
      });
    }

    const tenantsWithCodes = await Tenant.find({
      business,
      tenantCode: { $regex: /^TT\d+$/ },
    })
      .select("tenantCode")
      .lean();

    const existingNumbers = tenantsWithCodes
      .map((t) => parseInt(String(t.tenantCode || "").replace("TT", ""), 10))
      .filter((n) => !Number.isNaN(n));

    let nextNumber = existingNumbers.length ? Math.max(...existingNumbers) + 1 : 1;
    let updatedCount = 0;
    const updates = [];

    for (const tenant of tenantsWithoutCodes) {
      const tenantCode = `TT${String(nextNumber).padStart(4, "0")}`;
      nextNumber += 1;

      try {
        await Tenant.findByIdAndUpdate(tenant._id, { tenantCode });
        updatedCount += 1;
        updates.push({
          tenantId: tenant._id,
          tenantName: tenant.name,
          assignedCode: tenantCode,
        });
      } catch (err) {
        console.error(`Failed to update tenant ${tenant._id}:`, err);
      }
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
