import mongoose from "mongoose";
import Landlord from "../../models/Landlord.js";
import Property from "../../models/Property.js";
import Unit from "../../models/Unit.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";

// Resolve company context safely
const resolveCompanyId = (req) => {
  if (req.user?.isSystemAdmin && (req.body?.company || req.query?.company)) {
    return req.body?.company || req.query?.company;
  }
  return req.user?.company || req.body?.company || req.query?.company || null;
};

// Generate unique landlord code within a company
const generateLandlordCode = async (companyId) => {
  let code;
  let exists = true;
  let counter = 1;

  while (exists) {
    code = `LL${String(counter).padStart(3, "0")}`;
    exists = await Landlord.findOne({ company: companyId, landlordCode: code }).lean();
    counter++;

    if (counter > 10000) {
      throw new Error("Unable to generate unique landlord code");
    }
  }

  return code;
};

const normalizeString = (value) => (typeof value === "string" ? value.trim() : value);

const normalizeEmail = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : value;

const authorizeLandlordAccess = (req, landlord) => {
  if (!landlord) {
    return { allowed: false, status: 404, message: "Landlord not found" };
  }

  if (req.user?.isSystemAdmin) {
    return { allowed: true };
  }

  const companyId = resolveCompanyId(req);
  if (!companyId || String(landlord.company) !== String(companyId)) {
    return {
      allowed: false,
      status: 403,
      message: "Not authorized to access this landlord",
    };
  }

  return { allowed: true };
};

const buildLandlordPropertyMatch = (landlord) => ({
  business: landlord.company,
  $or: [
    { "landlords.landlordId": landlord._id },
    { "landlords.name": landlord.landlordName },
  ],
});

// Create landlord
export const createLandlord = async (req, res, next) => {
  try {
    const companyId = resolveCompanyId(req);

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message:
          "Company context is required. Please ensure you are logged in with a company account.",
      });
    }

    const regIdValue = normalizeString(req.body.regId);
    const idNumberValue = normalizeString(req.body.idNumber) || regIdValue;
    const emailValue = normalizeEmail(req.body.email);
    const taxPinValue = normalizeString(req.body.taxPin);
    const landlordNameValue = normalizeString(req.body.landlordName);
    const landlordTypeValue = normalizeString(req.body.landlordType) || "Individual";
    const phoneNumberValue = normalizeString(req.body.phoneNumber);
    const postalAddressValue = normalizeString(req.body.postalAddress) || "";
    const locationValue = normalizeString(req.body.location) || "";
    const statusValue = normalizeString(req.body.status) || "Active";
    const portalAccessValue = normalizeString(req.body.portalAccess) || "Disabled";

    if (!landlordNameValue || !regIdValue || !taxPinValue || !emailValue || !phoneNumberValue) {
      return res.status(400).json({
        success: false,
        message: "Landlord name, Reg/ID, Tax PIN, Email, and Phone Number are required",
      });
    }

    let landlordCode = normalizeString(req.body.landlordCode);
    if (!landlordCode) {
      landlordCode = await generateLandlordCode(companyId);
    }

    const duplicateQuery = {
      company: companyId,
      $or: [
        { landlordCode },
        { regId: regIdValue },
        { idNumber: idNumberValue },
      ],
    };

    if (emailValue) {
      duplicateQuery.$or.push({ email: emailValue });
    }

    const existingLandlord = await Landlord.findOne(duplicateQuery).lean();

    if (existingLandlord) {
      if (existingLandlord.landlordCode === landlordCode) {
        return res.status(400).json({
          success: false,
          message: "Landlord code already exists. Please use a different code.",
        });
      }

      if (
        existingLandlord.regId === regIdValue ||
        existingLandlord.idNumber === idNumberValue
      ) {
        return res.status(400).json({
          success: false,
          message: "Reg/ID number already exists. Please use a different Reg/ID number.",
        });
      }

      if (existingLandlord.email === emailValue) {
        return res.status(400).json({
          success: false,
          message: "Email already exists. Please use a different email.",
        });
      }
    }

    const createdById = await resolveAuditActorUserId({
      req,
      businessId: companyId,
      fallbackErrorMessage: "No valid company user could be resolved for landlord creation.",
    });

    const newLandlord = new Landlord({
      ...req.body,
      landlordCode,
      landlordName: landlordNameValue,
      landlordType: landlordTypeValue,
      regId: regIdValue,
      idNumber: idNumberValue,
      taxPin: taxPinValue,
      email: emailValue,
      phoneNumber: phoneNumberValue,
      postalAddress: postalAddressValue,
      location: locationValue,
      status: statusValue,
      portalAccess: portalAccessValue,
      company: companyId,
      createdBy: createdById,
    });

    const savedLandlord = await newLandlord.save();

    res.status(201).json({
      success: true,
      data: savedLandlord,
      message: "Landlord created successfully",
    });
  } catch (err) {
    console.error("Create landlord error:", err);

    if (err?.code === 11000) {
      const duplicateField = Object.keys(err.keyPattern || {})[0] || "field";

      if (duplicateField === "landlordCode") {
        return res.status(400).json({
          success: false,
          message: "Landlord code already exists. Please use a different code.",
        });
      }

      if (duplicateField === "idNumber" || duplicateField === "regId") {
        return res.status(400).json({
          success: false,
          message: "Reg/ID number already exists. Please use a different Reg/ID number.",
        });
      }

      if (duplicateField === "email") {
        return res.status(400).json({
          success: false,
          message: "Email already exists. Please use a different email.",
        });
      }

      return res.status(400).json({
        success: false,
        message: `Duplicate value for ${duplicateField}. Please use a different value.`,
      });
    }

    if (err?.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: Object.values(err.errors)
          .map((e) => e.message)
          .join("; "),
      });
    }

    res.status(500).json({
      success: false,
      message: err.message || "Error creating landlord",
      error: err,
    });
  }
};

// Get all landlords
export const getLandlords = async (req, res, next) => {
  try {
    const { search, status } = req.query;
    const companyId = resolveCompanyId(req);

    const query = {};
    if (companyId) query.company = companyId;
    if (status) query.status = status;

    if (search) {
      query.$or = [
        { landlordName: { $regex: search, $options: "i" } },
        { landlordCode: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phoneNumber: { $regex: search, $options: "i" } },
        { regId: { $regex: search, $options: "i" } },
      ];
    }

    const landlords = await Landlord.find(query)
      .populate("company", "companyName")
      .sort({ createdAt: -1 });

    const landlordsWithCounts = await Promise.all(
      landlords.map(async (landlord) => {
        const propertyMatch = buildLandlordPropertyMatch(landlord);

        const activeProperties = await Property.countDocuments({
          ...propertyMatch,
          status: { $ne: "archived" },
        });

        const archivedProperties = await Property.countDocuments({
          ...propertyMatch,
          status: "archived",
        });

        return {
          ...landlord.toObject(),
          activeProperties,
          archivedProperties,
        };
      })
    );

    res.status(200).json({
      success: true,
      data: landlordsWithCounts,
      count: landlordsWithCounts.length,
    });
  } catch (err) {
    console.error("Get landlords error:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Error fetching landlords",
      error: err,
    });
  }
};

// Get single landlord
export const getLandlord = async (req, res, next) => {
  try {
    const landlord = await Landlord.findById(req.params.id)
      .populate("company", "companyName")
      .populate("createdBy", "surname otherNames email");

    const access = authorizeLandlordAccess(req, landlord);
    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    res.status(200).json({
      success: true,
      data: landlord,
    });
  } catch (err) {
    console.error("Get single landlord error:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Error fetching landlord",
      error: err,
    });
  }
};

// Update landlord
export const updateLandlord = async (req, res, next) => {
  try {
    const existingLandlord = await Landlord.findById(req.params.id);

    const access = authorizeLandlordAccess(req, existingLandlord);
    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message.replace("access", "update"),
      });
    }

    const {
      landlordCode,
      company,
      createdBy,
      _id,
      createdAt,
      updatedAt,
      ...updateData
    } = req.body;

    if (updateData.regId !== undefined) {
      updateData.regId = normalizeString(updateData.regId);
      updateData.idNumber = updateData.regId;
    } else if (updateData.idNumber !== undefined) {
      updateData.idNumber = normalizeString(updateData.idNumber);
    }

    if (updateData.email !== undefined) {
      updateData.email = normalizeEmail(updateData.email);
    }

    if (updateData.landlordName !== undefined) {
      updateData.landlordName = normalizeString(updateData.landlordName);
    }

    if (updateData.landlordType !== undefined) {
      updateData.landlordType = normalizeString(updateData.landlordType);
    }

    if (updateData.taxPin !== undefined) {
      updateData.taxPin = normalizeString(updateData.taxPin);
    }

    if (updateData.phoneNumber !== undefined) {
      updateData.phoneNumber = normalizeString(updateData.phoneNumber);
    }

    if (updateData.postalAddress !== undefined) {
      updateData.postalAddress = normalizeString(updateData.postalAddress);
    }

    if (updateData.location !== undefined) {
      updateData.location = normalizeString(updateData.location);
    }

    if (updateData.status !== undefined) {
      updateData.status = normalizeString(updateData.status);
    }

    if (updateData.portalAccess !== undefined) {
      updateData.portalAccess = normalizeString(updateData.portalAccess);
    }

    const duplicateQuery = {
      company: existingLandlord.company,
      _id: { $ne: existingLandlord._id },
      $or: [],
    };

    if (updateData.regId) duplicateQuery.$or.push({ regId: updateData.regId });
    if (updateData.idNumber) duplicateQuery.$or.push({ idNumber: updateData.idNumber });
    if (updateData.email) duplicateQuery.$or.push({ email: updateData.email });

    if (duplicateQuery.$or.length > 0) {
      const duplicate = await Landlord.findOne(duplicateQuery).lean();

      if (duplicate) {
        if (
          (updateData.regId && duplicate.regId === updateData.regId) ||
          (updateData.idNumber && duplicate.idNumber === updateData.idNumber)
        ) {
          return res.status(400).json({
            success: false,
            message: "Reg/ID number already exists. Please use a different Reg/ID number.",
          });
        }

        if (updateData.email && duplicate.email === updateData.email) {
          return res.status(400).json({
            success: false,
            message: "Email already exists. Please use a different email.",
          });
        }
      }
    }

    const updatedLandlord = await Landlord.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate("company", "companyName");

    res.status(200).json({
      success: true,
      data: updatedLandlord,
      message: "Landlord updated successfully",
    });
  } catch (err) {
    console.error("Update landlord error:", err);

    if (err?.code === 11000) {
      const duplicateField = Object.keys(err.keyPattern || {})[0] || "field";

      if (duplicateField === "idNumber" || duplicateField === "regId") {
        return res.status(400).json({
          success: false,
          message: "Reg/ID number already exists. Please use a different Reg/ID number.",
        });
      }

      if (duplicateField === "email") {
        return res.status(400).json({
          success: false,
          message: "Email already exists. Please use a different email.",
        });
      }

      return res.status(400).json({
        success: false,
        message: `Duplicate value for ${duplicateField}. Please use a different value.`,
      });
    }

    if (err?.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: Object.values(err.errors)
          .map((e) => e.message)
          .join("; "),
      });
    }

    res.status(500).json({
      success: false,
      message: err.message || "Error updating landlord",
      error: err,
    });
  }
};

// Delete landlord
export const deleteLandlord = async (req, res, next) => {
  try {
    const landlordId = req.params.id;
    const landlord = await Landlord.findById(landlordId);

    const access = authorizeLandlordAccess(req, landlord);
    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message.replace("access", "delete"),
      });
    }

    const properties = await Property.countDocuments({
      business: landlord.company,
      $or: [
        { "landlords.landlordId": landlordId },
        { "landlords.name": landlord.landlordName },
      ],
    });

    if (properties > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete landlord with ${properties} existing properties`,
      });
    }

    const deletedLandlord = await Landlord.findOneAndDelete({
      _id: landlordId,
      company: landlord.company,
    });

    if (!deletedLandlord) {
      return res.status(404).json({
        success: false,
        message: "Landlord not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Landlord deleted successfully",
      data: deletedLandlord,
    });
  } catch (err) {
    console.error("Delete landlord error:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Error deleting landlord",
      error: err,
    });
  }
};

// Get landlord dashboard stats
export const getLandlordStats = async (req, res, next) => {
  try {
    const landlordId = req.params.id;
    const landlord = await Landlord.findById(landlordId);

    const access = authorizeLandlordAccess(req, landlord);
    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    const propertyQuery = buildLandlordPropertyMatch(landlord);

    const properties = await Property.find(propertyQuery).select("_id status");
    const propertyIds = properties.map((p) => p._id);

    const totalProperties = properties.length;
    const activeProperties = properties.filter((p) => p.status !== "archived").length;
    const archivedProperties = properties.filter((p) => p.status === "archived").length;

    const unitBaseQuery = {
      business: landlord.company,
      property: { $in: propertyIds },
    };

    const totalUnits = propertyIds.length
      ? await Unit.countDocuments(unitBaseQuery)
      : 0;

    const occupiedUnits = propertyIds.length
      ? await Unit.countDocuments({
          ...unitBaseQuery,
          status: "occupied",
        })
      : 0;

    const vacantUnits = propertyIds.length
      ? await Unit.countDocuments({
          ...unitBaseQuery,
          status: "vacant",
        })
      : 0;

    res.status(200).json({
      success: true,
      data: {
        totalProperties,
        activeProperties,
        archivedProperties,
        totalUnits,
        occupiedUnits,
        vacantUnits,
        occupancyRate:
          totalUnits > 0 ? Number(((occupiedUnits / totalUnits) * 100).toFixed(2)) : 0,
      },
    });
  } catch (err) {
    console.error("Get landlord stats error:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Error fetching landlord stats",
      error: err,
    });
  }
};

// Bulk import landlords from Excel
export const bulkImportLandlords = async (req, res, next) => {
  try {
    const { landlords } = req.body;
    const companyId = resolveCompanyId(req);

    if (!Array.isArray(landlords) || landlords.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No landlords provided for import",
      });
    }

    if (landlords.length > 1000) {
      return res.status(400).json({
        success: false,
        message: "Maximum 1000 landlords allowed per import",
      });
    }

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: "Company context is required",
      });
    }

    const createdById = await resolveAuditActorUserId({
      req,
      businessId: companyId,
      fallbackErrorMessage: "No valid company user could be resolved for landlord import.",
    });

    const normalizedLandlords = landlords.map((item) => ({
      landlordName: normalizeString(item.landlordName),
      landlordType: normalizeString(item.landlordType) || "Individual",
      regId: normalizeString(item.regId),
      idNumber: normalizeString(item.idNumber) || normalizeString(item.regId),
      taxPin: normalizeString(item.taxPin),
      email: normalizeEmail(item.email),
      phoneNumber: normalizeString(item.phoneNumber),
      postalAddress: normalizeString(item.postalAddress) || "",
      location: normalizeString(item.location) || "",
      status: normalizeString(item.status) || "Active",
      portalAccess: normalizeString(item.portalAccess) || "Disabled",
    }));

    const emails = normalizedLandlords.map((l) => l.email).filter(Boolean);
    const regIds = normalizedLandlords.map((l) => l.regId).filter(Boolean);
    const idNumbers = normalizedLandlords.map((l) => l.idNumber).filter(Boolean);

    const existingLandlords = await Landlord.find({
      company: companyId,
      $or: [
        ...(emails.length ? [{ email: { $in: emails } }] : []),
        ...(regIds.length ? [{ regId: { $in: regIds } }] : []),
        ...(idNumbers.length ? [{ idNumber: { $in: idNumbers } }] : []),
      ],
    }).select("email regId idNumber landlordCode");

    const existingEmails = new Set(existingLandlords.map((l) => l.email).filter(Boolean));
    const existingRegIds = new Set(existingLandlords.map((l) => l.regId).filter(Boolean));
    const existingIdNumbers = new Set(existingLandlords.map((l) => l.idNumber).filter(Boolean));

    const results = {
      successful: [],
      failed: [],
      totalProcessed: 0,
    };

    for (const landlordData of normalizedLandlords) {
      results.totalProcessed++;

      try {
        if (
          !landlordData.landlordName ||
          !landlordData.regId ||
          !landlordData.taxPin ||
          !landlordData.email ||
          !landlordData.phoneNumber
        ) {
          results.failed.push({
            landlord: landlordData.landlordName || "",
            error: "Landlord name, Reg/ID, Tax PIN, Email, and Phone Number are required",
          });
          continue;
        }

        if (existingEmails.has(landlordData.email)) {
          results.failed.push({
            landlord: landlordData.landlordName,
            error: `Email ${landlordData.email} already exists`,
          });
          continue;
        }

        if (
          existingRegIds.has(landlordData.regId) ||
          existingIdNumbers.has(landlordData.idNumber)
        ) {
          results.failed.push({
            landlord: landlordData.landlordName,
            error: `Reg/ID Number ${landlordData.regId} already exists`,
          });
          continue;
        }

        const landlordCode = await generateLandlordCode(companyId);

        const newLandlord = new Landlord({
          landlordCode,
          landlordName: landlordData.landlordName,
          landlordType: landlordData.landlordType,
          regId: landlordData.regId,
          idNumber: landlordData.idNumber,
          taxPin: landlordData.taxPin,
          email: landlordData.email,
          phoneNumber: landlordData.phoneNumber,
          postalAddress: landlordData.postalAddress,
          location: landlordData.location,
          status: landlordData.status,
          portalAccess: landlordData.portalAccess,
          company: companyId,
          createdBy: createdById,
        });

        await newLandlord.save();

        existingEmails.add(landlordData.email);
        existingRegIds.add(landlordData.regId);
        existingIdNumbers.add(landlordData.idNumber);

        results.successful.push({
          landlord: landlordData.landlordName,
          code: landlordCode,
        });
      } catch (error) {
        results.failed.push({
          landlord: landlordData.landlordName || "",
          error: error.message || "Unknown error",
        });
      }
    }

    res.status(200).json({
      success: true,
      message: `Import completed: ${results.successful.length} successful, ${results.failed.length} failed`,
      data: results,
    });
  } catch (err) {
    console.error("Bulk import error:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Error importing landlords",
      error: err,
    });
  }
};