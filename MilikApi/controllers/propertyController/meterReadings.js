import mongoose from "mongoose";
import MeterReading from "../../models/MeterReading.js";
import Property from "../../models/Property.js";
import Unit from "../../models/Unit.js";
import Tenant from "../../models/Tenant.js";
import Utility from "../../models/Utility.js";
import CompanySettings from "../../models/CompanySettings.js";
import { createTenantInvoiceRecord } from "./tenantInvoices.js";
import { resolvePropertyAccountingContext } from "../../services/propertyAccountingService.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";

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

const resolveBusinessId = (req) => {
  if (req.user?.isSystemAdmin && req.query.business) return String(req.query.business);
  if (req.user?.company) return String(req.user.company);
  if (req.body?.business) return String(req.body.business);
  return null;
};

const resolveActorUserId = async (req) =>
  resolveAuditActorUserId({
    req,
    businessId: resolveBusinessId(req),
    candidateUserIds: [req.body?.createdBy || null],
    fallbackErrorMessage: "No valid company user could be resolved for meter reading attribution.",
  });

const findActiveTenantForUnit = async ({ businessId, unitId }) => {
  if (!businessId || !unitId) return null;

  return Tenant.findOne({
    business: businessId,
    unit: unitId,
    status: { $in: ["active", "overdue"] },
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

  const utilityDoc = await Utility.findOne({
    business: businessId,
    name: { $regex: `^${String(utilityType || "").trim()}$`, $options: "i" },
    isActive: true,
  })
    .select("unitCost")
    .lean();

  if (utilityDoc && Number.isFinite(Number(utilityDoc.unitCost))) {
    return Number(utilityDoc.unitCost || 0);
  }

  const settings = await CompanySettings.findOne({ company: businessId })
    .select("utilityTypes")
    .lean();

  const matchedSetting = (settings?.utilityTypes || []).find(
    (item) => String(item?.name || "").trim().toLowerCase() === normalizedUtility
  );

  if (matchedSetting) {
    return 0;
  }

  return 0;
};

const getPreviousReadingValue = async ({ businessId, propertyId, unitId, utilityType, excludeId = null }) => {
  const query = {
    business: businessId,
    property: propertyId,
    unit: unitId,
    utilityType: { $regex: `^${String(utilityType || "").trim()}$`, $options: "i" },
    status: { $ne: "void" },
  };

  if (excludeId && mongoose.Types.ObjectId.isValid(String(excludeId))) {
    query._id = { $ne: excludeId };
  }

  const previous = await MeterReading.findOne(query)
    .sort({ readingDate: -1, createdAt: -1 })
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
    Property.findOne({ _id: propertyId, business: businessId }).select("_id landlord business propertyName").lean(),
    Unit.findOne({ _id: unitId, business: businessId }).select("_id property unitNumber utilities business").lean(),
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
    tenantDoc = await Tenant.findOne({ _id: tenantId, business: businessId, unit: unitId })
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
    status: { $ne: "void" },
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
  if (!businessId) {
    throw new Error("Business context is required.");
  }

  const propertyId = req.body.property || existingReading?.property;
  const unitId = req.body.unit || existingReading?.unit;
  const utilityType = String(req.body.utilityType || existingReading?.utilityType || "").trim();
  const billingPeriod = toPeriodKey(req.body.billingPeriod || existingReading?.billingPeriod, req.body.readingDate || existingReading?.readingDate || new Date());
  const readingDate = normalizeDate(req.body.readingDate || existingReading?.readingDate || new Date());
  const isMeterReset =
    req.body.isMeterReset !== undefined
      ? Boolean(req.body.isMeterReset)
      : Boolean(existingReading?.isMeterReset || false);

  if (!propertyId || !unitId || !utilityType) {
    throw new Error("Property, unit, and utility type are required.");
  }

  const { propertyDoc, unitDoc, tenantDoc } = await ensureReadingContext({
    businessId,
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
          businessId,
          propertyId,
          unitId,
          utilityType,
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
    businessId,
    unitDoc,
    utilityType,
    providedRate: req.body.rate !== undefined ? req.body.rate : existingReading?.rate,
  });

  const calculatedAmount = Number((unitsConsumed * Number(rate || 0)).toFixed(2));
  const suppliedAmount = req.body.amount !== undefined && req.body.amount !== null && req.body.amount !== ""
    ? normalizeAmount(req.body.amount, calculatedAmount)
    : calculatedAmount;

  return {
    business: businessId,
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

export const getMeterReadings = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) {
      return res.status(400).json({ message: "Business context is required." });
    }

    const query = { business: businessId };
    if (req.query.property) query.property = req.query.property;
    if (req.query.unit) query.unit = req.query.unit;
    if (req.query.tenant) query.tenant = req.query.tenant;
    if (req.query.status) query.status = req.query.status;
    if (req.query.billingPeriod) query.billingPeriod = toPeriodKey(req.query.billingPeriod);
    if (req.query.utilityType) {
      query.utilityType = { $regex: `^${String(req.query.utilityType).trim()}$`, $options: "i" };
    }

    const readings = await MeterReading.find(query)
      .populate("property", "propertyName propertyCode")
      .populate("unit", "unitNumber")
      .populate("tenant", "name tenantCode")
      .populate("billedInvoice", "_id invoiceNumber status amount dueDate")
      .sort({ readingDate: -1, createdAt: -1 });

    return res.status(200).json(readings);
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

    const actorUserId = await resolveActorUserId(req);

    const reading = await MeterReading.create({
      ...payload,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    const populated = await MeterReading.findById(reading._id)
      .populate("property", "propertyName propertyCode")
      .populate("unit", "unitNumber")
      .populate("tenant", "name tenantCode")
      .populate("billedInvoice", "_id invoiceNumber status amount dueDate");

    return res.status(201).json(populated);
  } catch (err) {
    if (err.message?.includes("already exists") || err.message?.includes("cannot be less")) {
      return res.status(400).json({ message: err.message });
    }
    next(err);
  }
};

export const updateMeterReading = async (req, res, next) => {
  try {
    const reading = await MeterReading.findById(req.params.id);
    if (!reading) {
      return res.status(404).json({ message: "Meter reading not found." });
    }

    if (reading.status !== "draft") {
      return res.status(400).json({ message: "Only draft meter readings can be edited." });
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
      updatedBy: await resolveActorUserId(req),
    });

    await reading.save();

    const populated = await MeterReading.findById(reading._id)
      .populate("property", "propertyName propertyCode")
      .populate("unit", "unitNumber")
      .populate("tenant", "name tenantCode")
      .populate("billedInvoice", "_id invoiceNumber status amount dueDate");

    return res.status(200).json(populated);
  } catch (err) {
    if (err.message?.includes("already exists") || err.message?.includes("cannot be less")) {
      return res.status(400).json({ message: err.message });
    }
    next(err);
  }
};

export const deleteMeterReading = async (req, res, next) => {
  try {
    const reading = await MeterReading.findById(req.params.id);
    if (!reading) {
      return res.status(404).json({ message: "Meter reading not found." });
    }

    if (reading.status !== "draft") {
      return res.status(400).json({ message: "Only draft meter readings can be deleted." });
    }

    await MeterReading.findByIdAndDelete(reading._id);
    return res.status(200).json({ success: true, deletedId: reading._id });
  } catch (err) {
    next(err);
  }
};

export const voidMeterReading = async (req, res, next) => {
  try {
    const reading = await MeterReading.findById(req.params.id);
    if (!reading) {
      return res.status(404).json({ message: "Meter reading not found." });
    }

    if (reading.status === "billed") {
      return res.status(400).json({
        message: "Billed meter readings cannot be voided here because they are already linked to an invoice. Reverse/delete the invoice through the normal invoice flow instead.",
      });
    }

    reading.status = "void";
    reading.voidedAt = new Date();
    reading.voidedBy = await resolveActorUserId(req);
    reading.updatedBy = await resolveActorUserId(req);
    if (req.body?.notes) {
      reading.notes = String(req.body.notes).trim();
    }
    await reading.save();

    return res.status(200).json(reading);
  } catch (err) {
    next(err);
  }
};

export const billMeterReading = async (req, res, next) => {
  try {
    const reading = await MeterReading.findById(req.params.id);
    if (!reading) {
      return res.status(404).json({ message: "Meter reading not found." });
    }

    if (reading.status === "void") {
      return res.status(400).json({ message: "Voided meter readings cannot be billed." });
    }

    if (reading.status === "billed" || reading.billedInvoice) {
      return res.status(400).json({ message: "This meter reading has already been billed." });
    }

    const accountingContext = await resolvePropertyAccountingContext({
      propertyId: reading.property,
      landlordId: null,
      businessId: reading.business,
    });

    const activeTenant = reading.tenant
      ? await Tenant.findById(reading.tenant).select("_id name").lean()
      : await findActiveTenantForUnit({ businessId: reading.business, unitId: reading.unit });

    if (!activeTenant?._id) {
      return res.status(400).json({
        message: "No active tenant is linked to this meter reading's unit. Attach the correct tenant before billing.",
      });
    }

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
    reading.updatedBy = await resolveActorUserId(req);
    await reading.save();

    const populatedReading = await MeterReading.findById(reading._id)
      .populate("property", "propertyName propertyCode")
      .populate("unit", "unitNumber")
      .populate("tenant", "name tenantCode")
      .populate("billedInvoice", "_id invoiceNumber status amount dueDate");

    return res.status(200).json({
      message: "Meter reading billed successfully.",
      reading: populatedReading,
      invoice,
    });
  } catch (err) {
    if (err.message) {
      return res.status(400).json({ message: err.message });
    }
    next(err);
  }
};
