import mongoose from "mongoose";
import Tenant from "../../models/Tenant.js";
import Unit from "../../models/Unit.js";
import Property from "../../models/Property.js";
import RentPayment from "../../models/RentPayment.js";
import TenantInvoice from "../../models/TenantInvoice.js";

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

const normalizeTenantStatus = (value) => {
  const raw = String(value || "active").trim().toLowerCase();
  return raw === "moved_out" ? "terminated" : raw;
};

const sanitizeUtilities = (utilities = []) => {
  if (!Array.isArray(utilities)) return [];
  return utilities.map((item) => ({
    utility: normalizeString(item?.utility) || "",
    utilityLabel: normalizeString(item?.utilityLabel) || "",
    unitCharge: Number(item?.unitCharge || 0),
    isIncluded: !!item?.isIncluded,
  }));
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

  await Unit.findByIdAndUpdate(unitId, {
    status: "vacant",
    isVacant: true,
    vacantSince: effectiveDate,
    daysVacant: 0,
    lastTenant: tenantId,
  });

  if (unit.property) {
    await updatePropertyUnitCounts(unit.property);
  }

  return unit;
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

    const unit = await Unit.findOne({
      _id: req.body.unit,
      business: businessId,
    }).populate("property", "depositHeldBy");

    if (!unit) {
      return res.status(404).json({
        success: false,
        message: "Unit not found for the selected company",
      });
    }

    const normalizedStatus = String(unit.status || "").trim().toLowerCase();
    const normalizedIsVacant = unit.isVacant !== false;

    if (normalizedStatus !== "vacant" || !normalizedIsVacant) {
      return res.status(400).json({
        success: false,
        message: "Unit is not available",
      });
    }

    const existingActiveTenant = await Tenant.findOne({
      unit: unit._id,
      business: businessId,
      status: { $in: ["active", "overdue"] },
    });

    if (existingActiveTenant) {
      return res.status(400).json({
        success: false,
        message: "This unit already has an active tenant",
      });
    }

    const normalizedName = normalizeString(req.body.name);
    const normalizedPhone = normalizeString(req.body.phone);
    const normalizedIdNumber = normalizeString(req.body.idNumber);
    const normalizedPaymentMethod = normalizeLower(req.body.paymentMethod);
    const normalizedTenantCode = normalizeString(req.body.tenantCode);

    if (!normalizedName || !normalizedPhone || !normalizedIdNumber || !normalizedPaymentMethod) {
      return res.status(400).json({
        success: false,
        message: "Tenant name, phone, ID number, and payment method are required",
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
      rent: Number(req.body.rent || unit.rent || 0),
      depositAmount: defaultDepositAmount,
      depositHeldBy: normalizeDepositHolder(req.body.depositHeldBy, unit.property?.depositHeldBy),
      status: normalizeTenantStatus(req.body.status || "active"),
      depositRefundStatus: defaultDepositAmount > 0 ? "pending" : "not_applicable",
      depositRefundAmount: defaultDepositAmount,
      documents: sanitizeDocuments(req.body.documents),
      utilities: sanitizeUtilities(req.body.utilities),
      emergencyContact: sanitizeEmergencyContact(req.body.emergencyContact),
    });

    const savedTenant = await newTenant.save();
    await setUnitOccupied(unit._id, savedTenant._id);

    return res.status(201).json({
      success: true,
      data: savedTenant,
      message: "Tenant created successfully",
    });
  } catch (err) {
    console.error("Create tenant error:", err);

    if (err?.code === 11000) {
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
      .populate("unit.property", "propertyName propertyCode address name propertyType depositHeldBy");

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
      normalizedPayload.paymentMethod = normalizeLower(normalizedPayload.paymentMethod);
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

    if (Object.prototype.hasOwnProperty.call(normalizedPayload, "depositHeldBy")) {
      const unit = tenant.unit
        ? await Unit.findById(tenant.unit).populate("property", "depositHeldBy")
        : null;

      normalizedPayload.depositHeldBy = normalizeDepositHolder(
        normalizedPayload.depositHeldBy,
        unit?.property?.depositHeldBy
      );
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

    const updatedTenant = await Tenant.findByIdAndUpdate(
      req.params.id,
      { $set: normalizedPayload },
      { new: true, runValidators: true }
    )
      .populate("unit", "unitNumber property")
      .populate("unit.property", "propertyName propertyCode depositHeldBy");

    return res.status(200).json({
      success: true,
      data: updatedTenant,
    });
  } catch (err) {
    if (err?.code === 11000) {
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

    const paymentCount = await RentPayment.countDocuments({
      tenant: req.params.id,
      business: tenant.business,
    });

    if (paymentCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete tenant with ${paymentCount} existing transaction(s). Please archive the tenant instead.`,
      });
    }

    if (tenant.unit) {
      await setUnitVacant(tenant.unit, tenant._id, new Date());
    }

    await Tenant.findByIdAndDelete(req.params.id);

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

    const updateData = { status };

    if (status === "terminated") {
      const effectiveTerminationDate = terminationDate ? new Date(terminationDate) : new Date();
      updateData.moveOutDate = effectiveTerminationDate;
      updateData.terminationDate = effectiveTerminationDate;
      updateData.terminationReason = terminationReason;
      updateData.depositRefundAmount = depositRefundAmount;
      updateData.depositRefundReference = depositRefundReference;
      updateData.depositRefundStatus =
        depositRefundAmount > 0 ? req.body?.depositRefundStatus || "pending" : "not_applicable";

      if (tenant.unit) {
        await setUnitVacant(tenant.unit, tenant._id, effectiveTerminationDate);
      }
    } else if (
      status === "active" &&
      ["terminated", "moved_out"].includes(String(tenant.status || "").toLowerCase())
    ) {
      updateData.terminationDate = null;
      updateData.terminationReason = "";

      if (tenant.unit) {
        const unit = await Unit.findById(tenant.unit);

        if (!unit) {
          return res.status(404).json({
            success: false,
            message: "Tenant unit not found",
          });
        }

        if (String(unit.status || "").toLowerCase() !== "vacant") {
          return res.status(400).json({
            success: false,
            message: "Cannot reactivate tenant because the unit is not vacant",
          });
        }

        const existingOccupant = await Tenant.findOne({
          _id: { $ne: tenant._id },
          unit: tenant.unit,
          business: tenant.business,
          status: { $in: ["active", "overdue"] },
        });

        if (existingOccupant) {
          return res.status(400).json({
            success: false,
            message: "Cannot reactivate tenant because the unit already has an active tenant",
          });
        }

        await setUnitOccupied(tenant.unit, tenant._id);
      }
    }

    const updatedTenant = await Tenant.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    return res.status(200).json({
      success: true,
      data: updatedTenant,
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
    const tenant = await Tenant.findById(tenantId).populate("unit");
    if (!tenant || !tenant.unit) return { rent: 0, utilities: [], total: 0 };

    const unit = await Unit.findById(tenant.unit).populate(
      "utilities.utility",
      "name unitCost billingCycle"
    );

    if (!unit) return { rent: 0, utilities: [], total: 0 };

    let total = Number(unit.rent || 0);
    const utilitiesBreakdown = [];

    (unit.utilities || []).forEach((item) => {
      if (item.isIncluded && item.utility) {
        const utility = item.utility;
        let charge = 0;

        if (utility.billingCycle === "monthly") {
          charge = item.unitCharge || utility.unitCost || 0;
        } else if (utility.billingCycle === "quarterly") {
          charge = (item.unitCharge || utility.unitCost || 0) / 3;
        } else if (utility.billingCycle === "annually") {
          charge = (item.unitCharge || utility.unitCost || 0) / 12;
        }

        if (charge > 0) {
          total += charge;
          utilitiesBreakdown.push({
            utility: utility._id,
            name: utility.name,
            amount: charge,
            billingCycle: utility.billingCycle,
          });
        }
      }
    });

    return {
      rent: Number(unit.rent || 0),
      utilities: utilitiesBreakdown,
      total: parseFloat(total.toFixed(2)),
      tenantBalance: Number(tenant.balance || 0),
    };
  } catch (error) {
    console.error("Error calculating tenant total due:", error);
    return { rent: 0, utilities: [], total: 0, tenantBalance: 0 };
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

    const units = await Unit.find({ business: businessId }).populate("property");
    const unitMap = new Map();

    units.forEach((unit) => {
      const propertyCode = unit.property?.propertyCode?.toLowerCase();
      const unitNumber = unit.unitNumber?.toLowerCase();
      if (propertyCode && unitNumber) {
        unitMap.set(`${propertyCode}|${unitNumber}`, unit);
      }
    });

    const existingTenants = await Tenant.find({ business: businessId });
    const existingIds = new Set(
      existingTenants.map((t) => String(t.idNumber || "").toLowerCase()).filter(Boolean)
    );
    const existingCodes = new Set(
      existingTenants.map((t) => String(t.tenantCode || "").toLowerCase()).filter(Boolean)
    );

    const successful = [];
    const failed = [];
    const touchedPropertyIds = new Set();

    for (let i = 0; i < tenantsData.length; i++) {
      const record = tenantsData[i];
      const rowIndex = i + 1;

      try {
        if (!record.propertyCode) {
          failed.push({
            tenantName: record.tenantName,
            error: "Property Code is required",
            row: rowIndex,
          });
          continue;
        }

        const unitLookupKey = `${String(record.propertyCode).trim().toLowerCase()}|${String(
          record.unitNumber || ""
        )
          .trim()
          .toLowerCase()}`;

        const unitDoc = unitMap.get(unitLookupKey);

        if (!unitDoc) {
          failed.push({
            tenantName: record.tenantName,
            error: `Combination not found: Property "${record.propertyCode}" + Unit "${record.unitNumber}"`,
            row: rowIndex,
          });
          continue;
        }

        if (String(unitDoc.status || "").toLowerCase() !== "vacant" || unitDoc.isVacant === false) {
          failed.push({
            tenantName: record.tenantName,
            error: `Unit "${record.unitNumber}" is not vacant`,
            row: rowIndex,
          });
          continue;
        }

        const normalizedIdNumber = String(record.idNumber || "").trim().toLowerCase();
        if (existingIds.has(normalizedIdNumber)) {
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

        const propertyDepositHeldBy = unitDoc?.property?.depositHeldBy || "propertyManager";
        const depositAmount = Number(record.depositAmount ?? record.rent ?? unitDoc.rent ?? 0);

        const newTenant = new Tenant({
          name: normalizeString(record.tenantName),
          phone: normalizeString(record.phoneNumber),
          idNumber: normalizeString(record.idNumber),
          unit: unitDoc._id,
          rent: Number(record.rent || unitDoc.rent || 0),
          balance: 0,
          status: normalizeTenantStatus(record.status || "active"),
          depositAmount,
          depositHeldBy: normalizeDepositHolder(record.depositHeldBy, propertyDepositHeldBy),
          depositRefundStatus: depositAmount > 0 ? "pending" : "not_applicable",
          depositRefundAmount: depositAmount,
          paymentMethod: normalizeLower(record.paymentMethod || "bank_transfer"),
          leaseType,
          moveInDate,
          moveOutDate: leaseType === "fixed" ? moveOutDate : null,
          tenantCode,
          business: businessId,
          emergencyContact: {
            name: normalizeString(record.emergencyContactName) || "",
            phone: normalizeString(record.emergencyContactPhone) || "",
            relationship: "",
          },
        });

        await newTenant.save();
        await setUnitOccupied(unitDoc._id, newTenant._id);

        existingIds.add(normalizedIdNumber);
        existingCodes.add(String(tenantCode).toLowerCase());
        touchedPropertyIds.add(String(unitDoc.property?._id || unitDoc.property));

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

    for (const propertyId of touchedPropertyIds) {
      await updatePropertyUnitCounts(propertyId);
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