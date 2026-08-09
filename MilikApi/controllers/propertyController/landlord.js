import mongoose from "mongoose";
import { escapeRegex } from "../../utils/escapeRegex.js";
import Landlord from "../../models/Landlord.js";
import Property from "../../models/Property.js";
import ProcessedStatement from "../../models/ProcessedStatement.js";
import Unit from "../../models/Unit.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";

// Resolve company context safely
const resolveCompanyId = (req) => {
  if (req.user?.isSystemAdmin && (req.body?.company || req.query?.company)) {
    return req.body?.company || req.query?.company;
  }
  return req.user?.company || null;
};

// Generate unique landlord code within a company
const generateLandlordCode = async (companyId) => {
  const result = await Landlord.aggregate([
    { $match: { company: new mongoose.Types.ObjectId(String(companyId)), landlordCode: { $regex: /^LL\d+$/ } } },
    { $addFields: { codeNum: { $toInt: { $substr: ["$landlordCode", 2, -1] } } } },
    { $group: { _id: null, maxNum: { $max: "$codeNum" } } },
  ]);
  const next = (result[0]?.maxNum ?? 0) + 1;
  return `LL${String(next).padStart(3, "0")}`;
};

const normalizeString = (value) => (typeof value === "string" ? value.trim() : value);

const normalizeEmail = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : value;

// Returns true if a value is a placeholder that should be treated as absent.
// Covers "-", "--", "n/a", "none", empty string, null, undefined.
const isPlaceholder = (value) => {
  if (value === null || value === undefined) return true;
  const s = String(value).trim().toLowerCase();
  return s === "" || s === "-" || s === "--" || s === "n/a" || s === "na" || s === "none";
};

// Normalise an import field: if the trimmed value is a placeholder, return null.
// For email, also lowercase.
const normalizeImportField = (value) => {
  const trimmed = typeof value === "string" ? value.trim() : value;
  if (isPlaceholder(trimmed)) return null;
  return trimmed;
};

const normalizeImportEmail = (value) => {
  const trimmed = typeof value === "string" ? value.trim().toLowerCase() : value;
  if (isPlaceholder(trimmed)) return null;
  return trimmed;
};

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

const syncLinkedPropertyLandlordSnapshots = async ({
  companyId,
  landlordId,
  previousName,
  nextName,
  nextContact,
}) => {
  if (!companyId || !landlordId) return;

  await Property.updateMany(
    { business: companyId, "landlords.landlordId": landlordId },
    { $set: { "landlords.$[entry].name": nextName, "landlords.$[entry].contact": nextContact, "landlords.$[entry].landlordId": landlordId } },
    { arrayFilters: [{ "entry.landlordId": landlordId }] }
  );

  if (previousName) {
    await Property.updateMany(
      { business: companyId, "landlords.name": previousName, "landlords.landlordId": { $exists: false } },
      { $set: { "landlords.$[entry].name": nextName, "landlords.$[entry].contact": nextContact, "landlords.$[entry].landlordId": landlordId } },
      { arrayFilters: [{ "entry.name": previousName, "entry.landlordId": { $exists: false } }] }
    );
  }
};

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

    const regIdValue = isPlaceholder(req.body.regId) ? null : normalizeString(req.body.regId);
    const idNumberValue = isPlaceholder(req.body.idNumber) ? null : (normalizeString(req.body.idNumber) || regIdValue);
    const emailValue = isPlaceholder(req.body.email) ? null : normalizeEmail(req.body.email);
    const taxPinValue = isPlaceholder(req.body.taxPin) ? null : normalizeString(req.body.taxPin);
    const landlordNameValue = normalizeString(req.body.landlordName);
    const landlordTypeValue = normalizeString(req.body.landlordType) || "Individual";
    const phoneNumberValue = isPlaceholder(req.body.phoneNumber) ? null : normalizeString(req.body.phoneNumber);
    const postalAddressValue = normalizeString(req.body.postalAddress) || "";
    const locationValue = normalizeString(req.body.location) || "";
    const statusValue = normalizeString(req.body.status) || "Active";
    const portalAccessValue = normalizeString(req.body.portalAccess) || "Disabled";

    if (!landlordNameValue) {
      return res.status(400).json({
        success: false,
        message: "Landlord name is required",
      });
    }

    let landlordCode = normalizeString(req.body.landlordCode);
    if (!landlordCode) {
      landlordCode = await generateLandlordCode(companyId);
    }

    const duplicateQuery = {
      company: companyId,
      $or: [{ landlordCode }],
    };

    // Only check real (non-placeholder) values for uniqueness
    if (regIdValue) duplicateQuery.$or.push({ regId: regIdValue });
    if (idNumberValue) duplicateQuery.$or.push({ idNumber: idNumberValue });
    if (emailValue) duplicateQuery.$or.push({ email: emailValue });

    const [existingLandlord, createdById] = await Promise.all([
      Landlord.findOne(duplicateQuery).lean(),
      resolveAuditActorUserId({
        req,
        businessId: companyId,
        fallbackErrorMessage: "No valid company user could be resolved for landlord creation.",
      }),
    ]);

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

    const newLandlord = new Landlord({
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
    const { search: rawSearch, status, portal, location, page = 1, limit = 100 } = req.query;
    const search = escapeRegex(rawSearch);
    const companyId = resolveCompanyId(req);

    const query = {};
    if (companyId) query.company = companyId;
    if (status) query.status = status;

    if (portal && ["Enabled", "Disabled"].includes(portal)) {
      query.portalAccess = portal;
    }

    if (location && location.trim()) {
      query.location = { $regex: escapeRegex(location), $options: "i" };
    }

    if (search) {
      query.$or = [
        { landlordName: { $regex: search, $options: "i" } },
        { landlordCode: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phoneNumber: { $regex: search, $options: "i" } },
        { regId: { $regex: search, $options: "i" } },
        { taxPin: { $regex: search, $options: "i" } },
      ];
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);

    const [landlords, total] = await Promise.all([
      Landlord.find(query)
        .populate("company", "companyName")
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      Landlord.countDocuments(query),
    ]);

    if (!landlords.length) {
      return res.status(200).json({ success: true, data: [], total, page: pageNum, pages: Math.ceil(total / limitNum) });
    }

    const businessId = new mongoose.Types.ObjectId(
      String(companyId || landlords[0]?.company?._id || landlords[0]?.company)
    );
    const landlordIds = landlords.map((l) => l._id);

    const landlordById = new Map(landlords.map((l) => [String(l._id), l]));
    const landlordByName = new Map(
      landlords.flatMap((l) => (l.landlordName ? [[l.landlordName, l]] : []))
    );

    const baseMatch = { business: businessId, landlord: { $in: landlordIds } };

    const [allProperties, statementRows] = await Promise.all([
      Property.find({ business: businessId }).select("landlords status").limit(2000).lean(),
      ProcessedStatement.aggregate([
        {
          $match: {
            ...baseMatch,
            status: { $ne: "reversed" },
            isNegativeStatement: { $ne: true },
            balanceDue: { $gt: 0 },
          },
        },
        { $group: { _id: "$landlord", balance: { $sum: "$balanceDue" } } },
      ]),
    ]);

    const activeCounts = new Map();
    const archivedCounts = new Map();

    for (const prop of allProperties) {
      const seen = new Set();
      for (const entry of prop.landlords || []) {
        let matched = entry.landlordId ? landlordById.get(String(entry.landlordId)) : null;
        if (!matched && entry.name) matched = landlordByName.get(entry.name);
        if (!matched) continue;
        const lid = String(matched._id);
        if (seen.has(lid)) continue;
        seen.add(lid);
        const map = prop.status === "archived" ? archivedCounts : activeCounts;
        map.set(lid, (map.get(lid) || 0) + 1);
      }
    }

    const balanceByLandlord = new Map(statementRows.map((r) => [String(r._id), Number(r.balance || 0)]));

    const landlordsWithCounts = landlords.map((landlord) => {
      const lid = String(landlord._id);
      return {
        ...landlord,
        activeProperties: activeCounts.get(lid) || 0,
        archivedProperties: archivedCounts.get(lid) || 0,
        balance: balanceByLandlord.get(lid) || 0,
      };
    });

    return res.status(200).json({
      success: true,
      data: landlordsWithCounts,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    console.error("Get landlords error:", err);
    return res.status(500).json({
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
      .populate("createdBy", "surname otherNames email")
      .lean();

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
    const existingLandlord = await Landlord.findById(req.params.id).lean();

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
      updateData.regId = isPlaceholder(updateData.regId) ? null : normalizeString(updateData.regId);
      updateData.idNumber = updateData.regId;
    } else if (updateData.idNumber !== undefined) {
      updateData.idNumber = isPlaceholder(updateData.idNumber) ? null : normalizeString(updateData.idNumber);
    }

    if (updateData.email !== undefined) {
      updateData.email = isPlaceholder(updateData.email) ? null : normalizeEmail(updateData.email);
    }

    if (updateData.landlordName !== undefined) {
      updateData.landlordName = normalizeString(updateData.landlordName);
    }

    if (updateData.landlordType !== undefined) {
      updateData.landlordType = normalizeString(updateData.landlordType);
    }

    if (updateData.taxPin !== undefined) {
      updateData.taxPin = isPlaceholder(updateData.taxPin) ? null : normalizeString(updateData.taxPin);
    }

    if (updateData.phoneNumber !== undefined) {
      updateData.phoneNumber = isPlaceholder(updateData.phoneNumber) ? null : normalizeString(updateData.phoneNumber);
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

    const previousLandlordName = existingLandlord.landlordName;
    const updatedLandlord = await Landlord.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate("company", "companyName").lean();

    if (
      updatedLandlord &&
      (
        updateData.landlordName !== undefined ||
        updateData.email !== undefined ||
        updateData.phoneNumber !== undefined
      )
    ) {
      await syncLinkedPropertyLandlordSnapshots({
        companyId: existingLandlord.company,
        landlordId: updatedLandlord._id,
        previousName: previousLandlordName,
        nextName: updatedLandlord.landlordName,
        nextContact: updatedLandlord.email || updatedLandlord.phoneNumber || "",
      });
    }

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
    const landlord = await Landlord.findById(landlordId).lean();

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
    const landlord = await Landlord.findById(landlordId).lean();

    const access = authorizeLandlordAccess(req, landlord);
    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    const propertyQuery = buildLandlordPropertyMatch(landlord);

    const properties = await Property.find(propertyQuery).select("_id status").limit(2000).lean();
    const propertyIds = properties.map((p) => p._id);

    const totalProperties = properties.length;
    const activeProperties = properties.filter((p) => p.status !== "archived").length;
    const archivedProperties = properties.filter((p) => p.status === "archived").length;

    const unitBaseQuery = {
      business: landlord.company,
      property: { $in: propertyIds },
    };

    const [totalUnits, occupiedUnits, vacantUnits] = propertyIds.length
      ? await Promise.all([
          Unit.countDocuments(unitBaseQuery),
          Unit.countDocuments({ ...unitBaseQuery, status: "occupied" }),
          Unit.countDocuments({ ...unitBaseQuery, status: "vacant" }),
        ])
      : [0, 0, 0];

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

    const normalizedLandlords = landlords.map((item) => {
      const regIdRaw = normalizeImportField(item.regId);
      const idNumberRaw = normalizeImportField(item.idNumber) || regIdRaw;
      return {
        landlordName: normalizeString(item.landlordName),
        landlordType: normalizeString(item.landlordType) || "Individual",
        regId: regIdRaw,
        idNumber: idNumberRaw,
        taxPin: normalizeImportField(item.taxPin),
        email: normalizeImportEmail(item.email),
        phoneNumber: normalizeImportField(item.phoneNumber),
        postalAddress: normalizeString(item.postalAddress) || "",
        location: normalizeString(item.location) || "",
        status: normalizeString(item.status) || "Active",
        portalAccess: normalizeString(item.portalAccess) || "Disabled",
      };
    });

    // Only query the DB for real (non-placeholder) values to detect duplicates.
    const emails = normalizedLandlords.map((l) => l.email).filter(Boolean);
    const regIds = normalizedLandlords.map((l) => l.regId).filter(Boolean);
    const idNumbers = normalizedLandlords.map((l) => l.idNumber).filter(Boolean);

    const [existingLandlords, codeResult] = await Promise.all([
      Landlord.find({
        company: companyId,
        ...(emails.length || regIds.length || idNumbers.length
          ? {
              $or: [
                ...(emails.length ? [{ email: { $in: emails } }] : []),
                ...(regIds.length ? [{ regId: { $in: regIds } }] : []),
                ...(idNumbers.length ? [{ idNumber: { $in: idNumbers } }] : []),
              ],
            }
          : { _id: null }), // No real values to check — skip DB query result
      }).select("email regId idNumber landlordCode").lean(),
      Landlord.aggregate([
        { $match: { company: new mongoose.Types.ObjectId(String(companyId)), landlordCode: { $regex: /^LL\d+$/ } } },
        { $addFields: { codeNum: { $toInt: { $substr: ["$landlordCode", 2, -1] } } } },
        { $group: { _id: null, maxNum: { $max: "$codeNum" } } },
      ]),
    ]);

    const existingEmails = new Set(existingLandlords.map((l) => l.email).filter(Boolean));
    const existingRegIds = new Set(existingLandlords.map((l) => l.regId).filter(Boolean));
    const existingIdNumbers = new Set(existingLandlords.map((l) => l.idNumber).filter(Boolean));

    const results = {
      successful: [],
      failed: [],
      totalProcessed: 0,
    };
    let nextCodeNum = (codeResult[0]?.maxNum ?? 0) + 1;

    const toInsert = [];

    for (const landlordData of normalizedLandlords) {
      results.totalProcessed++;

      if (!landlordData.landlordName) {
        results.failed.push({
          landlord: landlordData.landlordName || "",
          error: "Landlord Name is required",
        });
        continue;
      }

      if (landlordData.email && existingEmails.has(landlordData.email)) {
        results.failed.push({
          landlord: landlordData.landlordName,
          error: `Email ${landlordData.email} already exists`,
        });
        continue;
      }

      if (
        (landlordData.regId && existingRegIds.has(landlordData.regId)) ||
        (landlordData.idNumber && existingIdNumbers.has(landlordData.idNumber))
      ) {
        results.failed.push({
          landlord: landlordData.landlordName,
          error: `Reg/ID Number ${landlordData.regId || landlordData.idNumber} already exists`,
        });
        continue;
      }

      const landlordCode = `LL${String(nextCodeNum++).padStart(3, "0")}`;

      // Track in sets so within-batch duplicates are caught on subsequent rows
      if (landlordData.email) existingEmails.add(landlordData.email);
      if (landlordData.regId) existingRegIds.add(landlordData.regId);
      if (landlordData.idNumber) existingIdNumbers.add(landlordData.idNumber);

      toInsert.push({
        landlordCode,
        landlordName: landlordData.landlordName,
        landlordType: landlordData.landlordType,
        regId: landlordData.regId,
        idNumber: landlordData.idNumber,
        taxPin: landlordData.taxPin,
        email: landlordData.email || "",
        phoneNumber: landlordData.phoneNumber,
        postalAddress: landlordData.postalAddress,
        location: landlordData.location,
        status: landlordData.status,
        portalAccess: landlordData.portalAccess,
        company: companyId,
        createdBy: createdById,
      });
    }

    if (toInsert.length > 0) {
      try {
        const inserted = await Landlord.insertMany(toInsert, { ordered: false });
        results.successful = inserted.map((doc) => ({ landlord: doc.landlordName, code: doc.landlordCode }));
      } catch (bulkErr) {
        const writeErrors = bulkErr.writeErrors || [];
        const failedIndexes = new Map(writeErrors.map((e) => [e.index, e.errmsg || e.message || "Insert failed"]));
        toInsert.forEach((doc, idx) => {
          if (failedIndexes.has(idx)) {
            results.failed.push({ landlord: doc.landlordName, error: failedIndexes.get(idx) });
          } else {
            results.successful.push({ landlord: doc.landlordName, code: doc.landlordCode });
          }
        });
      }
    }

    // Fix 2: Accurately reflect overall success/failure in the response.
    // success=false when ALL rows failed; success=true otherwise (including partial).
    const allFailed = results.successful.length === 0 && results.failed.length > 0;
    res.status(200).json({
      success: !allFailed,
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
