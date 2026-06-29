import Unit from "../../models/Unit.js";
import Tenant from "../../models/Tenant.js";
import Property from "../../models/Property.js";
import Lease from "../../models/Lease.js";
import TenantInvoice from "../../models/TenantInvoice.js";
import TenantInvoiceNote from "../../models/TenantInvoiceNote.js";
import RentPayment from "../../models/RentPayment.js";
import Receipt from "../../models/Receipts.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import Maintenance from "../../models/Maintenance.js";
import Inspection from "../../models/Inspection.js";
import MeterReading from "../../models/MeterReading.js";
import LandlordStatementLine from "../../models/LandlordStatementLine.js";

const OCCUPYING_TENANT_STATUSES = ["active", "overdue"];
const NON_OCCUPIABLE_UNIT_STATUSES = ["vacant", "maintenance", "reserved", "archived"];

const resolveBusinessId = (req) => {
  return (
    (req.user?.isSystemAdmin && (req.body?.business || req.query?.business)) ||
    req.user?.company ||
    req.user?.business ||
    null
  );
};

const normalizePropertyId = (propertyValue) => {
  if (!propertyValue) return null;
  if (typeof propertyValue === "string") return propertyValue;
  if (typeof propertyValue === "object" && propertyValue._id) {
    return String(propertyValue._id);
  }
  return String(propertyValue);
};

const sanitizeUtilities = (utilities = []) => {
  if (!Array.isArray(utilities)) return [];

  return utilities.map((item) => ({
    utility: typeof item?.utility === "string" ? item.utility.trim() : "",
    isIncluded: !!item?.isIncluded,
    unitCharge: Number(item?.unitCharge || 0),
  }));
};

const sanitizeAmenities = (amenities = []) => {
  if (!Array.isArray(amenities)) return [];
  return amenities
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
};

const roundCurrency = (value) => Number(Number(value || 0).toFixed(2));

const calculateRentFromPropertyDefaults = (propertyDoc, areaValue, explicitRent) => {
  const providedRent = Number(explicitRent || 0);
  if (providedRent > 0) return roundCurrency(providedRent);

  const rate = Number(propertyDoc?.rentPerMeasure || 0);
  const area = Number(areaValue || 0);
  if (rate <= 0 || area <= 0) return 0;

  return roundCurrency(rate * area);
};

const calculateDepositFromPropertyDefaults = (propertyDoc, rentAmount, explicitDeposit) => {
  const providedDeposit =
    explicitDeposit === "" || explicitDeposit === null || explicitDeposit === undefined
      ? Number.NaN
      : Number(explicitDeposit);

  if (Number.isFinite(providedDeposit) && providedDeposit >= 0) {
    return roundCurrency(providedDeposit);
  }

  const deposits = Array.isArray(propertyDoc?.securityDeposits) ? propertyDoc.securityDeposits : [];
  const rentDeposit =
    deposits.find(
      (item) => String(item?.depositType || "").trim().toLowerCase() === "rent security deposit"
    ) ||
    deposits.find((item) => String(item?.depositType || "").toLowerCase().includes("rent")) ||
    null;

  const normalizedRent = Number(rentAmount || 0);
  if (!rentDeposit) {
    return normalizedRent > 0 ? roundCurrency(normalizedRent) : 0;
  }

  const amount = Number(rentDeposit.amount || 0);
  if (String(rentDeposit.chargeMode || "Fixed Amount") === "Percentage") {
    return normalizedRent > 0 ? roundCurrency((normalizedRent * amount) / 100) : 0;
  }

  return roundCurrency(amount);
};

const normalizeUnitStatus = (value, fallback = "vacant") => {
  const normalized = String(value || fallback).trim().toLowerCase();
  return ["vacant", "occupied", "maintenance", "reserved", "archived"].includes(normalized)
    ? normalized
    : fallback;
};

const getUnitOccupants = async (unitId) => {
  if (!unitId) return [];

  return Tenant.find({
    $or: [{ unit: unitId }, { additionalUnits: unitId }],
    status: { $in: OCCUPYING_TENANT_STATUSES },
  })
    .select("name phone status unit additionalUnits")
    .sort({ updatedAt: -1 })
    .lean();
};

const pickPrimaryCurrentTenant = (unitId, tenants = []) => {
  if (!unitId || !Array.isArray(tenants) || !tenants.length) return null;

  const primary = tenants.find((tenant) => String(tenant?.unit || "") === String(unitId));
  return primary || tenants[0] || null;
};

export const calculateTotalMonthlyAmount = async (unitOrId) => {
  try {
    const unit =
      unitOrId && typeof unitOrId === "object" && (unitOrId._id || unitOrId.rent !== undefined)
        ? unitOrId
        : await Unit.findById(unitOrId).select("rent utilities").lean();

    if (!unit) {
      return { rent: 0, utilities: [], total: 0 };
    }

    let total = Number(unit.rent || 0);
    const utilitiesBreakdown = (unit.utilities || []).map((item) => {
      const charge = Number(item.unitCharge || 0);
      total += charge;

      return {
        utility: item.utility || "",
        utilityLabel: item.utility || "Unknown Utility",
        amount: charge,
        isIncluded: !!item.isIncluded,
      };
    });

    return {
      rent: Number(unit.rent || 0),
      utilities: utilitiesBreakdown,
      total: Number(total.toFixed(2)),
    };
  } catch (error) {
    console.error("Error calculating total monthly amount:", error);
    return { rent: 0, utilities: [], total: 0 };
  }
};

const updatePropertyUnitCounts = async (propertyId) => {
  if (!propertyId) return;

  const [totalUnits, occupiedUnits, vacantUnits] = await Promise.all([
    Unit.countDocuments({ property: propertyId }),
    Unit.countDocuments({ property: propertyId, status: "occupied" }),
    Unit.countDocuments({ property: propertyId, status: "vacant" }),
  ]);

  await Property.findByIdAndUpdate(propertyId, { totalUnits, occupiedUnits, vacantUnits });
};

const buildEffectiveUnitPayload = ({ unitDoc, currentTenant = null, totalMonthlyAmount = null } = {}) => {
  if (!unitDoc) return null;

  const base = typeof unitDoc?.toObject === "function" ? unitDoc.toObject() : { ...unitDoc };
  const rawStatus = normalizeUnitStatus(base?.status || "vacant", "vacant");
  const hasCurrentOccupant = Boolean(currentTenant?._id || currentTenant?.name);

  // Forward heal: has tenant but status says vacant/maintenance → force occupied
  // Reverse heal: no tenant but status says occupied → force vacant (stale data)
  const effectiveStatus = hasCurrentOccupant
    ? "occupied"
    : rawStatus === "occupied"
    ? "vacant"
    : rawStatus;
  const effectiveIsVacant = hasCurrentOccupant ? false : effectiveStatus === "vacant";
  const effectiveVacantSince = hasCurrentOccupant ? null : base?.vacantSince || null;
  const effectiveDaysVacant = hasCurrentOccupant ? 0 : Number(base?.daysVacant || 0);

  return {
    ...base,
    status: effectiveStatus,
    isVacant: effectiveIsVacant,
    vacantSince: effectiveVacantSince,
    daysVacant: effectiveDaysVacant,
    currentTenant: currentTenant || null,
    totalMonthlyAmount,
  };
};

const persistVacantUnitStateIfNeeded = async (unitDoc) => {
  if (!unitDoc?._id) return false;
  const rawStatus = normalizeUnitStatus(unitDoc?.status || "vacant", "vacant");
  if (rawStatus !== "occupied") return false;

  await Unit.updateOne(
    { _id: unitDoc._id },
    {
      $set: {
        status: "vacant",
        isVacant: true,
        vacantSince: unitDoc.vacantSince || new Date(),
        daysVacant: 0,
      },
    }
  );
  await updatePropertyUnitCounts(unitDoc.property?._id || unitDoc.property || null);
  return true;
};

const persistOccupiedUnitStateIfNeeded = async (unitDoc, currentTenant = null) => {
  if (!unitDoc?._id || !currentTenant?._id) return false;

  const rawStatus = normalizeUnitStatus(unitDoc?.status || "vacant", "vacant");
  const shouldPatch = rawStatus !== "occupied" || unitDoc?.isVacant !== false || unitDoc?.vacantSince;
  if (!shouldPatch) return false;

  await Unit.updateOne(
    { _id: unitDoc._id },
    {
      $set: {
        status: "occupied",
        isVacant: false,
        vacantSince: null,
        daysVacant: 0,
        lastTenant: currentTenant._id,
      },
    }
  );

  await updatePropertyUnitCounts(unitDoc.property?._id || unitDoc.property || null);
  return true;
};

const attachCurrentTenant = async (unitDoc) => {
  if (!unitDoc) return null;

  const occupyingTenants = await getUnitOccupants(unitDoc._id);
  const currentTenant = pickPrimaryCurrentTenant(unitDoc._id, occupyingTenants);
  const totalMonthlyAmount = await calculateTotalMonthlyAmount(unitDoc);

  if (currentTenant?._id) {
    await persistOccupiedUnitStateIfNeeded(unitDoc, currentTenant);
  } else {
    await persistVacantUnitStateIfNeeded(unitDoc);
  }

  return buildEffectiveUnitPayload({
    unitDoc,
    currentTenant,
    totalMonthlyAmount,
  });
};

const getUnitDependencySummary = async (unit) => {
  if (!unit?._id) {
    return { summary: {}, hasDependencies: false };
  }

  const unitId = unit._id;
  const businessId = unit.business;

  const [
    directTenants,
    additionalUnitTenants,
    transferHistoryRefs,
    leases,
    invoices,
    invoiceNotes,
    rentPayments,
    receipts,
    ledgerEntries,
    maintenance,
    inspections,
    meterReadings,
    statementLines,
  ] = await Promise.all([
    Tenant.countDocuments({ unit: unitId, business: businessId }),
    Tenant.countDocuments({ additionalUnits: unitId, business: businessId }),
    Tenant.countDocuments({
      business: businessId,
      $or: [{ "unitTransferHistory.fromUnit": unitId }, { "unitTransferHistory.toUnit": unitId }],
    }),
    Lease.countDocuments({ unit: unitId, business: businessId }),
    TenantInvoice.countDocuments({ unit: unitId, business: businessId }),
    TenantInvoiceNote.countDocuments({ unit: unitId, business: businessId }),
    RentPayment.countDocuments({ unit: unitId, business: businessId }),
    Receipt.countDocuments({ unit: unitId, business: businessId }),
    FinancialLedgerEntry.countDocuments({
      unit: unitId,
      business: businessId,
      status: { $nin: ["void", "draft"] },
    }),
    Maintenance.countDocuments({ unit: unitId, business: businessId }),
    Inspection.countDocuments({ unit: unitId, business: businessId }),
    MeterReading.countDocuments({ unit: unitId, business: businessId }),
    LandlordStatementLine.countDocuments({ unit: unitId, business: businessId }),
  ]);

  const summary = {
    directTenants,
    additionalUnitTenants,
    transferHistoryRefs,
    leases,
    invoices,
    invoiceNotes,
    rentPayments,
    receipts,
    ledgerEntries,
    maintenance,
    inspections,
    meterReadings,
    statementLines,
  };

  return {
    summary,
    hasDependencies: Object.values(summary).some((count) => Number(count || 0) > 0),
  };
};

const formatUnitDependencySummary = (summary = {}) => {
  const labels = {
    directTenants: "direct tenant records",
    additionalUnitTenants: "additional-unit tenant records",
    transferHistoryRefs: "unit transfer history records",
    leases: "leases",
    invoices: "invoices",
    invoiceNotes: "invoice notes",
    rentPayments: "rent payments",
    receipts: "receipts",
    ledgerEntries: "ledger entries",
    maintenance: "maintenance records",
    inspections: "inspections",
    meterReadings: "meter readings",
    statementLines: "statement lines",
  };

  return Object.entries(summary)
    .filter(([, count]) => Number(count || 0) > 0)
    .map(([key, count]) => `${count} ${labels[key] || key}`)
    .slice(0, 6)
    .join(", ");
};

const validateUnitStatusChange = async ({ unit, requestedStatus, allowOccupiedWithoutTenant = false }) => {
  const normalizedStatus = normalizeUnitStatus(requestedStatus, unit?.status || "vacant");
  const occupyingTenants = unit?._id ? await getUnitOccupants(unit._id) : [];

  if (normalizedStatus === "occupied" && !allowOccupiedWithoutTenant && occupyingTenants.length === 0) {
    return {
      ok: false,
      message: "A unit cannot be marked occupied unless it is assigned to an active or overdue tenant.",
    };
  }

  if (NON_OCCUPIABLE_UNIT_STATUSES.includes(normalizedStatus) && occupyingTenants.length > 0) {
    const names = occupyingTenants
      .map((tenant) => tenant?.name)
      .filter(Boolean)
      .slice(0, 3)
      .join(", ");

    return {
      ok: false,
      message: names
        ? `Cannot set this unit to ${normalizedStatus} while it is occupied by ${names}.`
        : `Cannot set this unit to ${normalizedStatus} while it is occupied by an active tenant.`,
    };
  }

  return { ok: true, status: normalizedStatus, occupyingTenants };
};

const loadUnitWithAccessCheck = async (req, unitId) => {
  const unit = await Unit.findById(unitId);

  if (!unit) {
    return { error: { status: 404, message: "Unit not found" } };
  }

  if (!req.user?.isSystemAdmin) {
    const businessId = resolveBusinessId(req);
    if (!businessId || String(unit.business) !== String(businessId)) {
      return {
        error: { status: 403, message: "Not authorized to access this unit" },
      };
    }
  }

  return { unit };
};

// CREATE UNIT
export const createUnit = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);

    if (!businessId) {
      return res.status(400).json({
        success: false,
        message:
          "Business context is required to create a unit. Please ensure you are logged in with a company account.",
      });
    }

    if (!req.body.property) {
      return res.status(400).json({
        success: false,
        message: "Property is required.",
      });
    }

    const property = await Property.findOne({
      _id: req.body.property,
      business: businessId,
    });

    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Selected property was not found.",
      });
    }

    const normalizedUnitNumber =
      typeof req.body.unitNumber === "string" ? req.body.unitNumber.trim() : "";

    if (!normalizedUnitNumber) {
      return res.status(400).json({
        success: false,
        message: "Unit number is required.",
      });
    }

    // New units must always start as vacant. Occupancy is controlled by tenant assignment,
    // not by the create-unit form payload. This keeps the Add Unit UI simple and prevents
    // orphan occupied/reserved/maintenance states during creation.
    const requestedStatus = "vacant";

    const resolvedRent = calculateRentFromPropertyDefaults(
      property,
      req.body.areaSqFt,
      req.body.rent
    );
    const resolvedDeposit = calculateDepositFromPropertyDefaults(
      property,
      resolvedRent,
      req.body.deposit
    );

    const newUnit = new Unit({
      ...req.body,
      unitNumber: normalizedUnitNumber,
      property: property._id,
      business: businessId,
      rent: resolvedRent,
      deposit: resolvedDeposit,
      areaSqFt: Number(req.body.areaSqFt || 0),
      amenities: sanitizeAmenities(req.body.amenities),
      utilities: sanitizeUtilities(req.body.utilities),
      status: requestedStatus,
      isVacant: true,
      vacantSince: new Date(),
      daysVacant: 0,
    });

    const savedUnit = await newUnit.save();

    await updatePropertyUnitCounts(savedUnit.property);

    const populatedUnit = await Unit.findById(savedUnit._id)
      .populate("property", "propertyName propertyCode address")
      .populate("lastTenant", "name phone status");

    const responsePayload = await attachCurrentTenant(populatedUnit);

    return res.status(201).json(responsePayload);
  } catch (err) {
    console.error("Create unit error:", err);

    let errorMessage = err.message || "Failed to create unit";
    let statusCode = 400;

    if (err.name === "ValidationError") {
      errorMessage = Object.values(err.errors)
        .map((e) => e.message)
        .join("; ");
    } else if (err.code === 11000) {
      errorMessage = "A unit with this number already exists for this property";
    } else if (err.statusCode) {
      statusCode = err.statusCode;
    }

    return res.status(statusCode).json({
      success: false,
      message: errorMessage,
    });
  }
};

// GET ALL UNITS
export const getUnits = async (req, res, next) => {
  try {
    const { property, status, unitType, unitNumber, tenantName, page = 1, limit = 500 } = req.query;
    const businessId = resolveBusinessId(req);

    if (!businessId) {
      return res.status(400).json({
        success: false,
        message: "Business context is required to fetch units",
      });
    }

    const filter = { business: businessId };

    if (property) {
      const propertyDoc = await Property.findOne({ _id: property, business: businessId }).select(
        "_id"
      );

      if (!propertyDoc) {
        return res.status(404).json({
          success: false,
          message: "Selected property was not found.",
        });
      }

      filter.property = property;
    }

    if (status) filter.status = status;
    if (unitType) filter.unitType = unitType;
    if (unitNumber) filter.unitNumber = { $regex: unitNumber, $options: "i" };

    // tenant name search: resolve matching unit IDs first
    if (tenantName) {
      const tenantRegex = { $regex: tenantName, $options: "i" };
      const matchingTenants = await Tenant.find({
        business: businessId,
        name: tenantRegex,
        status: { $in: OCCUPYING_TENANT_STATUSES },
      })
        .select("unit additionalUnits")
        .lean();

      const unitIds = new Set();
      for (const t of matchingTenants) {
        if (t.unit) unitIds.add(String(t.unit));
        if (Array.isArray(t.additionalUnits)) {
          t.additionalUnits.forEach((u) => u && unitIds.add(String(u)));
        }
      }
      filter._id = { $in: [...unitIds] };
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 500, 1), 5000);

    const [units, total] = await Promise.all([
      Unit.find(filter)
        .populate("property", "propertyName propertyCode address")
        .populate("lastTenant", "name phone status")
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      Unit.countDocuments(filter),
    ]);

    const unitIds = units.map((unit) => unit._id);
    const occupyingTenants = unitIds.length
      ? await Tenant.find({
          $or: [{ unit: { $in: unitIds } }, { additionalUnits: { $in: unitIds } }],
          status: { $in: OCCUPYING_TENANT_STATUSES },
        })
          .select("name phone status unit additionalUnits")
          .lean()
      : [];

    const tenantMap = new Map();
    occupyingTenants.forEach((tenant) => {
      const linkedUnitIds = [tenant?.unit, ...(Array.isArray(tenant?.additionalUnits) ? tenant.additionalUnits : [])]
        .filter(Boolean)
        .map((value) => String(value));

      linkedUnitIds.forEach((unitId) => {
        const existing = tenantMap.get(unitId) || [];
        existing.push(tenant);
        tenantMap.set(unitId, existing);
      });
    });

    // First pass: resolve tenants + compute amounts (no DB writes yet)
    const unitPayloads = await Promise.all(
      units.map(async (unit) => {
        const totalMonthlyAmount = await calculateTotalMonthlyAmount(unit);
        const candidateTenants = tenantMap.get(String(unit._id)) || [];
        const currentTenant = pickPrimaryCurrentTenant(unit._id, candidateTenants) || null;
        return { unit, currentTenant, totalMonthlyAmount };
      })
    );

    // Second pass: batch stale-state corrections (bulkWrite + per-property count refresh)
    const bulkOps = [];
    const dirtyPropertyIds = new Set();

    for (const { unit, currentTenant } of unitPayloads) {
      const rawStatus = normalizeUnitStatus(unit?.status || "vacant", "vacant");
      const propertyId = String(unit.property?._id || unit.property || "");

      if (currentTenant?._id) {
        if (rawStatus !== "occupied" || unit?.isVacant !== false || unit?.vacantSince) {
          bulkOps.push({
            updateOne: {
              filter: { _id: unit._id },
              update: { $set: { status: "occupied", isVacant: false, vacantSince: null, daysVacant: 0, lastTenant: currentTenant._id } },
            },
          });
          if (propertyId) dirtyPropertyIds.add(propertyId);
        }
      } else if (rawStatus === "occupied") {
        bulkOps.push({
          updateOne: {
            filter: { _id: unit._id },
            update: { $set: { status: "vacant", isVacant: true, vacantSince: unit.vacantSince || new Date(), daysVacant: 0 } },
          },
        });
        if (propertyId) dirtyPropertyIds.add(propertyId);
      }
    }

    if (bulkOps.length > 0) {
      await Unit.bulkWrite(bulkOps, { ordered: false });
      await Promise.all([...dirtyPropertyIds].map((pid) => updatePropertyUnitCounts(pid)));
    }

    const unitsWithExtras = unitPayloads.map(({ unit, currentTenant, totalMonthlyAmount }) =>
      buildEffectiveUnitPayload({ unitDoc: unit, currentTenant, totalMonthlyAmount })
    );

    return res.status(200).json({
      success: true,
      data: unitsWithExtras,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    next(err);
  }
};

// GET SINGLE UNIT
export const getUnit = async (req, res, next) => {
  try {
    const result = await loadUnitWithAccessCheck(req, req.params.id);
    if (result.error) {
      return res.status(result.error.status).json({
        success: false,
        message: result.error.message,
      });
    }

    const unit = await Unit.findById(req.params.id)
      .populate("property", "propertyName propertyCode address")
      .populate("lastTenant", "name phone status");

    const payload = await attachCurrentTenant(unit);
    return res.status(200).json(payload);
  } catch (err) {
    next(err);
  }
};

// UPDATE UNIT
export const updateUnit = async (req, res, next) => {
  try {
    const result = await loadUnitWithAccessCheck(req, req.params.id);
    if (result.error) {
      return res.status(result.error.status).json({
        success: false,
        message: result.error.message,
      });
    }

    const unit = result.unit;
    const businessId = resolveBusinessId(req);
    const previousPropertyId = normalizePropertyId(unit.property);

    let resolvedProperty = null;
    const propertyChangeRequested =
      req.body.property && String(req.body.property) !== String(previousPropertyId);

    if (propertyChangeRequested) {
      const nextProperty = await Property.findOne({
        _id: req.body.property,
        business: businessId,
      });

      if (!nextProperty) {
        return res.status(404).json({
          success: false,
          message: "Selected property was not found.",
        });
      }

      const { summary, hasDependencies } = await getUnitDependencySummary(unit);
      if (hasDependencies) {
        return res.status(400).json({
          success: false,
          message: `Cannot move this unit to another property because it already has historical records (${formatUnitDependencySummary(
            summary
          )}). Create a new unit under the target property instead.`,
        });
      }

      resolvedProperty = nextProperty;
    } else {
      resolvedProperty = await Property.findOne({
        _id: previousPropertyId,
        business: businessId,
      });
    }

    const requestedStatus = normalizeUnitStatus(req.body.status || unit.status, unit.status);
    const statusValidation = await validateUnitStatusChange({
      unit,
      requestedStatus,
      allowOccupiedWithoutTenant: false,
    });

    if (!statusValidation.ok) {
      return res.status(400).json({
        success: false,
        message: statusValidation.message,
      });
    }

    const protectedFields = ["business", "_id", "createdAt", "updatedAt"];

    Object.keys(req.body).forEach((key) => {
      if (!protectedFields.includes(key) && req.body[key] !== undefined) {
        unit[key] = req.body[key];
      }
    });

    if (typeof req.body.unitNumber === "string") {
      unit.unitNumber = req.body.unitNumber.trim();
    }

    if (Array.isArray(req.body.amenities)) {
      unit.amenities = sanitizeAmenities(req.body.amenities);
    }

    if (Array.isArray(req.body.utilities)) {
      unit.utilities = sanitizeUtilities(req.body.utilities);
    }

    if (req.body.areaSqFt !== undefined) {
      unit.areaSqFt = Number(req.body.areaSqFt || 0);
    }

    if (propertyChangeRequested) {
      unit.property = resolvedProperty._id;
    }

    const nextRent = calculateRentFromPropertyDefaults(
      resolvedProperty,
      req.body.areaSqFt !== undefined ? req.body.areaSqFt : unit.areaSqFt,
      req.body.rent !== undefined ? req.body.rent : unit.rent
    );
    if (nextRent > 0) {
      unit.rent = nextRent;
    }

    if (
      req.body.deposit !== undefined ||
      req.body.areaSqFt !== undefined ||
      req.body.rent !== undefined ||
      propertyChangeRequested
    ) {
      unit.deposit = calculateDepositFromPropertyDefaults(
        resolvedProperty,
        unit.rent,
        req.body.deposit !== undefined ? req.body.deposit : unit.deposit
      );
    }

    unit.status = requestedStatus;
    if (requestedStatus === "vacant") {
      unit.isVacant = true;
      if (!unit.vacantSince) {
        unit.vacantSince = new Date();
      }
    } else {
      unit.isVacant = false;
      unit.vacantSince = null;
      unit.daysVacant = 0;
    }

    unit.business = unit.business || businessId;

    const updatedUnit = await unit.save();

    const newPropertyId = normalizePropertyId(updatedUnit.property);

    if (previousPropertyId) {
      await updatePropertyUnitCounts(previousPropertyId);
    }
    if (newPropertyId && newPropertyId !== previousPropertyId) {
      await updatePropertyUnitCounts(newPropertyId);
    }

    const populatedUnit = await Unit.findById(updatedUnit._id)
      .populate("property", "propertyName propertyCode address")
      .populate("lastTenant", "name phone status");

    const payload = await attachCurrentTenant(populatedUnit);

    return res.status(200).json(payload);
  } catch (err) {
    console.error("Update unit error:", err);

    let errorMessage = err.message || "Failed to update unit";
    let statusCode = 400;

    if (err.name === "ValidationError") {
      errorMessage = Object.values(err.errors)
        .map((e) => e.message)
        .join("; ");
    } else if (err.code === 11000) {
      errorMessage = "A unit with this number already exists for this property";
    } else if (err.statusCode) {
      statusCode = err.statusCode;
    }

    return res.status(statusCode).json({
      success: false,
      message: errorMessage,
    });
  }
};

// DELETE UNIT
export const deleteUnit = async (req, res, next) => {
  try {
    const result = await loadUnitWithAccessCheck(req, req.params.id);
    if (result.error) {
      return res.status(result.error.status).json({
        success: false,
        message: result.error.message,
      });
    }

    const unit = result.unit;
    const occupyingTenants = await getUnitOccupants(unit._id);
    if (occupyingTenants.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete a unit that is still assigned to an active or overdue tenant.",
      });
    }

    const { summary, hasDependencies } = await getUnitDependencySummary(unit);
    if (hasDependencies) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete this unit because it already has historical records (${formatUnitDependencySummary(
          summary
        )}). Archive the unit instead of deleting it.`,
      });
    }

    const propertyId = normalizePropertyId(unit.property);

    await Unit.findByIdAndDelete(req.params.id);

    if (propertyId) {
      await updatePropertyUnitCounts(propertyId);
    }

    return res.status(200).json({
      success: true,
      message: "Unit deleted successfully",
    });
  } catch (err) {
    next(err);
  }
};

// UPDATE UNIT STATUS
export const updateUnitStatus = async (req, res, next) => {
  try {
    const { status } = req.body;

    const result = await loadUnitWithAccessCheck(req, req.params.id);
    if (result.error) {
      return res.status(result.error.status).json({
        success: false,
        message: result.error.message,
      });
    }

    const unit = result.unit;
    const requestedStatus = normalizeUnitStatus(status, unit.status);
    const statusValidation = await validateUnitStatusChange({
      unit,
      requestedStatus,
      allowOccupiedWithoutTenant: false,
    });

    if (!statusValidation.ok) {
      return res.status(400).json({
        success: false,
        message: statusValidation.message,
      });
    }

    unit.status = requestedStatus;

    if (requestedStatus === "vacant") {
      unit.isVacant = true;
      unit.vacantSince = new Date();
      unit.daysVacant = 0;
    } else {
      unit.isVacant = false;
      unit.vacantSince = null;
      unit.daysVacant = 0;
    }

    const updatedUnit = await unit.save();
    await updatePropertyUnitCounts(updatedUnit.property);

    return res.status(200).json(updatedUnit);
  } catch (err) {
    next(err);
  }
};

// GET AVAILABLE UNITS
export const getAvailableUnits = async (req, res, next) => {
  try {
    const { property } = req.query;
    const businessId = resolveBusinessId(req);

    if (!businessId) {
      return res.status(400).json({
        success: false,
        message: "Business context is required to fetch available units",
      });
    }

    const filter = {
      business: businessId,
      status: "vacant",
      isVacant: true,
    };

    if (property) {
      const propertyDoc = await Property.findOne({ _id: property, business: businessId }).select(
        "_id"
      );

      if (!propertyDoc) {
        return res.status(404).json({
          success: false,
          message: "Selected property was not found.",
        });
      }

      filter.property = property;
    }

    const units = await Unit.find(filter)
      .populate("property", "propertyName propertyCode address")
      .sort({ rent: 1 });

    return res.status(200).json(units);
  } catch (err) {
    next(err);
  }
};

// GET UNIT UTILITIES
export const getUnitUtilities = async (req, res, next) => {
  try {
    const result = await loadUnitWithAccessCheck(req, req.params.id);
    if (result.error) {
      return res.status(result.error.status).json({
        success: false,
        message: result.error.message,
      });
    }

    const unit = result.unit;
    const totalMonthlyAmount = await calculateTotalMonthlyAmount(unit);

    return res.status(200).json({
      utilities: unit.utilities || [],
      totalMonthlyAmount,
    });
  } catch (err) {
    next(err);
  }
};

// ADD UTILITY TO UNIT
export const addUtilityToUnit = async (req, res, next) => {
  try {
    const { utility, isIncluded = false, unitCharge = 0 } = req.body;

    const result = await loadUnitWithAccessCheck(req, req.params.id);
    if (result.error) {
      return res.status(result.error.status).json({
        success: false,
        message: result.error.message,
      });
    }

    const unit = result.unit;
    const normalizedUtility = typeof utility === "string" ? utility.trim() : "";

    if (!normalizedUtility) {
      return res.status(400).json({
        success: false,
        message: "Utility is required",
      });
    }

    const existingIndex = (unit.utilities || []).findIndex(
      (u) => String(u.utility).toLowerCase() === String(normalizedUtility).toLowerCase()
    );

    if (existingIndex >= 0) {
      unit.utilities[existingIndex] = {
        utility: normalizedUtility,
        isIncluded: !!isIncluded,
        unitCharge: Number(unitCharge || 0),
      };
    } else {
      unit.utilities.push({
        utility: normalizedUtility,
        isIncluded: !!isIncluded,
        unitCharge: Number(unitCharge || 0),
      });
    }

    const updatedUnit = await unit.save();
    return res.status(200).json(updatedUnit);
  } catch (err) {
    next(err);
  }
};

// REMOVE UTILITY FROM UNIT
export const removeUtilityFromUnit = async (req, res, next) => {
  try {
    const { unitId, utilityId } = req.params;

    const result = await loadUnitWithAccessCheck(req, unitId);
    if (result.error) {
      return res.status(result.error.status).json({
        success: false,
        message: result.error.message,
      });
    }

    const unit = result.unit;

    unit.utilities = (unit.utilities || []).filter(
      (u) =>
        String(u._id) !== String(utilityId) &&
        String(u.utility).toLowerCase() !== String(utilityId).toLowerCase()
    );

    const updatedUnit = await unit.save();
    return res.status(200).json(updatedUnit);
  } catch (err) {
    next(err);
  }
};

// BULK IMPORT UNITS
export const bulkImportUnits = async (req, res, next) => {
  try {
    const { units: unitsData } = req.body;
    const businessId = resolveBusinessId(req);

    if (!businessId) {
      return res.status(400).json({ success: false, message: "Business context is required" });
    }
    if (!Array.isArray(unitsData) || unitsData.length === 0) {
      return res.status(400).json({ success: false, message: "No units data provided" });
    }

    const properties = await Property.find({ business: businessId }).select("_id propertyCode rentPerMeasure securityDeposits");
    const propertyCodeMap = new Map(
      properties.map((p) => [String(p.propertyCode || "").toLowerCase(), p])
    );

    // Phase 1: validate rows and build unit documents in memory (no DB writes)
    const validUnits = []; // each entry includes _importRow for error mapping
    const failed = [];

    for (let i = 0; i < unitsData.length; i++) {
      const row = unitsData[i];
      const property = propertyCodeMap.get(String(row.propertyCode || "").trim().toLowerCase());

      if (!property?._id) {
        failed.push({ row: i + 2, unitNumber: row.unitNumber, error: `Property code "${row.propertyCode}" not found` });
        continue;
      }

      const normalizedUnitNumber = typeof row.unitNumber === "string" ? row.unitNumber.trim() : String(row.unitNumber || "").trim();
      if (!normalizedUnitNumber) {
        failed.push({ row: i + 2, unitNumber: row.unitNumber, error: "Unit number is required" });
        continue;
      }

      const normalizedUnitType = typeof row.unitType === "string" ? row.unitType.trim() : String(row.unitType || "").trim();
      if (!normalizedUnitType) {
        failed.push({ row: i + 2, unitNumber: normalizedUnitNumber, error: "Unit type is required" });
        continue;
      }

      const requestedStatus = normalizeUnitStatus(row.status || "vacant", "vacant");
      if (requestedStatus === "occupied") {
        failed.push({ row: i + 2, unitNumber: row.unitNumber, error: "Occupied units cannot be imported without a linked tenant. Import the unit as vacant, reserved, maintenance, or archived first." });
        continue;
      }

      const resolvedRent = calculateRentFromPropertyDefaults(property, row.areaSqFt, row.rent);
      const resolvedDeposit = calculateDepositFromPropertyDefaults(property, resolvedRent, row.deposit);

      validUnits.push({
        _importRow: i + 2,
        unitNumber: normalizedUnitNumber,
        property: property._id,
        unitType: normalizedUnitType,
        rent: resolvedRent,
        deposit: resolvedDeposit,
        status: requestedStatus,
        isVacant: requestedStatus === "vacant",
        vacantSince: requestedStatus === "vacant" ? new Date() : null,
        daysVacant: 0,
        amenities: sanitizeAmenities(row.amenities),
        utilities: sanitizeUtilities(row.utilities),
        billingFrequency: row.billingFrequency || row.billingPeriodKey || "monthly",
        billingPeriodKey: row.billingPeriodKey || row.billingFrequency || "monthly",
        description: row.description || "",
        areaSqFt: Number(row.areaSqFt || 0),
        business: businessId,
      });
    }

    // Phase 2: batch insert all valid units in a single DB round-trip
    const successful = [];
    const touchedPropertyIds = new Set();

    if (validUnits.length > 0) {
      const docsToInsert = validUnits.map(({ _importRow, ...doc }) => doc);

      let insertedDocs = [];
      let writeErrors = [];

      try {
        insertedDocs = await Unit.insertMany(docsToInsert, { ordered: false });
      } catch (bulkErr) {
        if (bulkErr.name === "MongoBulkWriteError" || bulkErr.writeErrors) {
          insertedDocs = bulkErr.insertedDocs || [];
          writeErrors = bulkErr.writeErrors || [];
        } else {
          throw bulkErr;
        }
      }

      for (const u of insertedDocs) {
        successful.push({ _id: u._id, unitNumber: u.unitNumber });
        touchedPropertyIds.add(String(u.property));
      }

      for (const writeError of writeErrors) {
        const failedUnit = validUnits[writeError.index];
        let errorMessage = writeError.errmsg || "Failed to import unit";
        if (writeError.code === 11000) {
          errorMessage = "A unit with this number already exists for this property";
        }
        failed.push({ row: failedUnit._importRow, unitNumber: failedUnit.unitNumber, error: errorMessage });
      }
    }

    // Phase 3: update property unit counts in parallel
    await Promise.all([...touchedPropertyIds].map((propertyId) => updatePropertyUnitCounts(propertyId)));

    const allFailed = successful.length === 0 && failed.length > 0;
    return res.status(200).json({
      success: !allFailed,
      data: {
        successful,
        failed,
        totalProcessed: unitsData.length,
        successCount: successful.length,
        failureCount: failed.length,
      },
    });
  } catch (err) {
    next(err);
  }
};
