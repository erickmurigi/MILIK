import mongoose from "mongoose";
import { escapeRegex } from "../../utils/escapeRegex.js";
import { getFieldOfficerPropertyIds } from "../../utils/fieldOfficerScope.js";
import MeterReading from "../../models/MeterReading.js";
import Property from "../../models/Property.js";
import Unit from "../../models/Unit.js";
import Tenant from "../../models/Tenant.js";
import Utility from "../../models/Utility.js";
import CompanySettings from "../../models/CompanySettings.js";
import { createTenantInvoiceRecord } from "./tenantInvoices.js";
import { resolvePropertyAccountingContext } from "../../services/propertyAccountingService.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";
import { getAccessibleCompanyIds } from "../../utils/permissionControl.js";
import { createError } from "../../utils/error.js";
import { resolveBusinessId } from "../../utils/requestContext.js";

const PREVIOUS_READING_STATUSES = ["draft", "billed"];
const DUPLICATE_BLOCKING_STATUSES = ["draft", "billed"];
const ACTIVE_TENANT_STATUSES = ["active", "overdue"];

const normalizeDate = (value, fallback = new Date()) => {
  const date = value ? new Date(value) : new Date(fallback);
  return Number.isNaN(date.getTime()) ? new Date(fallback) : date;
};

const normalizeAmount = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toPeriodKey = (value, fallbackDate = new Date()) => {
  if (value && /^\d{4}-\d{2}$/.test(String(value).trim())) {
    return String(value).trim();
  }

  const date = normalizeDate(value, fallbackDate);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

const ensureBusinessAccess = (req, businessId) => {
  const normalizedBusinessId = String(businessId || "").trim();
  if (!normalizedBusinessId) {
    const error = new Error("Business context is required.");
    error.statusCode = 400;
    throw error;
  }

  if (req.user?.isSystemAdmin || req.user?.superAdminAccess) {
    return normalizedBusinessId;
  }

  const accessibleCompanies = getAccessibleCompanyIds(req.user || {});
  const authenticatedCompanyId = String(req.user?.company?._id || req.user?.company || "").trim();

  if (
    normalizedBusinessId === authenticatedCompanyId ||
    accessibleCompanies.includes(normalizedBusinessId)
  ) {
    return normalizedBusinessId;
  }

  const error = new Error("Not authorized to access records for this company.");
  error.statusCode = 403;
  throw error;
};

const ensureReadingAccess = (req, reading) =>
  ensureBusinessAccess(req, String(reading?.business || ""));


const resolveActorUserId = async (req, options = {}) => {
  const {
    businessId: explicitBusinessId = null,
    candidateUserIds = [],
  } = options || {};

  return resolveAuditActorUserId({
    req,
    businessId: explicitBusinessId || resolveBusinessId(req),
    candidateUserIds: [...candidateUserIds, req.body?.createdBy || null],
    fallbackErrorMessage: "No valid company user could be resolved for meter reading attribution.",
  });
};

const populateReadingQuery = (query) =>
  query
    .populate("property", "propertyName propertyCode")
    .populate("unit", "unitNumber")
    .populate("tenant", "name tenantCode")
    .populate("billedInvoice", "_id invoiceNumber status amount dueDate")
    .lean();

const findActiveTenantForUnit = async ({ businessId, unitId }) => {
  if (!businessId || !unitId) return null;

  return Tenant.findOne({
    business: businessId,
    $or: [{ unit: unitId }, { additionalUnits: unitId }],
    status: { $in: ACTIVE_TENANT_STATUSES },
  })
    .sort({ moveInDate: -1, createdAt: -1 })
    .select("_id name unit business status")
    .lean();
};

const resolveUtilityRate = async ({ businessId, unitDoc, utilityType, providedRate }) => {
  const directRate = normalizeAmount(providedRate, NaN);
  if (Number.isFinite(directRate) && directRate >= 0) {
    return directRate;
  }

  const normalizedUtility = String(utilityType || "").trim().toLowerCase();

  const unitUtility = (unitDoc?.utilities || []).find(
    (item) => String(item?.utility || "").trim().toLowerCase() === normalizedUtility
  );

  if (unitUtility && Number.isFinite(Number(unitUtility.unitCharge))) {
    return Number(unitUtility.unitCharge || 0);
  }

  const [propertyDoc, utilityDoc, settings] = await Promise.all([
    Property.findById(unitDoc?.property).select("utilityRates").lean(),
    Utility.findOne({
      business: businessId,
      name: { $regex: `^${String(utilityType || "").trim()}$`, $options: "i" },
      isActive: true,
    }).select("unitCost").lean(),
    CompanySettings.findOne({ company: businessId }).select("utilityTypes").lean(),
  ]);

  const propertyRate = (propertyDoc?.utilityRates || []).find(
    (r) => String(r?.utilityType || "").trim().toLowerCase() === normalizedUtility && r?.isActive !== false
  );
  if (propertyRate && Number.isFinite(Number(propertyRate.unitCost))) {
    return Number(propertyRate.unitCost || 0);
  }

  if (utilityDoc && Number.isFinite(Number(utilityDoc.unitCost))) {
    return Number(utilityDoc.unitCost || 0);
  }

  return 0;
};

const getPreviousReadingValue = async ({
  businessId,
  propertyId,
  unitId,
  utilityType,
  billingPeriod = null,
  readingDate = null,
  excludeId = null,
}) => {
  const query = {
    business: businessId,
    property: propertyId,
    unit: unitId,
    utilityType: { $regex: `^${String(utilityType || "").trim()}$`, $options: "i" },
    status: { $in: PREVIOUS_READING_STATUSES },
  };

  if (billingPeriod && /^\d{4}-\d{2}$/.test(String(billingPeriod))) {
    query.billingPeriod = { $lt: String(billingPeriod) };
  } else if (readingDate) {
    query.readingDate = { $lte: normalizeDate(readingDate) };
  }

  if (excludeId && mongoose.Types.ObjectId.isValid(String(excludeId))) {
    query._id = { $ne: excludeId };
  }

  const previous = await MeterReading.findOne(query)
    .sort({ billingPeriod: -1, readingDate: -1, createdAt: -1 })
    .select("currentReading")
    .lean();

  return Number(previous?.currentReading || 0);
};

const computeConsumption = ({ previousReading, currentReading, isMeterReset }) => {
  const prev = normalizeAmount(previousReading, 0);
  const curr = normalizeAmount(currentReading, 0);

  if (curr < prev && !isMeterReset) {
    throw new Error("Current reading cannot be less than previous reading unless meter reset is enabled.");
  }

  const unitsConsumed = isMeterReset ? curr : curr - prev;
  if (unitsConsumed < 0) {
    throw new Error("Units consumed cannot be negative.");
  }

  return {
    previousReading: prev,
    currentReading: curr,
    unitsConsumed,
  };
};

const ensureReadingContext = async ({ businessId, propertyId, unitId, tenantId = null }) => {
  const [propertyDoc, unitDoc] = await Promise.all([
    Property.findOne({ _id: propertyId, business: businessId })
      .select("_id landlord business propertyName")
      .lean(),
    Unit.findOne({ _id: unitId, business: businessId })
      .select("_id property unitNumber utilities business")
      .lean(),
  ]);

  if (!propertyDoc) {
    throw new Error("Property not found for this business.");
  }

  if (!unitDoc) {
    throw new Error("Unit not found for this business.");
  }

  if (String(unitDoc.property) !== String(propertyDoc._id)) {
    throw new Error("Selected unit does not belong to the selected property.");
  }

  let tenantDoc = null;
  if (tenantId && mongoose.Types.ObjectId.isValid(String(tenantId))) {
    tenantDoc = await Tenant.findOne({
      _id: tenantId,
      business: businessId,
      $or: [{ unit: unitId }, { additionalUnits: unitId }],
    })
      .select("_id name unit business status")
      .lean();
  }

  if (!tenantDoc) {
    tenantDoc = await findActiveTenantForUnit({ businessId, unitId });
  }

  return { propertyDoc, unitDoc, tenantDoc };
};

const checkDuplicateReading = async ({ businessId, unitId, utilityType, billingPeriod, excludeId = null }) => {
  const query = {
    business: businessId,
    unit: unitId,
    utilityType: { $regex: `^${String(utilityType || "").trim()}$`, $options: "i" },
    billingPeriod,
    status: { $in: DUPLICATE_BLOCKING_STATUSES },
  };

  if (excludeId && mongoose.Types.ObjectId.isValid(String(excludeId))) {
    query._id = { $ne: excludeId };
  }

  const existing = await MeterReading.findOne(query).select("_id status billedInvoice").lean();
  if (existing) {
    throw new Error("A meter reading already exists for this unit, utility, and billing period.");
  }
};

const buildReadingPayload = async ({ req, existingReading = null }) => {
  const businessId = existingReading?.business ? String(existingReading.business) : resolveBusinessId(req);
  const scopedBusinessId = ensureBusinessAccess(req, businessId);

  const propertyId = req.body.property || existingReading?.property;
  const unitId = req.body.unit || existingReading?.unit;
  const utilityType = String(req.body.utilityType || existingReading?.utilityType || "").trim();
  const billingPeriod = toPeriodKey(
    req.body.billingPeriod || existingReading?.billingPeriod,
    req.body.readingDate || existingReading?.readingDate || new Date()
  );
  const readingDate = normalizeDate(req.body.readingDate || existingReading?.readingDate || new Date());
  const isMeterReset =
    req.body.isMeterReset !== undefined
      ? Boolean(req.body.isMeterReset)
      : Boolean(existingReading?.isMeterReset || false);

  if (!propertyId || !unitId || !utilityType) {
    throw new Error("Property, unit, and utility type are required.");
  }

  const { propertyDoc, unitDoc, tenantDoc } = await ensureReadingContext({
    businessId: scopedBusinessId,
    propertyId,
    unitId,
    tenantId: req.body.tenant || existingReading?.tenant || null,
  });

  const previousReadingRaw =
    req.body.previousReading !== undefined && req.body.previousReading !== null && req.body.previousReading !== ""
      ? req.body.previousReading
      : existingReading?.previousReading !== undefined && existingReading?.previousReading !== null
      ? existingReading.previousReading
      : await getPreviousReadingValue({
          businessId: scopedBusinessId,
          propertyId,
          unitId,
          utilityType,
          billingPeriod,
          readingDate,
          excludeId: existingReading?._id || null,
        });

  const { previousReading, currentReading, unitsConsumed } = computeConsumption({
    previousReading: previousReadingRaw,
    currentReading:
      req.body.currentReading !== undefined && req.body.currentReading !== null
        ? req.body.currentReading
        : existingReading?.currentReading,
    isMeterReset,
  });

  const rate = await resolveUtilityRate({
    businessId: scopedBusinessId,
    unitDoc,
    utilityType,
    providedRate: req.body.rate !== undefined ? req.body.rate : existingReading?.rate,
  });

  const calculatedAmount = Number((unitsConsumed * Number(rate || 0)).toFixed(2));
  const suppliedAmount =
    req.body.amount !== undefined && req.body.amount !== null && req.body.amount !== ""
      ? normalizeAmount(req.body.amount, calculatedAmount)
      : calculatedAmount;

  return {
    business: scopedBusinessId,
    property: propertyDoc._id,
    unit: unitDoc._id,
    tenant: tenantDoc?._id || null,
    utilityType,
    meterNumber: String(req.body.meterNumber ?? existingReading?.meterNumber ?? "").trim(),
    billingPeriod,
    readingDate,
    previousReading,
    currentReading,
    unitsConsumed,
    rate: Number(rate || 0),
    amount: Number(suppliedAmount.toFixed(2)),
    isMeterReset,
    notes: String(req.body.notes ?? existingReading?.notes ?? "").trim(),
    status: existingReading?.status || "draft",
  };
};

const invokeInvoiceDeletionForMeterReading = async ({ req, invoiceId }) => {
  const { deleteTenantInvoice } = await import("./tenantInvoices.js");

  return new Promise((resolve, reject) => {
    let resolved = false;
    const response = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolved = true;
        resolve({ statusCode: this.statusCode || 200, payload });
        return this;
      },
    };

    Promise.resolve(
      deleteTenantInvoice(
        {
          ...req,
          params: { ...(req.params || {}), id: String(invoiceId) },
        },
        response
      )
    )
      .then(() => {
        if (!resolved) {
          resolve({ statusCode: response.statusCode || 200, payload: null });
        }
      })
      .catch(reject);
  });
};

const softDeleteReading = async ({ reading, actorUserId = null, reason = "", deletedInvoiceId = null }) => {
  const existingNotes = String(reading.notes || "").trim();
  const auditNote = String(reason || "Meter reading deleted.").trim();

  reading.status = "deleted";
  reading.deletedAt = new Date();
  reading.deletedBy = actorUserId || null;
  reading.deletionReason = auditNote;
  reading.deletedInvoice = deletedInvoiceId || reading.deletedInvoice || null;
  reading.billedInvoice = null;
  reading.billedAt = null;
  reading.updatedBy = actorUserId || reading.updatedBy || null;
  reading.notes = existingNotes ? `${existingNotes}\n[Deleted] ${auditNote}` : `[Deleted] ${auditNote}`;
  await reading.save();

  return populateReadingQuery(MeterReading.findById(reading._id));
};

const resolveBillableTenantForReading = async (reading) => {
  if (reading?.tenant) {
    const linkedTenant = await Tenant.findOne({
      _id: reading.tenant,
      business: reading.business,
      $or: [{ unit: reading.unit }, { additionalUnits: reading.unit }],
      status: { $in: ACTIVE_TENANT_STATUSES },
    })
      .select("_id name")
      .lean();

    if (linkedTenant?._id) {
      return linkedTenant;
    }

    throw new Error(
      "The linked tenant on this draft meter reading is no longer active on the unit. Edit the draft reading and attach the correct current tenant before billing."
    );
  }

  const activeTenant = await findActiveTenantForUnit({
    businessId: reading.business,
    unitId: reading.unit,
  });

  if (activeTenant?._id) {
    return activeTenant;
  }

  throw new Error(
    "No active tenant is linked to this meter reading's unit. Attach the correct tenant before billing."
  );
};

export const getMeterReadings = async (req, res, next) => {
  try {
    const businessId = ensureBusinessAccess(req, resolveBusinessId(req));

    const query = { business: businessId };
    if (req.query.property) query.property = req.query.property;
    if (req.query.unit) query.unit = req.query.unit;
    if (req.query.tenant) query.tenant = req.query.tenant;
    if (req.query.status) {
      query.status = req.query.status;
    } else {
      query.status = { $ne: "deleted" };
    }
    if (req.query.billingPeriod) query.billingPeriod = toPeriodKey(req.query.billingPeriod);
    if (req.query.utilityType) {
      query.utilityType = { $regex: `^${escapeRegex(String(req.query.utilityType).trim())}$`, $options: "i" };
    }

    const foPropertyIds = await getFieldOfficerPropertyIds(req);
    if (foPropertyIds !== null) {
      if (query.property) {
        const foSet = new Set(foPropertyIds.map(String));
        if (!foSet.has(String(query.property))) {
          return res.status(200).json({ success: true, data: [], total: 0, page: 1, pages: 1 });
        }
      } else {
        query.property = { $in: foPropertyIds };
      }
    }

    const pageNum = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(req.query.limit, 10) || 5000, 1), 5000);

    const [readings, total] = await Promise.all([
      populateReadingQuery(MeterReading.find(query))
        .sort({ readingDate: -1, createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      MeterReading.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      data: readings,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    next(err);
  }
};

export const createMeterReading = async (req, res, next) => {
  try {
    const payload = await buildReadingPayload({ req });

    await checkDuplicateReading({
      businessId: payload.business,
      unitId: payload.unit,
      utilityType: payload.utilityType,
      billingPeriod: payload.billingPeriod,
    });

    const actorUserId = await resolveActorUserId(req, { businessId: payload.business });

    const reading = await MeterReading.create({
      ...payload,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    const populated = await populateReadingQuery(MeterReading.findById(reading._id));
    return res.status(201).json(populated);
  } catch (err) {
    if (
      err.message?.includes("already exists") ||
      err.message?.includes("cannot be less") ||
      err.message?.includes("cannot be negative")
    ) {
      return next(createError(400, err.message));
    }
    next(err);
  }
};

export const createMeterReadingsBatch = async (req, res, next) => {
  try {
    const businessId = ensureBusinessAccess(req, resolveBusinessId(req));

    const propertyId = req.body.property;
    const utilityType = String(req.body.utilityType || "").trim();
    const billingPeriod = toPeriodKey(req.body.billingPeriod, req.body.readingDate || new Date());
    const readingDate = normalizeDate(req.body.readingDate || new Date());
    const isMeterReset = Boolean(req.body.isMeterReset);
    const rows = Array.isArray(req.body.readings) ? req.body.readings : [];

    if (!propertyId || !utilityType || !billingPeriod) {
      return next(createError(400, "Property, utility type, and billing period are required."));
    }

    if (!rows.length) {
      return next(createError(400, "At least one reading row is required."));
    }

    const propertyDoc = await Property.findOne({ _id: propertyId, business: businessId })
      .select("_id landlord business propertyName utilityRates")
      .lean();

    if (!propertyDoc) {
      return next(createError(404, "Property not found for this business."));
    }

    const unitIds = Array.from(
      new Set(
        rows
          .map((row) => String(row?.unit || "").trim())
          .filter((id) => mongoose.Types.ObjectId.isValid(id))
      )
    );

    if (!unitIds.length) {
      return next(createError(400, "No valid unit rows were provided."));
    }

    const [unitDocs, activeTenants, previousReadings, duplicateReadings, utilityDoc] = await Promise.all([
      Unit.find({ _id: { $in: unitIds }, business: businessId, property: propertyId })
        .select("_id property unitNumber utilities business")
        .lean(),
      Tenant.find({
        business: businessId,
        $or: [{ unit: { $in: unitIds } }, { additionalUnits: { $in: unitIds } }],
        status: { $in: ACTIVE_TENANT_STATUSES },
      })
        .select("_id name unit additionalUnits status moveInDate createdAt")
        .sort({ moveInDate: -1, createdAt: -1 })
        .lean(),
      MeterReading.find({
        business: businessId,
        property: propertyId,
        unit: { $in: unitIds },
        utilityType: { $regex: `^${String(utilityType).trim()}$`, $options: "i" },
        status: { $in: PREVIOUS_READING_STATUSES },
        billingPeriod: { $lt: billingPeriod },
      })
        .select("unit currentReading billingPeriod readingDate createdAt")
        .sort({ billingPeriod: -1, readingDate: -1, createdAt: -1 })
        .lean(),
      MeterReading.find({
        business: businessId,
        unit: { $in: unitIds },
        utilityType: { $regex: `^${String(utilityType).trim()}$`, $options: "i" },
        billingPeriod,
        status: { $in: DUPLICATE_BLOCKING_STATUSES },
      })
        .select("unit")
        .lean(),
      Utility.findOne({
        business: businessId,
        name: { $regex: `^${String(utilityType).trim()}$`, $options: "i" },
        isActive: true,
      })
        .select("unitCost")
        .lean(),
    ]);

    const unitMap = new Map(unitDocs.map((unit) => [String(unit._id), unit]));

    const tenantByUnit = new Map();
    activeTenants.forEach((tenant) => {
      const candidateUnitIds = [String(tenant.unit || ""), ...(tenant.additionalUnits || []).map(String)];
      candidateUnitIds.forEach((uid) => {
        if (!tenantByUnit.has(uid)) {
          tenantByUnit.set(uid, tenant);
        }
      });
    });

    const previousByUnit = new Map();
    previousReadings.forEach((reading) => {
      const uid = String(reading.unit);
      if (!previousByUnit.has(uid)) {
        previousByUnit.set(uid, Number(reading.currentReading || 0));
      }
    });

    const duplicateUnitSet = new Set(duplicateReadings.map((reading) => String(reading.unit)));

    const propertyRate = (propertyDoc.utilityRates || []).find(
      (r) =>
        String(r?.utilityType || "").trim().toLowerCase() === utilityType.toLowerCase() &&
        r?.isActive !== false
    );

    const resolveRowRate = ({ unitDoc, providedRate }) => {
      const directRate = normalizeAmount(providedRate, NaN);
      if (Number.isFinite(directRate) && directRate >= 0) {
        return directRate;
      }

      const unitUtility = (unitDoc?.utilities || []).find(
        (item) => String(item?.utility || "").trim().toLowerCase() === utilityType.toLowerCase()
      );
      if (unitUtility && Number.isFinite(Number(unitUtility.unitCharge))) {
        return Number(unitUtility.unitCharge || 0);
      }

      if (propertyRate && Number.isFinite(Number(propertyRate.unitCost))) {
        return Number(propertyRate.unitCost || 0);
      }

      if (utilityDoc && Number.isFinite(Number(utilityDoc.unitCost))) {
        return Number(utilityDoc.unitCost || 0);
      }

      return 0;
    };

    const actorUserId = await resolveActorUserId(req, { businessId });

    const toCreate = [];
    const skipped = [];

    rows.forEach((row) => {
      const unitId = String(row?.unit || "").trim();
      const unitDoc = unitMap.get(unitId);

      if (!unitDoc) {
        skipped.push({ unit: unitId, reason: "Unit not found for this property." });
        return;
      }

      if (duplicateUnitSet.has(unitId)) {
        skipped.push({
          unit: unitId,
          unitNumber: unitDoc.unitNumber,
          reason: "A meter reading already exists for this unit, utility, and billing period.",
        });
        return;
      }

      const currentReadingRaw = row?.currentReading;
      if (currentReadingRaw === undefined || currentReadingRaw === null || currentReadingRaw === "") {
        skipped.push({ unit: unitId, unitNumber: unitDoc.unitNumber, reason: "Current reading is required." });
        return;
      }

      const previousReadingRaw =
        row?.previousReading !== undefined && row?.previousReading !== null && row?.previousReading !== ""
          ? row.previousReading
          : previousByUnit.get(unitId) || 0;

      let consumption;
      try {
        consumption = computeConsumption({
          previousReading: previousReadingRaw,
          currentReading: currentReadingRaw,
          isMeterReset,
        });
      } catch (err) {
        skipped.push({ unit: unitId, unitNumber: unitDoc.unitNumber, reason: err.message });
        return;
      }

      const rate = resolveRowRate({ unitDoc, providedRate: row?.rate });
      const amount = Number((consumption.unitsConsumed * rate).toFixed(2));

      const tenantId =
        row?.tenant && mongoose.Types.ObjectId.isValid(String(row.tenant))
          ? row.tenant
          : tenantByUnit.get(unitId)?._id || null;

      toCreate.push({
        business: businessId,
        property: propertyDoc._id,
        unit: unitDoc._id,
        tenant: tenantId,
        utilityType,
        meterNumber: String(row?.meterNumber ?? "").trim(),
        billingPeriod,
        readingDate,
        previousReading: consumption.previousReading,
        currentReading: consumption.currentReading,
        unitsConsumed: consumption.unitsConsumed,
        rate: Number(rate || 0),
        amount,
        isMeterReset,
        notes: String(row?.notes ?? "").trim(),
        status: "draft",
        createdBy: actorUserId,
        updatedBy: actorUserId,
      });
    });

    let createdReadings = [];
    if (toCreate.length) {
      const inserted = await MeterReading.insertMany(toCreate);
      const insertedIds = inserted.map((doc) => doc._id);
      createdReadings = await populateReadingQuery(MeterReading.find({ _id: { $in: insertedIds } })).sort({
        readingDate: -1,
        createdAt: -1,
      });
    }

    return res.status(201).json({
      created: createdReadings,
      skipped,
      createdCount: createdReadings.length,
      skippedCount: skipped.length,
    });
  } catch (err) {
    next(err);
  }
};

export const updateMeterReading = async (req, res, next) => {
  try {
    const reading = await MeterReading.findById(req.params.id);
    if (!reading) {
      return next(createError(404, "Meter reading not found."));
    }

    ensureReadingAccess(req, reading);

    if (reading.status !== "draft") {
      return next(createError(400, "Only draft meter readings can be edited."));
    }

    const payload = await buildReadingPayload({ req, existingReading: reading });

    await checkDuplicateReading({
      businessId: payload.business,
      unitId: payload.unit,
      utilityType: payload.utilityType,
      billingPeriod: payload.billingPeriod,
      excludeId: reading._id,
    });

    Object.assign(reading, payload, {
      updatedBy: await resolveActorUserId(req, { businessId: payload.business }),
    });

    await reading.save();

    const populated = await populateReadingQuery(MeterReading.findById(reading._id));
    return res.status(200).json(populated);
  } catch (err) {
    if (
      err.message?.includes("already exists") ||
      err.message?.includes("cannot be less") ||
      err.message?.includes("cannot be negative")
    ) {
      return next(createError(400, err.message));
    }
    next(err);
  }
};

export const deleteMeterReading = async (req, res, next) => {
  try {
    const reading = await MeterReading.findById(req.params.id);
    if (!reading) {
      return next(createError(404, "Meter reading not found."));
    }

    ensureReadingAccess(req, reading);

    if (reading.status === "deleted") {
      return next(createError(400, "This meter reading has already been deleted."));
    }

    const actorUserId = await resolveActorUserId(req, { businessId: String(reading.business || "") }).catch(() => null);

    if (reading.status === "billed" && reading.billedInvoice) {
      const invoiceDeletion = await invokeInvoiceDeletionForMeterReading({
        req,
        invoiceId: reading.billedInvoice,
      });

      if (Number(invoiceDeletion?.statusCode || 500) >= 400) {
        const payload = invoiceDeletion?.payload || {};
        return res.status(invoiceDeletion.statusCode || 400).json({
          message:
            payload?.error ||
            payload?.message ||
            "Failed to reverse the linked utility invoice for this meter reading.",
        });
      }

      const refreshedReading = await MeterReading.findById(reading._id);
      if (!refreshedReading) {
        return res.status(200).json({
          success: true,
          message: "Linked invoice reversed and meter reading removed successfully.",
        });
      }

      const deletedReading = await softDeleteReading({
        reading: refreshedReading,
        actorUserId,
        reason: `Meter reading deleted after reversing linked invoice ${reading.billedInvoice}.`,
        deletedInvoiceId: reading.billedInvoice,
      });

      return res.status(200).json({
        success: true,
        message: "Meter reading deleted and linked invoice reversed successfully.",
        reading: deletedReading,
        deletedId: refreshedReading._id,
      });
    }

    const deletedReading = await softDeleteReading({
      reading,
      actorUserId,
      reason:
        reading.status === "void"
          ? "Voided meter reading deleted from register."
          : "Draft meter reading deleted from register.",
      deletedInvoiceId: null,
    });

    return res.status(200).json({
      success: true,
      message: "Meter reading deleted successfully.",
      reading: deletedReading,
      deletedId: reading._id,
    });
  } catch (err) {
    next(err);
  }
};

export const voidMeterReading = async (req, res, next) => {
  try {
    const reading = await MeterReading.findById(req.params.id);
    if (!reading) {
      return next(createError(404, "Meter reading not found."));
    }

    ensureReadingAccess(req, reading);

    if (reading.status === "deleted") {
      return next(createError(400, "Deleted meter readings cannot be voided."));
    }

    if (reading.status === "billed") {
      return next(createError(400, "Billed meter readings cannot be voided here because they are already linked to an invoice. Delete the meter reading to reverse the linked invoice correctly."));
    }

    if (reading.status === "void") {
      return next(createError(400, "This meter reading is already voided."));
    }

    const actorUserId = await resolveActorUserId(req, { businessId: String(reading.business || "") });
    reading.status = "void";
    reading.voidedAt = new Date();
    reading.voidedBy = actorUserId;
    reading.updatedBy = actorUserId;
    if (req.body?.notes) {
      reading.notes = String(req.body.notes).trim();
    }
    await reading.save();

    const populated = await populateReadingQuery(MeterReading.findById(reading._id));
    return res.status(200).json(populated);
  } catch (err) {
    next(err);
  }
};

export const billMeterReading = async (req, res, next) => {
  try {
    const reading = await MeterReading.findById(req.params.id);
    if (!reading) {
      return next(createError(404, "Meter reading not found."));
    }

    ensureReadingAccess(req, reading);

    if (reading.status === "void") {
      return next(createError(400, "Voided meter readings cannot be billed."));
    }

    if (reading.status === "deleted") {
      return next(createError(400, "Deleted meter readings cannot be billed."));
    }

    if (reading.status === "billed" || reading.billedInvoice) {
      return next(createError(400, "This meter reading has already been billed."));
    }

    const accountingContext = await resolvePropertyAccountingContext({
      propertyId: reading.property,
      landlordId: null,
      businessId: reading.business,
    });

    const activeTenant = await resolveBillableTenantForReading(reading);

    const invoiceDate = normalizeDate(req.body.invoiceDate || reading.readingDate || new Date());
    const dueDate = normalizeDate(req.body.dueDate || invoiceDate, invoiceDate);

    const invoiceDescription =
      req.body.description ||
      `${reading.utilityType} meter reading for ${reading.billingPeriod} (${reading.previousReading} to ${reading.currentReading}, ${reading.unitsConsumed} units @ ${reading.rate})`;

    const invoice = await createTenantInvoiceRecord({
      req,
      payload: {
        business: String(reading.business),
        property: String(accountingContext.propertyId),
        landlord: String(accountingContext.landlordId),
        tenant: String(activeTenant._id),
        unit: String(reading.unit),
        category: "UTILITY_CHARGE",
        amount: Number(reading.amount || 0),
        description: invoiceDescription,
        invoiceDate,
        dueDate,
        chartAccountId: req.body.chartAccountId || null,
        metadata: {
          includeInLandlordStatement: true,
          includeInCategoryTotals: true,
          sourceTransactionType: "meter_reading",
          meterReadingId: String(reading._id),
          utilityType: reading.utilityType,
          meterUtilityType: reading.utilityType,
          billingPeriod: reading.billingPeriod,
        },
      },
    });

    reading.tenant = activeTenant._id;
    reading.status = "billed";
    reading.billedInvoice = invoice._id;
    reading.billedAt = new Date();
    reading.updatedBy = await resolveActorUserId(req, { businessId: String(reading.business || "") });
    await reading.save();

    const populatedReading = await populateReadingQuery(MeterReading.findById(reading._id));

    return res.status(200).json({
      message: "Meter reading billed successfully.",
      reading: populatedReading,
      invoice,
    });
  } catch (err) {
    next(err);
  }
};

const invokeMeterReadingAction = ({ req, handler, readingId, body = {} }) => {
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
        reject(err || new Error("Failed to process meter reading."));
      }
    };

    Promise.resolve(
      handler(
        {
          ...req,
          params: { ...(req.params || {}), id: String(readingId) },
          body: { ...(req.body || {}), ...body },
        },
        response,
        nextFn
      )
    ).catch((err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
};

export const billMeterReadingsBatch = async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.readingIds) ? req.body.readingIds : [];
    const validIds = Array.from(
      new Set(ids.map((id) => String(id || "").trim()).filter((id) => mongoose.Types.ObjectId.isValid(id)))
    );

    if (!validIds.length) {
      return next(createError(400, "At least one meter reading id is required."));
    }

    const readings = await MeterReading.find({ _id: { $in: validIds } }).select("readingDate").lean();
    const readingById = new Map(readings.map((r) => [String(r._id), r]));

    const succeeded = [];
    const failed = [];

    for (const readingId of validIds) {
      const readingDoc = readingById.get(readingId);
      try {
        const { statusCode, payload } = await invokeMeterReadingAction({
          req,
          handler: billMeterReading,
          readingId,
          body: {
            invoiceDate: readingDoc?.readingDate,
            dueDate: readingDoc?.readingDate,
          },
        });

        if (Number(statusCode || 200) >= 400) {
          failed.push({ id: readingId, reason: payload?.message || payload?.error || "Failed to bill meter reading." });
          continue;
        }

        succeeded.push({
          id: readingId,
          reading: payload?.reading,
          invoice: payload?.invoice,
          message: payload?.message || "Meter reading billed successfully.",
        });
      } catch (error) {
        failed.push({ id: readingId, reason: error?.message || "Failed to bill meter reading." });
      }
    }

    return res.status(200).json({
      succeeded,
      failed,
      succeededCount: succeeded.length,
      failedCount: failed.length,
    });
  } catch (err) {
    next(err);
  }
};

export const deleteMeterReadingsBatch = async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.readingIds) ? req.body.readingIds : [];
    const validIds = Array.from(
      new Set(ids.map((id) => String(id || "").trim()).filter((id) => mongoose.Types.ObjectId.isValid(id)))
    );

    if (!validIds.length) {
      return next(createError(400, "At least one meter reading id is required."));
    }

    const succeeded = [];
    const failed = [];

    for (const readingId of validIds) {
      try {
        const { statusCode, payload } = await invokeMeterReadingAction({
          req,
          handler: deleteMeterReading,
          readingId,
        });

        if (Number(statusCode || 200) >= 400) {
          failed.push({ id: readingId, reason: payload?.message || payload?.error || "Failed to delete meter reading." });
          continue;
        }

        succeeded.push({
          id: readingId,
          message: payload?.message || "Meter reading deleted successfully.",
        });
      } catch (error) {
        failed.push({ id: readingId, reason: error?.message || "Failed to delete meter reading." });
      }
    }

    return res.status(200).json({
      succeeded,
      failed,
      succeededCount: succeeded.length,
      failedCount: failed.length,
    });
  } catch (err) {
    next(err);
  }
};
