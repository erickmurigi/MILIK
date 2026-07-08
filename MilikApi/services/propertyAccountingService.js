import mongoose from "mongoose";
import Property from "../models/Property.js";
import Landlord from "../models/Landlord.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import {
  ensureSystemChartOfAccounts,
  findSystemAccountByCode,
} from "./chartOfAccountsService.js";
import { resolveConfiguredAccountingDefaultAccount } from "./companyAccountingDefaultsService.js";

const normalizeObjectId = (value) => {
  if (!value) return null;

  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  if (value?._id) {
    return normalizeObjectId(value._id);
  }

  const stringValue = String(value || "").trim();
  if (!/^[a-fA-F0-9]{24}$/.test(stringValue)) {
    return null;
  }

  return new mongoose.Types.ObjectId(stringValue);
};

const isValidObjectId = (value) => Boolean(normalizeObjectId(value));

const escapeRegExp = (value = "") => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getPrimaryLandlordId = (propertyDoc) => {
  const landlords = Array.isArray(propertyDoc?.landlords) ? propertyDoc.landlords : [];
  const primary = landlords.find((item) => item?.isPrimary && item?.landlordId);
  const fallback = landlords.find((item) => item?.landlordId);
  return primary?.landlordId || fallback?.landlordId || null;
};

// Cached system account lookup (code → ObjectId) per business, 5-min TTL
const sysAccountCache = new Map();
const SYS_CACHE_TTL = 5 * 60 * 1000;

const getCachedSystemAccount = async (businessId, code) => {
  const key = `${businessId}:${code}`;
  const hit = sysAccountCache.get(key);
  if (hit && Date.now() - hit.at < SYS_CACHE_TTL) return hit.id;
  const acct = await ChartOfAccount.findOne({
    business: businessId,
    code,
    isPosting: true,
  }).select("_id").lean();
  const id = acct?._id || null;
  if (id) sysAccountCache.set(key, { id, at: Date.now() });
  return id;
};

export const resolvePropertyAccountingContext = async ({
  propertyId,
  landlordId = null,
  businessId = null,
} = {}) => {
  if (!propertyId || !isValidObjectId(propertyId)) {
    throw new Error("A valid propertyId is required to resolve property accounting context.");
  }

  const property = await Property.findOne({
    _id: propertyId,
    ...(businessId && isValidObjectId(businessId) ? { business: businessId } : {}),
  })
    .select("_id business propertyCode propertyName landlords controlAccount accountLedgerType propertyLedgerEnabled")
    .lean();

  if (!property) {
    throw new Error("Property not found while resolving accounting context.");
  }

  const resolvedBusinessId = businessId || property.business || null;
  if (businessId && String(property.business || "") !== String(businessId)) {
    throw new Error("Property does not belong to the supplied business.");
  }

  const resolvedLandlordId = landlordId || getPrimaryLandlordId(property) || null;

  if (!resolvedBusinessId) {
    throw new Error("Business context could not be resolved from the property.");
  }

  if (!resolvedLandlordId) {
    throw new Error("Property has no linked landlord. Posting cannot continue.");
  }

  const linkedLandlordIds = (Array.isArray(property.landlords) ? property.landlords : [])
    .map((item) => String(item?.landlordId || ""))
    .filter(Boolean);

  if (!linkedLandlordIds.includes(String(resolvedLandlordId))) {
    throw new Error("Selected landlord is not linked to the supplied property.");
  }

  const landlord = await Landlord.findOne({
    _id: resolvedLandlordId,
    company: resolvedBusinessId,
  })
    .select("_id company")
    .lean();

  if (!landlord) {
    throw new Error("Linked landlord was not found in the supplied business.");
  }

  const normalizedLedgerType = (() => {
    const v = String(property.accountLedgerType || "").toLowerCase().trim();
    if (v.startsWith("off") || v === "property-gl" || v === "property gl") return "property-gl";
    return "in-gl";
  })();
  // isPropertyGL: property has its own isolated ledger — never posts to main GL.
  // isPropertyLedgerActive: property-gl AND the ledger has been explicitly enabled
  //   (false = property-gl but ledger not yet activated, behaves like true off-gl / no posting).
  const isPropertyGL = normalizedLedgerType === "property-gl";
  const isPropertyLedgerActive = isPropertyGL && !!property.propertyLedgerEnabled;
  // Legacy alias kept so callers that still read isOffGL don't break during migration.
  const isOffGL = isPropertyGL;

  // All postings use generic system accounts — the property dimension on the ledger entry
  // provides property-level filtering without cluttering the CoA with sub-accounts.
  const [
    receivablesAccountId,
    depositsPayableAccountId,
    landlordRemittanceAccountId,
    rentIncomeAccountId,
    serviceChargeAccountId,
    utilityRechargeAccountId,
    penaltyIncomeAccountId,
  ] = await Promise.all([
    getCachedSystemAccount(resolvedBusinessId, "1200"),
    getCachedSystemAccount(resolvedBusinessId, "2100"),
    getCachedSystemAccount(resolvedBusinessId, "2110"),
    getCachedSystemAccount(resolvedBusinessId, "4100"),
    getCachedSystemAccount(resolvedBusinessId, "4101"),
    getCachedSystemAccount(resolvedBusinessId, "4102"),
    getCachedSystemAccount(resolvedBusinessId, "4103"),
  ]);

  return {
    property,
    propertyId: property._id,
    businessId: resolvedBusinessId,
    landlordId: resolvedLandlordId,
    controlAccountId: property.controlAccount || null,
    accountLedgerType: normalizedLedgerType,
    isPropertyGL,
    isPropertyLedgerActive,
    isOffGL, // legacy alias — prefer isPropertyGL in new code
    receivablesAccountId,
    depositsPayableAccountId,
    landlordRemittanceAccountId,
    rentIncomeAccountId,
    serviceChargeAccountId,
    utilityRechargeAccountId,
    penaltyIncomeAccountId,
  };
};

/**
 * Creates (or retrieves) the PCTRL-{CODE} control account for a property.
 * One account per property — a computed summary of what the PM holds for the landlord.
 * Hidden from the normal CoA, visible only via the "Show Control Accounts" toggle.
 * Idempotent — safe to call on every property save.
 */
export const ensurePropertyChartOfAccounts = async ({
  businessId,
  propertyId,
  propertyCode,
  propertyName,
} = {}) => {
  if (!businessId || !isValidObjectId(businessId)) throw new Error("Valid businessId required.");
  if (!propertyId  || !isValidObjectId(propertyId))  throw new Error("Valid propertyId required.");

  const property = await Property.findById(propertyId)
    .select("_id business propertyCode propertyName controlAccount accountLedgerType");
  if (!property) throw new Error("Property not found while creating control account.");

  await ensureSystemChartOfAccounts(businessId);

  const code = String(propertyCode || property.propertyCode || "").trim().toUpperCase();
  const name = String(propertyName || property.propertyName || "").trim();
  if (!code || !name) throw new Error("Property code and name are required to create control account.");

  const pctrlCode = `PCTRL-${code}`;
  const pctrl = await ChartOfAccount.findOneAndUpdate(
    { business: businessId, code: pctrlCode },
    {
      $setOnInsert: {
        business: businessId,
        code: pctrlCode,
        name: `${name} – Property Control`,
        type: "asset",
        group: "assets",
        subGroup: "Property Control Accounts",
        isHeader: false,
        isPosting: false,
        isSystem: true,
        isControl: true,
        property: property._id,
        balance: 0,
        moduleScopes: ["propertyManagement"],
      },
    },
    { upsert: true, new: true }
  );

  if (!property.controlAccount || String(property.controlAccount) !== String(pctrl._id)) {
    property.controlAccount = pctrl._id;
    await property.save();
  }

  return pctrl;
};

export const ensurePropertyControlAccount = async ({
  businessId, propertyId, propertyCode, propertyName,
} = {}) => {
  return ensurePropertyChartOfAccounts({ businessId, propertyId, propertyCode, propertyName });
};

export const resolveTenantDepositPayableAccount = async (businessId) => {
  await ensureSystemChartOfAccounts(businessId);

  const configured = await resolveConfiguredAccountingDefaultAccount({
    businessId,
    field: "depositLiabilityAccount",
  });
  if (configured) return configured;

  const exact = await findSystemAccountByCode(businessId, "2100");
  if (exact) return exact;

  const fallback = await ChartOfAccount.findOne({
    business: businessId,
    type: "liability",
    $or: [
      { name: { $regex: "^tenant deposit payable$", $options: "i" } },
      { name: { $regex: "^security deposits payable$", $options: "i" } },
      { name: { $regex: "tenant deposit", $options: "i" } },
      { name: { $regex: "security deposit", $options: "i" } },
    ],
  });

  if (!fallback) {
    throw new Error("Tenant Deposit Payable account was not found for this business.");
  }

  return fallback;
};

export const resolveLandlordRemittancePayableAccount = async (businessId) => {
  await ensureSystemChartOfAccounts(businessId);

  const exact = await findSystemAccountByCode(businessId, "2110");
  if (exact) return exact;

  const fallback = await ChartOfAccount.findOne({
    business: businessId,
    type: "liability",
    $or: [
      { name: { $regex: "^landlord remittance payable$", $options: "i" } },
      { name: { $regex: "^landlord payables?$", $options: "i" } },
      { name: { $regex: "landlord payable", $options: "i" } },
      { name: { $regex: "remittance payable", $options: "i" } },
    ],
  });

  if (!fallback) {
    throw new Error("Landlord Remittance Payable account was not found for this business.");
  }

  return fallback;
};

export const findPropertyControlAccount = async ({ businessId, propertyCode } = {}) => {
  if (!businessId || !propertyCode) return null;

  return ChartOfAccount.findOne({
    business: businessId,
    code: `PCTRL-${String(propertyCode || "").trim().toUpperCase()}`,
  });
};

export default {
  resolvePropertyAccountingContext,
  ensurePropertyChartOfAccounts,
  ensurePropertyControlAccount,
  resolveTenantDepositPayableAccount,
  resolveLandlordRemittancePayableAccount,
  findPropertyControlAccount,
};
export const getLandlordBalance = async (landlordId, businessId = null) => {
  const normalizedLandlordId = normalizeObjectId(landlordId);
  const normalizedBusinessId = normalizeObjectId(businessId);

  if (!normalizedLandlordId) {
    throw new Error("Valid landlordId is required to calculate landlord balance.");
  }

  const landlord = await Landlord.findOne({
    _id: normalizedLandlordId,
    ...(normalizedBusinessId ? { company: normalizedBusinessId } : {}),
  }).select("_id company").lean();

  if (!landlord) {
    throw new Error("Landlord not found while calculating balance.");
  }

  const resolvedBusinessId = normalizedBusinessId || normalizeObjectId(landlord.company);

  if (!resolvedBusinessId) {
    throw new Error("Valid businessId is required to calculate landlord balance.");
  }

  // ProcessedStatement.balanceDue is the authoritative outstanding amount — it is
  // decremented by every payLandlord call (Path A). Using the ledger's 2110 credit/debit
  // delta caused split-brain: Path B debits 2110 without crediting it, making the
  // balance appear zero after the first payment even when statements remain unpaid.
  const ProcessedStatement = (await import("../models/ProcessedStatement.js")).default;

  const result = await ProcessedStatement.aggregate([
    {
      $match: {
        business: resolvedBusinessId,
        landlord: normalizedLandlordId,
        status: { $ne: "reversed" },
        isNegativeStatement: { $ne: true },
        balanceDue: { $gt: 0 },
      },
    },
    { $group: { _id: null, balance: { $sum: "$balanceDue" } } },
  ]);

  return Number(result[0]?.balance || 0);
};
