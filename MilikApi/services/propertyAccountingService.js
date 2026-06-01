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

// Resolves a typed property account, falling back to the system (parent) account.
// Order: property sub-account → system account by code.
const resolveTypedAccount = async (propertyAccounts, key, businessId, fallbackCode) => {
  const stored = propertyAccounts?.[key];
  if (stored && isValidObjectId(stored)) return stored;
  return getCachedSystemAccount(businessId, fallbackCode);
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
    .select("_id business propertyCode propertyName landlords controlAccount accountLedgerType propertyAccounts")
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

  const isOffGL = String(property.accountLedgerType || "").toLowerCase().includes("off");
  const pa = property.propertyAccounts || {};

  // Resolve all typed accounts in parallel — property sub-accounts first, system fallback second.
  const [
    receivablesAccountId,
    depositsPayableAccountId,
    landlordRemittanceAccountId,
    rentIncomeAccountId,
    serviceChargeAccountId,
    utilityRechargeAccountId,
    penaltyIncomeAccountId,
  ] = await Promise.all([
    resolveTypedAccount(pa, "receivables",         resolvedBusinessId, "1200"),
    resolveTypedAccount(pa, "depositsPayable",     resolvedBusinessId, "2100"),
    resolveTypedAccount(pa, "landlordRemittance",  resolvedBusinessId, "2110"),
    resolveTypedAccount(pa, "rentIncome",          resolvedBusinessId, "4100"),
    resolveTypedAccount(pa, "serviceChargeIncome", resolvedBusinessId, "4101"),
    resolveTypedAccount(pa, "utilityRecharge",     resolvedBusinessId, "4102"),
    resolveTypedAccount(pa, "penaltyIncome",       resolvedBusinessId, "4103"),
  ]);

  return {
    property,
    propertyId: property._id,
    businessId: resolvedBusinessId,
    landlordId: resolvedLandlordId,
    controlAccountId: property.controlAccount || null,
    accountLedgerType: property.accountLedgerType || "in-gl",
    isOffGL,
    // Typed account IDs — use these in posting functions instead of findSystemAccountByCode
    receivablesAccountId,
    depositsPayableAccountId,
    landlordRemittanceAccountId,
    rentIncomeAccountId,
    serviceChargeAccountId,
    utilityRechargeAccountId,
    penaltyIncomeAccountId,
  };
};

// Account types to create per In-GL property.
// Each entry: field on propertyAccounts, parent system code, sub-account suffix,
// account type, group, and name template.
const PROPERTY_ACCOUNT_DEFS = [
  { key: "receivables",         parentCode: "1200", type: "asset",     group: "assets",       subGroup: "Property Receivables",  nameSuffix: "Tenant Receivables"       },
  { key: "depositsPayable",     parentCode: "2100", type: "liability", group: "liabilities",  subGroup: "Property Liabilities",  nameSuffix: "Tenant Deposits Payable"  },
  { key: "landlordRemittance",  parentCode: "2110", type: "liability", group: "liabilities",  subGroup: "Property Liabilities",  nameSuffix: "Landlord Remittance"      },
  { key: "rentIncome",          parentCode: "4100", type: "income",    group: "income",       subGroup: "Property Income",       nameSuffix: "Rent Income"              },
  { key: "serviceChargeIncome", parentCode: "4101", type: "income",    group: "income",       subGroup: "Property Income",       nameSuffix: "Service Charge Income"    },
  { key: "utilityRecharge",     parentCode: "4102", type: "income",    group: "income",       subGroup: "Property Income",       nameSuffix: "Utility Recharge Income"  },
  { key: "penaltyIncome",       parentCode: "4103", type: "income",    group: "income",       subGroup: "Property Income",       nameSuffix: "Penalty Income"           },
];

/**
 * Creates (or retrieves) typed GL sub-accounts for an In-GL property.
 * For Off-GL properties, returns null without touching the GL.
 * Idempotent — safe to call on every property save.
 */
export const ensurePropertyChartOfAccounts = async ({
  businessId,
  propertyId,
  propertyCode,
  propertyName,
  accountLedgerType = "in-gl",
} = {}) => {
  if (!businessId || !isValidObjectId(businessId)) throw new Error("Valid businessId required.");
  if (!propertyId  || !isValidObjectId(propertyId))  throw new Error("Valid propertyId required.");

  const property = await Property.findById(propertyId)
    .select("_id business propertyCode propertyName controlAccount propertyAccounts accountLedgerType");
  if (!property) throw new Error("Property not found while creating GL accounts.");

  // Always respect the stored ledger type on the property document
  const effectiveLedgerType = property.accountLedgerType || accountLedgerType || "in-gl";
  if (String(effectiveLedgerType).toLowerCase().includes("off")) return null;

  await ensureSystemChartOfAccounts(businessId);

  const code = String(propertyCode || property.propertyCode || "").trim().toUpperCase();
  const name = String(propertyName || property.propertyName || "").trim();
  if (!code || !name) throw new Error("Property code and name are required to create GL accounts.");

  const updatedAccounts = property.propertyAccounts?.toObject?.() || {};
  const accountsToAggregate = [];

  for (const def of PROPERTY_ACCOUNT_DEFS) {
    // Skip if already exists and valid
    if (updatedAccounts[def.key] && isValidObjectId(updatedAccounts[def.key])) {
      const exists = await ChartOfAccount.findOne({ _id: updatedAccounts[def.key], business: businessId }).lean();
      if (exists) continue;
    }

    // Find parent system account
    const parent = await ChartOfAccount.findOne({ business: businessId, code: def.parentCode }).lean();

    // Create property sub-account (upsert — safe to re-run)
    const subCode = `${def.parentCode}-${code}`;
    const subAccount = await ChartOfAccount.findOneAndUpdate(
      { business: businessId, code: subCode },
      {
        $setOnInsert: {
          business:      businessId,
          code:          subCode,
          name:          `${def.nameSuffix} – ${name}`,
          type:          def.type,
          group:         def.group,
          subGroup:      def.subGroup,
          parentAccount: parent?._id || null,
          level:         parent ? 1 : 0,
          isHeader:      false,
          isPosting:     true,
          isControl:     true,
          isSystem:      true,
          property:      property._id,
          balance:       0,
          moduleScopes:  ["propertyManagement"],
        },
      },
      { upsert: true, new: true }
    );

    updatedAccounts[def.key] = subAccount._id;
    accountsToAggregate.push(String(subAccount._id));
  }

  // Persist account references on the property
  property.propertyAccounts = updatedAccounts;

  // Also maintain the legacy single controlAccount (backward compat for anything still using it)
  if (!property.controlAccount) {
    const legacyCode = `PCTRL-${code}`;
    const legacy = await ChartOfAccount.findOneAndUpdate(
      { business: businessId, code: legacyCode },
      {
        $setOnInsert: {
          business: businessId, code: legacyCode,
          name: `${name} – Property Control`, type: "asset",
          group: "assets", subGroup: "Property Receivables",
          isHeader: false, isPosting: true, isSystem: true,
          isControl: true, property: property._id, balance: 0,
          moduleScopes: ["propertyManagement"],
        },
      },
      { upsert: true, new: true }
    );
    property.controlAccount = legacy._id;
  }

  await property.save();
  return property.propertyAccounts;
};

/**
 * Backward-compatible wrapper — existing callers of ensurePropertyControlAccount
 * now get the full set of typed accounts created, plus the legacy control account.
 */
export const ensurePropertyControlAccount = async ({
  businessId, propertyId, propertyCode, propertyName,
} = {}) => {
  await ensurePropertyChartOfAccounts({ businessId, propertyId, propertyCode, propertyName });
  // Return the legacy PCTRL account for callers that still expect it
  const property = await Property.findById(propertyId).select("controlAccount").lean();
  if (!property?.controlAccount) return null;
  return ChartOfAccount.findById(property.controlAccount);
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

  const payableAccount = await resolveLandlordRemittancePayableAccount(resolvedBusinessId);
  const FinancialLedgerEntry = (await import("../models/FinancialLedgerEntry.js")).default;

  const ledgerTotals = await FinancialLedgerEntry.aggregate([
    {
      $match: {
        business: resolvedBusinessId,
        landlord: normalizedLandlordId,
        accountId: payableAccount._id,
        status: { $ne: "reversed" },
        $or: [{ reversalOf: { $exists: false } }, { reversalOf: null }],
      },
    },
    { $group: { _id: null, debit: { $sum: "$debit" }, credit: { $sum: "$credit" }, count: { $sum: 1 } } },
  ]);

  const ledgerRow = ledgerTotals[0] || { debit: 0, credit: 0, count: 0 };
  if (ledgerRow.count > 0) {
    return Math.max(Number(ledgerRow.credit || 0) - Number(ledgerRow.debit || 0), 0);
  }

  const ProcessedStatement = (await import("../models/ProcessedStatement.js")).default;
  const LandlordPayment = (await import("../models/LandlordPayment.js")).default;

  const statementTotals = await ProcessedStatement.aggregate([
    {
      $match: {
        business: resolvedBusinessId,
        landlord: normalizedLandlordId,
        status: { $ne: "reversed" },
        isNegativeStatement: { $ne: true },
      },
    },
    { $group: { _id: null, payable: { $sum: "$netAmountDue" } } },
  ]);

  const paymentTotals = await LandlordPayment.aggregate([
    {
      $match: {
        business: resolvedBusinessId,
        landlord: normalizedLandlordId,
        status: { $ne: "reversed" },
      },
    },
    { $group: { _id: null, paid: { $sum: "$amount" } } },
  ]);

  return Math.max(Number(statementTotals[0]?.payable || 0) - Number(paymentTotals[0]?.paid || 0), 0);
};
