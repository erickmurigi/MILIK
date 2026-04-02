import crypto from "crypto";
import mongoose from "mongoose";
import User from "../models/User.js";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const env = (name, fallback = "") => String(process.env[name] || fallback).trim();

export const isSystemAdminActor = (user = {}) =>
  Boolean(user?.isSystemAdmin || user?.superAdminAccess);

const buildSystemAuditEmail = (businessId) =>
  `system.admin+${String(businessId)}@milik.local`.toLowerCase();

const buildSystemAuditIdentity = (businessId) => {
  const adminName = env("MILIK_ADMIN_NAME", "Milik").trim() || "Milik";
  const nameParts = adminName.split(/\s+/).filter(Boolean);
  const surname = nameParts.shift() || "Milik";
  const otherNames = [...nameParts, "System Admin"].join(" ").trim() || "System Admin";
  const shortId = String(businessId).replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase() || "SYSTEM";

  return {
    surname,
    otherNames,
    idNumber: `SYSADMIN-${shortId}`,
    gender: "Other",
    postalAddress: "MILIK system audit actor",
    phoneNumber: "+254700000000",
    email: buildSystemAuditEmail(businessId),
    profile: "Administrator",
    userControl: false,
    superAdminAccess: false,
    adminAccess: true,
    setupAccess: false,
    companySetupAccess: false,
    moduleAccess: {
      propertyMgmt: "Full access",
      propertySale: "Not allowed",
      facilityManagement: "Not allowed",
      hotelManagement: "Not allowed",
      accounts: "Full access",
      revenueRecognition: "Not allowed",
      telcoDealership: "Not allowed",
      inventory: "Not allowed",
      retailOutlet: "",
      procurement: "Not allowed",
      humanResource: "Not allowed",
      hidePayDetails: false,
      incidentManagement: "Not allowed",
      sacco: "Not allowed",
      projectManagement: "Not allowed",
      assetValuation: "Not allowed",
      crm: "Not allowed",
      dms: "Not allowed",
      academics: "Not allowed",
    },
    rights: [],
    permissions: {},
    company: businessId,
    primaryCompany: businessId,
    accessibleCompanies: [businessId],
    companyAssignments: [{
      company: businessId,
      moduleAccess: {},
      permissions: {},
      rights: [],
    }],
    password: crypto.randomBytes(24).toString("hex"),
    mustChangePassword: false,
    passwordProvisioningMethod: "manual",
    isActive: true,
    locked: true,
    isSystemAuditUser: true,
  };
};

export async function ensureSystemAuditUser(businessId) {
  if (!isValidObjectId(businessId)) {
    throw new Error("Unable to resolve system audit actor because business context is invalid.");
  }

  const normalizedBusinessId = String(businessId);
  const existing = await User.findOne({
    company: normalizedBusinessId,
    isSystemAuditUser: true,
  })
    .select("_id isActive locked company")
    .lean();

  if (existing?._id) {
    if (existing.isActive === false || existing.locked !== true) {
      await User.updateOne(
        { _id: existing._id },
        { $set: { isActive: true, locked: true, userControl: false, isSystemAuditUser: true } }
      );
    }
    return existing;
  }

  const payload = buildSystemAuditIdentity(normalizedBusinessId);
  const created = await User.create(payload);
  return User.findById(created._id).select("_id company").lean();
}

export async function resolveAuditActorUserId({
  req,
  businessId,
  candidateUserIds = [],
  fallbackToCompanyUser = true,
  fallbackErrorMessage = "No valid company user could be resolved for this action.",
}) {
  const candidates = [
    ...candidateUserIds,
    req?.user?.id,
    req?.user?._id,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!isValidObjectId(candidate)) continue;

    const existingUser = await User.findById(candidate)
      .select("_id company isActive isSystemAuditUser")
      .lean();

    if (!existingUser || existingUser.isActive === false) continue;
    return String(existingUser._id);
  }

  if (isSystemAdminActor(req?.user)) {
    const systemAuditUser = await ensureSystemAuditUser(businessId);
    if (systemAuditUser?._id) {
      return String(systemAuditUser._id);
    }
  }

  if (!fallbackToCompanyUser) {
    throw new Error(fallbackErrorMessage);
  }

  if (!isValidObjectId(businessId)) {
    throw new Error("Unable to resolve acting user because business context is missing or invalid.");
  }

  const companyAdmin = await User.findOne({
    company: businessId,
    isActive: true,
    isSystemAuditUser: { $ne: true },
    $or: [{ adminAccess: true }, { superAdminAccess: true }],
  })
    .sort({ superAdminAccess: -1, adminAccess: -1, createdAt: 1 })
    .select("_id company")
    .lean();

  if (companyAdmin?._id) {
    return String(companyAdmin._id);
  }

  const anyActiveCompanyUser = await User.findOne({
    company: businessId,
    isActive: true,
    isSystemAuditUser: { $ne: true },
  })
    .sort({ createdAt: 1 })
    .select("_id company")
    .lean();

  if (anyActiveCompanyUser?._id) {
    return String(anyActiveCompanyUser._id);
  }

  throw new Error(fallbackErrorMessage);
}
