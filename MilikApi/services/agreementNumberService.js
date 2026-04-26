import Lease from "../models/Lease.js";

const AGREEMENT_NUMBER_PREFIX = "AGR";

const escapeRegExp = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeBusinessId = (businessId) => {
  if (!businessId) return "";
  if (typeof businessId === "object" && businessId._id) return String(businessId._id);
  return String(businessId);
};

const buildYearMonth = (dateValue = new Date()) => {
  const date = new Date(dateValue);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return `${safeDate.getFullYear()}${String(safeDate.getMonth() + 1).padStart(2, "0")}`;
};

export const buildAgreementNumberPrefix = (dateValue = new Date()) =>
  `${AGREEMENT_NUMBER_PREFIX}-${buildYearMonth(dateValue)}-`;

export const generateAgreementNumber = async (businessId, { dateValue = new Date() } = {}) => {
  const normalizedBusinessId = normalizeBusinessId(businessId);
  if (!normalizedBusinessId) {
    const error = new Error("Business context is required to generate an agreement number.");
    error.statusCode = 400;
    throw error;
  }

  const prefix = buildAgreementNumberPrefix(dateValue);
  const prefixRegex = new RegExp(`^${escapeRegExp(prefix)}\\d+$`);

  const latestLease = await Lease.findOne({
    business: normalizedBusinessId,
    agreementNumber: { $regex: prefixRegex },
  })
    .sort({ agreementNumber: -1, createdAt: -1 })
    .select("agreementNumber")
    .lean();

  const lastSequence = latestLease?.agreementNumber
    ? Number(String(latestLease.agreementNumber).split("-").pop()) || 0
    : 0;

  return `${prefix}${String(lastSequence + 1).padStart(4, "0")}`;
};

export const isAgreementNumberDuplicateError = (error = {}) => {
  if (error?.code !== 11000) return false;

  const keyPattern = error.keyPattern || {};
  const keyValue = error.keyValue || {};

  return Boolean(
    Object.prototype.hasOwnProperty.call(keyPattern, "agreementNumber") ||
      Object.prototype.hasOwnProperty.call(keyValue, "agreementNumber") ||
      String(error.message || "").includes("agreementNumber")
  );
};

export const saveLeaseWithUniqueAgreementNumber = async (
  leaseDoc,
  { businessId = null, maxAttempts = 5, dateValue = new Date() } = {}
) => {
  if (!leaseDoc) {
    const error = new Error("Lease record is required before saving an agreement.");
    error.statusCode = 400;
    throw error;
  }

  const resolvedBusinessId = normalizeBusinessId(businessId || leaseDoc.business);
  if (!resolvedBusinessId) {
    const error = new Error("Business context is required before saving an agreement.");
    error.statusCode = 400;
    throw error;
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (!String(leaseDoc.agreementNumber || "").trim()) {
      leaseDoc.agreementNumber = await generateAgreementNumber(resolvedBusinessId, { dateValue });
    }

    try {
      return await leaseDoc.save();
    } catch (error) {
      if (!isAgreementNumberDuplicateError(error) || attempt >= maxAttempts) {
        throw error;
      }

      leaseDoc.agreementNumber = "";
    }
  }

  const error = new Error("Tenant could not be created because the lease agreement number already exists. Please try again.");
  error.statusCode = 409;
  throw error;
};
