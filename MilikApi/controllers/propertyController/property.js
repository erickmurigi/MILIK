import mongoose from "mongoose";
import Property from "../../models/Property.js";
import Unit from "../../models/Unit.js";
import Tenant from "../../models/Tenant.js";
import Landlord from "../../models/Landlord.js";
import { ensureSystemChartOfAccounts } from "../../services/chartOfAccountsService.js";
import { ensurePropertyControlAccount } from "../../services/propertyAccountingService.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";

const validatePropertyLandlords = async (businessId, landlords = []) => {
  const landlordIds = (Array.isArray(landlords) ? landlords : [])
    .map((item) => item?.landlordId)
    .filter((value) => mongoose.Types.ObjectId.isValid(value));

  if (landlordIds.length === 0) {
    return;
  }

  const linkedLandlords = await Landlord.find({
    _id: { $in: landlordIds },
    company: businessId,
  })
    .select("_id")
    .lean();

  const linkedIds = new Set(linkedLandlords.map((item) => String(item._id)));
  const hasMismatch = landlordIds.some((id) => !linkedIds.has(String(id)));

  if (hasMismatch) {
    const error = new Error("One or more selected landlords do not belong to this company.");
    error.statusCode = 400;
    throw error;
  }
};

// Create property
export const createProperty = async (req, res) => {
  try {
    const {
      dateAcquired,
      letManage,
      landlords,
      propertyCode,
      propertyName,
      lrNumber,
      category,
      propertyType,
      specification,
      multiStoreyType,
      numberOfFloors,
      country,
      townCityState,
      estateArea,
      roadStreet,
      zoneRegion,
      address,
      accountLedgerType,
      primaryBank,
      alternativeTaxPin,
      invoicePrefix,
      invoicePaymentTerms,
      mpesaPaybill,
      disableMpesaStkPush,
      mpesaNarration,
      standingCharges,
      securityDeposits,
      smsExemptions,
      emailExemptions,
      excludeFeeSummary,
      exemptFromLatePenalties,
      drawerBank,
      bankBranch,
      accountName,
      accountNumber,
      notes,
      specificContactInfo,
      description,
      status,
      images,
      business,
    } = req.body;

    const businessId = req.user?.company || business;

    if (!businessId) {
      return res.status(400).json({
        success: false,
        message:
          "Business context is required to create a property. Please ensure you are logged in with a company account.",
      });
    }

    const normalizedPropertyCode = typeof propertyCode === "string" ? propertyCode.trim() : "";
    const normalizedPropertyName = typeof propertyName === "string" ? propertyName.trim() : "";
    const normalizedLrNumber = typeof lrNumber === "string" ? lrNumber.trim() : "";
    const normalizedPropertyType = typeof propertyType === "string" ? propertyType.trim() : "";

    if (
      !normalizedPropertyCode ||
      !normalizedPropertyName ||
      !normalizedLrNumber ||
      !normalizedPropertyType
    ) {
      return res.status(400).json({
        success: false,
        message: "Property Code, Name, LR Number, and Type are required fields",
      });
    }

    const existingProperty = await Property.findOne({
      business: businessId,
      propertyCode: normalizedPropertyCode,
    });

    if (existingProperty) {
      return res.status(400).json({
        success: false,
        message: "Property with this code already exists",
      });
    }

    await ensureSystemChartOfAccounts(businessId);

    const bankingDetails = {
      drawerBank: drawerBank || "",
      bankBranch: bankBranch || "",
      accountName: accountName || "",
      accountNumber: accountNumber || "",
    };

    const createdById = await resolveAuditActorUserId({
      req,
      businessId,
      candidateUserIds: [req.body?.createdBy],
      fallbackErrorMessage: "No valid company user could be resolved for property creation.",
    });

    const cleanedData = {};
    if (typeof specification === "string" && specification.trim() !== "") {
      cleanedData.specification = specification.trim();
    }
    if (typeof multiStoreyType === "string" && multiStoreyType.trim() !== "") {
      cleanedData.multiStoreyType = multiStoreyType.trim();
    }
    if (typeof category === "string" && category.trim() !== "") {
      cleanedData.category = category.trim();
    }

    const validLandlords = (landlords || [])
      .filter((landlord) => {
        const landlordName = landlord?.name?.trim() || landlord?.landlordName?.trim() || "";
        const hasLandlordId =
          landlord?.landlordId && mongoose.Types.ObjectId.isValid(landlord.landlordId);
        return landlordName && landlordName.toLowerCase() !== "default" && hasLandlordId;
      })
      .map((landlord, index) => ({
        landlordId: landlord.landlordId,
        name: (landlord?.name || landlord?.landlordName || "").trim(),
        contact: landlord?.contact?.trim() || "",
        isPrimary: index === 0,
      }));

    if (validLandlords.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "At least one landlord with a valid landlordId is required. Please select a landlord from the list.",
      });
    }

    await validatePropertyLandlords(businessId, validLandlords);

    const validStandingCharges = (standingCharges || [])
      .filter((charge) => charge?.serviceCharge?.trim())
      .map((charge) => ({
        serviceCharge: charge.serviceCharge.trim(),
        chargeMode: charge.chargeMode || "Monthly",
        billingCurrency: charge.billingCurrency || "KES",
        costPerArea: charge?.costPerArea?.trim() || "",
        chargeValue: Math.max(0, parseFloat(charge.chargeValue) || 0),
        vatRate: charge.vatRate || "16%",
        escalatesWithRent: charge.escalatesWithRent || false,
      }));

    const validSecurityDeposits = (securityDeposits || [])
      .filter((deposit) => deposit?.depositType?.trim())
      .map((deposit) => ({
        depositType: deposit.depositType.trim(),
        amount: Math.max(0, parseFloat(deposit.amount) || 0),
        currency: deposit.currency || "KES",
        refundable: deposit.refundable !== false,
        terms: deposit?.terms?.trim() || "",
      }));

    const parsedFloors =
      numberOfFloors !== undefined && numberOfFloors !== null && numberOfFloors !== ""
        ? parseInt(numberOfFloors, 10)
        : 0;

    const property = new Property({
      dateAcquired: dateAcquired ? new Date(dateAcquired) : null,
      letManage,
      landlords: validLandlords,
      propertyCode: normalizedPropertyCode,
      propertyName: normalizedPropertyName,
      lrNumber: normalizedLrNumber,
      ...cleanedData,
      propertyType: normalizedPropertyType,
      numberOfFloors: Number.isNaN(parsedFloors) ? 0 : parsedFloors,
      country,
      townCityState,
      estateArea,
      roadStreet,
      zoneRegion,
      address:
        address ||
        `${roadStreet || ""}, ${estateArea || ""}, ${townCityState || ""}`
          .replace(/^,\s*|,\s*$/g, "")
          .replace(/,\s*,/g, ","),
      accountLedgerType,
      primaryBank,
      alternativeTaxPin,
      invoicePrefix,
      invoicePaymentTerms,
      mpesaPaybill,
      disableMpesaStkPush,
      mpesaNarration,
      standingCharges: validStandingCharges,
      securityDeposits: validSecurityDeposits,
      smsExemptions,
      emailExemptions,
      excludeFeeSummary,
      exemptFromLatePenalties: !!exemptFromLatePenalties,
      bankingDetails,
      notes,
      specificContactInfo,
      description: description || notes,
      status: status || "active",
      images: images || [],
      business: businessId,
      createdBy: createdById,
      updatedBy: createdById,
      controlAccount: null,
    });

    const savedProperty = await property.save();

    try {
      const controlAccount = await ensurePropertyControlAccount({
        businessId,
        propertyId: savedProperty._id,
        propertyCode: savedProperty.propertyCode,
        propertyName: savedProperty.propertyName,
      });

      if (
        controlAccount?._id &&
        String(savedProperty.controlAccount || "") !== String(controlAccount._id)
      ) {
        savedProperty.controlAccount = controlAccount._id;
        await savedProperty.save();
      }
    } catch (accountingError) {
      await Property.findByIdAndDelete(savedProperty._id);
      throw new Error(`Property control account creation failed: ${accountingError.message}`);
    }

    const populated = await Property.findById(savedProperty._id).populate(
      "controlAccount",
      "code name type group subGroup"
    );

    res.status(201).json({
      success: true,
      data: populated,
      message: "Property created successfully",
    });
  } catch (error) {
    console.error("Create property error:", error);

    let errorMessage = error.message || "Failed to create property";
    let statusCode = 500;

    if (error.name === "ValidationError" && error.errors) {
      const validationErrors = Object.values(error.errors)
        .filter((err) => err && err.message)
        .map((err) => err.message);

      if (validationErrors.length > 0) {
        errorMessage = validationErrors.join("; ");
        statusCode = 400;
      }
    } else if (error.code === 11000) {
      errorMessage = "A property with this code already exists";
      statusCode = 400;
    } else if (error.statusCode) {
      statusCode = error.statusCode;
    }

    res.status(statusCode).json({
      success: false,
      message: errorMessage,
    });
  }
};

// Get all properties
export const getProperties = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      status,
      zone,
      category,
      code,
      name,
      lrNumber,
      landlord,
      location,
    } = req.query;

    const businessId =
      req.user.isSystemAdmin && req.query.business
        ? req.query.business
        : req.user?.company;

    if (!businessId) {
      return res.status(400).json({
        success: false,
        message: "Business context is required to fetch properties",
      });
    }

    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const limitNumber = Math.max(parseInt(limit, 10) || 10, 1);

    const query = { business: businessId };
    const orConditions = [];

    if (search) {
      orConditions.push(
        { propertyCode: { $regex: search, $options: "i" } },
        { propertyName: { $regex: search, $options: "i" } },
        { lrNumber: { $regex: search, $options: "i" } }
      );
    }

    if (location) {
      orConditions.push(
        { address: { $regex: location, $options: "i" } },
        { townCityState: { $regex: location, $options: "i" } },
        { estateArea: { $regex: location, $options: "i" } },
        { roadStreet: { $regex: location, $options: "i" } }
      );
    }

    if (orConditions.length > 0) {
      query.$or = orConditions;
    }

    if (status) query.status = status;
    if (zone) query.zoneRegion = { $regex: zone, $options: "i" };
    if (category) query.propertyType = { $regex: category, $options: "i" };
    if (code) query.propertyCode = { $regex: code, $options: "i" };
    if (name) query.propertyName = { $regex: name, $options: "i" };
    if (lrNumber) query.lrNumber = { $regex: lrNumber, $options: "i" };
    if (landlord) query["landlords.landlordId"] = landlord;

    const properties = await Property.find(query)
      .populate("business", "companyName")
      .populate("createdBy", "surname otherNames email")
      .populate("updatedBy", "surname otherNames email")
      .populate("landlords.landlordId", "_id landlordName firstName lastName email")
      .populate("controlAccount", "code name type group subGroup")
      .limit(limitNumber)
      .skip((pageNumber - 1) * limitNumber)
      .sort({ createdAt: -1 });

    const total = await Property.countDocuments(query);

    res.json({
      success: true,
      data: properties,
      pagination: {
        total,
        page: pageNumber,
        pages: Math.ceil(total / limitNumber),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get single property
export const getProperty = async (req, res, next) => {
  try {
    const property = await Property.findById(req.params.id)
      .populate("business", "companyName")
      .populate("createdBy", "surname otherNames email")
      .populate("updatedBy", "surname otherNames email")
      .populate("landlords.landlordId", "_id landlordName firstName lastName email")
      .populate("controlAccount", "code name type group subGroup");

    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found",
      });
    }

    if (!req.user.isSystemAdmin) {
      const userBusinessId = req.user?.company;
      if (property.business.toString() !== userBusinessId?.toString()) {
        return res.status(403).json({
          success: false,
          message: "Not authorized to access this property",
        });
      }
    }

    res.json({
      success: true,
      data: property,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Update property
export const updateProperty = async (req, res, next) => {
  try {
    const property = await Property.findById(req.params.id);

    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found",
      });
    }

    if (!req.user.isSystemAdmin) {
      const userBusinessId = req.user?.company || req.user?.business;
      if (property.business.toString() !== userBusinessId?.toString()) {
        return res.status(403).json({
          success: false,
          message: "Not authorized to update this property",
        });
      }
    }

    const trimmedPropertyCode =
      typeof req.body.propertyCode === "string" ? req.body.propertyCode.trim() : undefined;

    if (
      trimmedPropertyCode !== undefined &&
      trimmedPropertyCode &&
      trimmedPropertyCode !== property.propertyCode
    ) {
      const existingProperty = await Property.findOne({
        business: property.business,
        propertyCode: trimmedPropertyCode,
        _id: { $ne: property._id },
      });

      if (existingProperty) {
        return res.status(400).json({
          success: false,
          message: "Property with this code already exists",
        });
      }
    }

    if (Array.isArray(req.body.landlords)) {
      await validatePropertyLandlords(property.business, req.body.landlords);
    }

    if (
      req.body.drawerBank !== undefined ||
      req.body.bankBranch !== undefined ||
      req.body.accountName !== undefined ||
      req.body.accountNumber !== undefined
    ) {
      req.body.bankingDetails = {
        drawerBank: req.body.drawerBank || property.bankingDetails?.drawerBank || "",
        bankBranch: req.body.bankBranch || property.bankingDetails?.bankBranch || "",
        accountName: req.body.accountName || property.bankingDetails?.accountName || "",
        accountNumber: req.body.accountNumber || property.bankingDetails?.accountNumber || "",
      };
    }

    const optionalEnumFields = ["specification", "multiStoreyType", "category"];
    optionalEnumFields.forEach((field) => {
      if (req.body[field] === "" || req.body[field] === null) {
        req.body[field] = undefined;
      }
      if (typeof req.body[field] === "string") {
        req.body[field] = req.body[field].trim();
      }
    });

    if (req.body.landlords) {
      const validLandlords = (req.body.landlords || [])
        .filter((landlord) => {
          const landlordName =
            landlord?.name?.trim() || landlord?.landlordName?.trim() || "";
          const hasLandlordId =
            landlord?.landlordId &&
            mongoose.Types.ObjectId.isValid(landlord.landlordId);
          return landlordName && landlordName.toLowerCase() !== "default" && hasLandlordId;
        })
        .map((landlord, index) => ({
          landlordId: landlord.landlordId,
          name: (landlord?.name || landlord?.landlordName || "").trim(),
          contact: landlord?.contact?.trim() || "",
          isPrimary: index === 0,
        }));

      if (validLandlords.length === 0) {
        return res.status(400).json({
          success: false,
          message:
            "At least one valid landlord with a valid landlordId is required. Please select a landlord from the list.",
        });
      }

      req.body.landlords = validLandlords;
    }

    if (req.body.propertyCode !== undefined && typeof req.body.propertyCode === "string") {
      req.body.propertyCode = req.body.propertyCode.trim();
    }
    if (req.body.propertyName !== undefined && typeof req.body.propertyName === "string") {
      req.body.propertyName = req.body.propertyName.trim();
    }
    if (req.body.lrNumber !== undefined && typeof req.body.lrNumber === "string") {
      req.body.lrNumber = req.body.lrNumber.trim();
    }
    if (req.body.propertyType !== undefined && typeof req.body.propertyType === "string") {
      req.body.propertyType = req.body.propertyType.trim();
    }

    Object.keys(req.body).forEach((key) => {
      if (
        key !== "drawerBank" &&
        key !== "bankBranch" &&
        key !== "accountName" &&
        key !== "accountNumber" &&
        key !== "controlAccount" &&
        key !== "updatedBy" &&
        key !== "createdBy" &&
        key !== "business" &&
        req.body[key] !== undefined
      ) {
        property[key] = req.body[key];
      }
    });

    property.updatedBy = await resolveAuditActorUserId({
      req,
      businessId: property.business,
      candidateUserIds: [req.body?.updatedBy],
      fallbackErrorMessage: "No valid company user could be resolved for property update.",
    });
    property.updatedAt = Date.now();

    const updatedProperty = await property.save();

    res.json({
      success: true,
      data: updatedProperty,
      message: "Property updated successfully",
    });
  } catch (error) {
    console.error("Update property error:", error);

    let errorMessage = error.message || "Failed to update property";
    let statusCode = 500;

    if (error.name === "ValidationError" && error.errors) {
      const validationErrors = Object.values(error.errors)
        .filter((err) => err && err.message)
        .map((err) => err.message);
      if (validationErrors.length > 0) {
        errorMessage = validationErrors.join("; ");
        statusCode = 400;
      }
    } else if (error.code === 11000) {
      errorMessage = "A property with this code already exists";
      statusCode = 400;
    } else if (error.statusCode) {
      statusCode = error.statusCode;
    }

    res.status(statusCode).json({
      success: false,
      message: errorMessage,
    });
  }
};

// Delete property
export const deleteProperty = async (req, res, next) => {
  try {
    const property = await Property.findById(req.params.id);

    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found",
      });
    }

    if (!req.user.isSystemAdmin) {
      const userBusinessId = req.user?.company || req.user?.business;
      if (property.business.toString() !== userBusinessId?.toString()) {
        return res.status(403).json({
          success: false,
          message: "Not authorized to delete this property",
        });
      }
    }

    const unitCount = await Unit.countDocuments({ property: property._id });

    if (unitCount > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete property with existing units. Delete units first.",
      });
    }

    await property.deleteOne();

    res.json({
      success: true,
      message: "Property deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Get property units
export const getPropertyUnits = async (req, res, next) => {
  try {
    const property = await Property.findById(req.params.id).select("_id business");

    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found",
      });
    }

    if (!req.user.isSystemAdmin) {
      const userBusinessId = req.user?.company || req.user?.business;
      if (property.business.toString() !== userBusinessId?.toString()) {
        return res.status(403).json({
          success: false,
          message: "Not authorized to access this property's units",
        });
      }
    }

    const units = await Unit.find({ property: req.params.id })
      .populate("property", "propertyName address")
      .sort({ unitNumber: 1 });

    res.status(200).json(units);
  } catch (err) {
    next(err);
  }
};

// Get property tenants
export const getPropertyTenants = async (req, res, next) => {
  try {
    const property = await Property.findById(req.params.id).select("_id business");

    if (!property) {
      return res.status(404).json({
        success: false,
        message: "Property not found",
      });
    }

    if (!req.user.isSystemAdmin) {
      const userBusinessId = req.user?.company || req.user?.business;
      if (property.business.toString() !== userBusinessId?.toString()) {
        return res.status(403).json({
          success: false,
          message: "Not authorized to access this property's tenants",
        });
      }
    }

    const units = await Unit.find({ property: req.params.id }).distinct("_id");
    const tenants = await Tenant.find({ unit: { $in: units } })
      .populate("unit", "unitNumber rent");

    res.status(200).json(tenants);
  } catch (err) {
    next(err);
  }
};

// Bulk import properties
export const bulkImportProperties = async (req, res, next) => {
  try {
    const { properties, business } = req.body;

    if (!Array.isArray(properties) || properties.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Properties array is required" });
    }

    if (properties.length > 1000) {
      return res
        .status(400)
        .json({ success: false, message: "Maximum 1000 properties per import" });
    }

    const businessId = req.user?.company || business;

    if (!businessId) {
      return res
        .status(400)
        .json({ success: false, message: "Business/Company ID is required" });
    }

    await ensureSystemChartOfAccounts(businessId);

    const normalizedProperties = properties.map((property) => ({
      ...property,
      propertyCode:
        typeof property?.propertyCode === "string" ? property.propertyCode.trim() : "",
      propertyName:
        typeof property?.propertyName === "string" ? property.propertyName.trim() : "",
      lrNumber: typeof property?.lrNumber === "string" ? property.lrNumber.trim() : "",
      propertyType:
        typeof property?.propertyType === "string" ? property.propertyType.trim() : "",
      category: typeof property?.category === "string" ? property.category.trim() : property?.category,
      townCityState:
        typeof property?.townCityState === "string"
          ? property.townCityState.trim()
          : property?.townCityState,
      estateArea:
        typeof property?.estateArea === "string" ? property.estateArea.trim() : property?.estateArea,
      roadStreet:
        typeof property?.roadStreet === "string" ? property.roadStreet.trim() : property?.roadStreet,
      zoneRegion:
        typeof property?.zoneRegion === "string" ? property.zoneRegion.trim() : property?.zoneRegion,
      landlordName:
        typeof property?.landlordName === "string"
          ? property.landlordName.trim()
          : property?.landlordName,
    }));

    const lrNumbers = normalizedProperties
      .filter((p) => p.lrNumber)
      .map((p) => p.lrNumber);

    const providedCodes = normalizedProperties
      .filter((p) => p.propertyCode)
      .map((p) => p.propertyCode);

    const existingByLR =
      lrNumbers.length > 0
        ? await Property.find({
            lrNumber: { $in: lrNumbers },
            business: businessId,
          })
        : [];

    const existingByCodes =
      providedCodes.length > 0
        ? await Property.find({
            propertyCode: { $in: providedCodes },
            business: businessId,
          })
        : [];

    const existingLRNumbers = new Set(existingByLR.map((p) => p.lrNumber));
    const existingPropertyCodes = new Set(existingByCodes.map((p) => p.propertyCode));

    const allProperties = await Property.find({ business: businessId }).select("propertyCode");
    let maxCodeNumber = 0;

    allProperties.forEach((prop) => {
      if (prop.propertyCode && prop.propertyCode.startsWith("PRO")) {
        const num = parseInt(prop.propertyCode.substring(3), 10);
        if (!Number.isNaN(num) && num > maxCodeNumber) {
          maxCodeNumber = num;
        }
      }
    });

    const results = {
      successful: [],
      failed: [],
      totalProcessed: 0,
    };

    const seenCodesInBatch = new Set();
    const seenLRInBatch = new Set();

    for (const property of normalizedProperties) {
      results.totalProcessed++;
      const errors = [];

      if (!property.propertyName) {
        errors.push("Property name is required");
      }

      if (!property.lrNumber) {
        errors.push("LR Number is required");
      }

      if (property.lrNumber) {
        if (existingLRNumbers.has(property.lrNumber) || seenLRInBatch.has(property.lrNumber)) {
          errors.push(`LR Number already exists: ${property.lrNumber}`);
        }
        seenLRInBatch.add(property.lrNumber);
      }

      if (property.propertyCode) {
        if (
          existingPropertyCodes.has(property.propertyCode) ||
          seenCodesInBatch.has(property.propertyCode)
        ) {
          errors.push(`Property Code already exists: ${property.propertyCode}`);
        }
        seenCodesInBatch.add(property.propertyCode);
      }

      if (errors.length > 0) {
        results.failed.push({
          propertyName: property.propertyName || "",
          error: errors.join("; "),
        });
        continue;
      }

      try {
        let generatedPropertyCode = property.propertyCode;

        if (!generatedPropertyCode) {
          let counter = maxCodeNumber + 1;
          generatedPropertyCode = `PRO${String(counter).padStart(3, "0")}`;

          while (
            existingPropertyCodes.has(generatedPropertyCode) ||
            seenCodesInBatch.has(generatedPropertyCode)
          ) {
            counter++;
            generatedPropertyCode = `PRO${String(counter).padStart(3, "0")}`;
          }

          maxCodeNumber = counter;
        }

        seenCodesInBatch.add(generatedPropertyCode);

        const createdById =
          req.user?.id || req.user?._id
            ? mongoose.Types.ObjectId.isValid(req.user?.id || req.user?._id)
              ? req.user?.id || req.user?._id
              : undefined
            : undefined;

        const newProperty = new Property({
          propertyCode: generatedPropertyCode,
          propertyName: property.propertyName,
          lrNumber: property.lrNumber,
          propertyType: property.propertyType || "Residential",
          category: property.category,
          townCityState: property.townCityState,
          estateArea: property.estateArea,
          roadStreet: property.roadStreet,
          zoneRegion: property.zoneRegion,
          totalUnits: property.totalUnits || 0,
          country: property.country || "Kenya",
          status: property.status || "active",
          business: businessId,
          createdBy: createdById,
          updatedBy: createdById,
          landlords: property.landlordName
            ? [
                {
                  landlordId: null,
                  name: property.landlordName,
                  isPrimary: true,
                },
              ]
            : [],
        });

        const savedProperty = await newProperty.save();

        try {
          const controlAccount = await ensurePropertyControlAccount({
            businessId,
            propertyId: savedProperty._id,
            propertyCode: savedProperty.propertyCode,
            propertyName: savedProperty.propertyName,
          });

          if (
            controlAccount?._id &&
            String(savedProperty.controlAccount || "") !== String(controlAccount._id)
          ) {
            savedProperty.controlAccount = controlAccount._id;
            await savedProperty.save();
          }
        } catch (accountingError) {
          await Property.findByIdAndDelete(savedProperty._id);
          throw new Error(`Property control account creation failed: ${accountingError.message}`);
        }

        results.successful.push({
          propertyName: property.propertyName,
          code: generatedPropertyCode,
        });
      } catch (error) {
        results.failed.push({
          propertyName: property.propertyName || "",
          error: error.message || "Failed to create property",
        });
      }
    }

    res.status(200).json({
      success: true,
      ...results,
    });
  } catch (err) {
    next(err);
  }
};