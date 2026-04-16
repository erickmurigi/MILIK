import mongoose from "mongoose";
import CompanySettings from "../models/CompanySettings.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import { ensureSystemChartOfAccounts, findSystemAccountByCode } from "./chartOfAccountsService.js";

const roundTo = (value, precision = 2) => {
  const factor = 10 ** Number(precision || 0);
  return Math.round((Number(value || 0) + Number.EPSILON) * factor) / factor;
};

export const DEFAULT_TAX_CODES = [
  { key: "no_tax", name: "No Tax", type: "none", rate: 0, isDefault: false, isActive: true, description: "Non-taxable item" },
  { key: "vat_standard", name: "VAT Standard", type: "vat", rate: 16, isDefault: true, isActive: true, description: "Standard output VAT" },
  { key: "vat_zero", name: "VAT Zero Rated", type: "zero_rated", rate: 0, isDefault: false, isActive: true, description: "Zero-rated taxable supply" },
  { key: "vat_exempt", name: "VAT Exempt", type: "exempt", rate: 0, isDefault: false, isActive: true, description: "VAT exempt supply" },
];

export const DEFAULT_TAX_SETTINGS = {
  enabled: false,
  defaultTaxMode: "exclusive",
  defaultTaxCodeKey: "vat_standard",
  defaultVatRate: 16,
  roundingPrecision: 2,
  outputVatAccountCode: "2140",
  invoiceTaxableByDefault: false,
  invoiceTaxabilityByCategory: {
    rent: false,
    utility: false,
    penalty: false,
    deposit: false,
  },
};

const normalizeCodeKey = (value, fallback = "no_tax") => String(value || fallback).trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");

const normalizeEmbeddedTaxCodeId = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  const raw = String(value).trim();
  return mongoose.Types.ObjectId.isValid(raw) ? new mongoose.Types.ObjectId(raw) : null;
};

const toPlainValue = (value) => {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => toPlainValue(item));
  if (value?.toObject) return value.toObject();
  if (value?._doc && typeof value._doc === "object") return { ...value._doc };
  return value;
};


export const normalizeCompanyTaxConfiguration = (settings = null) => {
  const rawSettings = toPlainValue(settings?.taxSettings) || {};
  const rawInvoiceTaxability = toPlainValue(rawSettings?.invoiceTaxabilityByCategory) || {};
  const normalizedSettings = {
    ...DEFAULT_TAX_SETTINGS,
    ...rawSettings,
    invoiceTaxabilityByCategory: {
      ...DEFAULT_TAX_SETTINGS.invoiceTaxabilityByCategory,
      ...rawInvoiceTaxability,
    },
  };

  const sourceCodes = Array.isArray(settings?.taxCodes) && settings.taxCodes.length > 0
    ? settings.taxCodes.map((code) => toPlainValue(code) || {})
    : DEFAULT_TAX_CODES;

  const taxCodes = sourceCodes
    .map((code) => ({
      _id: normalizeEmbeddedTaxCodeId(code?._id),
      key: normalizeCodeKey(code?.key || code?.name),
      name: String(code?.name || code?.key || "Tax Code").trim(),
      type: String(code?.type || "vat").trim().toLowerCase(),
      rate: Math.max(Number(code?.rate ?? normalizedSettings.defaultVatRate ?? 0), 0),
      isDefault: Boolean(code?.isDefault),
      isActive: code?.isActive !== false,
      description: String(code?.description || "").trim(),
    }))
    .filter((code) => code.key);

  if (!taxCodes.some((code) => code.key === "no_tax")) {
    taxCodes.unshift({ ...DEFAULT_TAX_CODES[0] });
  }

  const noTaxIndex = taxCodes.findIndex((code) => code.key === "no_tax");
  if (noTaxIndex >= 0) {
    taxCodes[noTaxIndex] = {
      ...taxCodes[noTaxIndex],
      name: taxCodes[noTaxIndex].name || DEFAULT_TAX_CODES[0].name,
      type: "none",
      rate: 0,
      isActive: true,
    };
  }

  let normalizedDefaultKey = normalizeCodeKey(normalizedSettings.defaultTaxCodeKey, "vat_standard");
  const activeDefaultExists = taxCodes.some(
    (code) => code.key === normalizedDefaultKey && code.isActive !== false
  );

  if (!activeDefaultExists) {
    normalizedDefaultKey = taxCodes.some((code) => code.key === "vat_standard" && code.isActive !== false)
      ? "vat_standard"
      : (taxCodes.find((code) => code.isActive !== false)?.key || "no_tax");
  }

  normalizedSettings.defaultTaxCodeKey = normalizedDefaultKey;

  let defaultAssigned = false;
  const normalizedCodes = taxCodes.map((code) => {
    const nextCode = {
      ...code,
      isDefault: !defaultAssigned && code.key === normalizedDefaultKey,
    };
    if (nextCode.isDefault) defaultAssigned = true;
    return nextCode;
  });

  if (!defaultAssigned) {
    normalizedCodes[0] = { ...normalizedCodes[0], isDefault: true };
    normalizedSettings.defaultTaxCodeKey = normalizedCodes[0].key;
  }

  return { taxSettings: normalizedSettings, taxCodes: normalizedCodes };
};

export const getCompanyTaxConfiguration = async (businessId) => {
  const settings = await CompanySettings.findOne({ company: businessId }).select("taxSettings taxCodes").lean();
  return normalizeCompanyTaxConfiguration(settings);
};

export const resolveTaxCode = ({ taxCodes = [], requestedKey = null, defaultKey = "vat_standard", fallbackRate = 16 }) => {
  const normalizedRequested = normalizeCodeKey(requestedKey || defaultKey);
  const found = taxCodes.find((code) => code.key === normalizedRequested && code.isActive !== false);
  if (found) return { ...found, rate: Number(found.rate ?? fallbackRate ?? 0) };

  if (normalizedRequested === "no_tax") return { ...DEFAULT_TAX_CODES[0] };
  if (normalizedRequested === "vat_standard") return { ...DEFAULT_TAX_CODES[1], rate: Number(fallbackRate ?? DEFAULT_TAX_CODES[1].rate) };
  if (normalizedRequested === "vat_zero") return { ...DEFAULT_TAX_CODES[2] };
  if (normalizedRequested === "vat_exempt") return { ...DEFAULT_TAX_CODES[3] };

  return { ...DEFAULT_TAX_CODES[0] };
};

export const calculateTaxBreakdown = ({ amount, taxRate = 0, taxMode = "exclusive", precision = 2, isTaxable = false }) => {
  const enteredAmount = roundTo(Math.abs(Number(amount || 0)), precision);
  const normalizedRate = Math.max(Number(taxRate || 0), 0);
  const normalizedMode = String(taxMode || "exclusive").toLowerCase() === "inclusive" ? "inclusive" : "exclusive";

  if (!isTaxable || normalizedRate <= 0 || enteredAmount <= 0) {
    return {
      taxMode: normalizedMode,
      enteredAmount,
      netAmount: enteredAmount,
      taxAmount: 0,
      grossAmount: enteredAmount,
    };
  }

  if (normalizedMode === "inclusive") {
    const netAmount = roundTo(enteredAmount / (1 + normalizedRate / 100), precision);
    const taxAmount = roundTo(enteredAmount - netAmount, precision);
    return {
      taxMode: normalizedMode,
      enteredAmount,
      netAmount,
      taxAmount,
      grossAmount: enteredAmount,
    };
  }

  const taxAmount = roundTo((enteredAmount * normalizedRate) / 100, precision);
  return {
    taxMode: normalizedMode,
    enteredAmount,
    netAmount: enteredAmount,
    taxAmount,
    grossAmount: roundTo(enteredAmount + taxAmount, precision),
  };
};

const resolveInvoiceTaxability = ({ category, taxSettings, overrides = {} }) => {
  const normalizedCategory = String(category || "").toUpperCase();
  if (typeof overrides?.isTaxable === "boolean") return overrides.isTaxable;
  if (normalizedCategory === "DEPOSIT_CHARGE") return Boolean(taxSettings.invoiceTaxabilityByCategory?.deposit ?? false);

  if (normalizedCategory === "RENT_CHARGE") return Boolean(taxSettings.invoiceTaxabilityByCategory?.rent ?? taxSettings.invoiceTaxableByDefault);
  if (normalizedCategory === "UTILITY_CHARGE") return Boolean(taxSettings.invoiceTaxabilityByCategory?.utility ?? taxSettings.invoiceTaxableByDefault);
  if (normalizedCategory === "LATE_PENALTY_CHARGE") return Boolean(taxSettings.invoiceTaxabilityByCategory?.penalty ?? taxSettings.invoiceTaxableByDefault);
  return Boolean(taxSettings.invoiceTaxableByDefault);
};

export const buildInvoiceTaxSnapshot = ({ amount, category, companyTaxConfig, requestedTaxCodeKey = null, requestedTaxMode = null, overrides = {} }) => {
  const config = companyTaxConfig || normalizeCompanyTaxConfiguration();
  const taxSettings = config.taxSettings || DEFAULT_TAX_SETTINGS;
  const taxCodes = config.taxCodes || DEFAULT_TAX_CODES;
  const precision = Number(taxSettings.roundingPrecision ?? 2);
  const categoryTaxable = resolveInvoiceTaxability({ category, taxSettings, overrides });
  const taxEngineActive = Boolean(taxSettings.enabled && categoryTaxable);
  const requestedCodeKey =
    overrides?.taxCodeKey || requestedTaxCodeKey || (taxEngineActive ? taxSettings.defaultTaxCodeKey : "no_tax");
  const requestedTaxCode = resolveTaxCode({
    taxCodes,
    requestedKey: requestedCodeKey,
    defaultKey: taxSettings.defaultTaxCodeKey,
    fallbackRate: taxSettings.defaultVatRate,
  });
  const retainsTaxClassification = Boolean(taxEngineActive && requestedTaxCode.key !== "no_tax");
  const effectiveTaxCode = retainsTaxClassification
    ? requestedTaxCode
    : resolveTaxCode({
        taxCodes,
        requestedKey: "no_tax",
        defaultKey: "no_tax",
        fallbackRate: 0,
      });
  const taxMode =
    String(overrides?.taxMode || requestedTaxMode || taxSettings.defaultTaxMode || "exclusive").toLowerCase() ===
    "inclusive"
      ? "inclusive"
      : "exclusive";
  const requestedRate =
    overrides?.rateOverride !== undefined && overrides?.rateOverride !== null
      ? Number(overrides.rateOverride)
      : Number(effectiveTaxCode.rate || 0);
  const effectiveTaxRate =
    retainsTaxClassification && effectiveTaxCode.type !== "exempt" ? Math.max(requestedRate, 0) : 0;
  const breakdown = calculateTaxBreakdown({
    amount,
    taxRate: effectiveTaxRate,
    taxMode,
    precision,
    isTaxable: retainsTaxClassification,
  });

  return {
    isTaxable: retainsTaxClassification,
    taxCodeKey: effectiveTaxCode.key,
    taxCodeName: effectiveTaxCode.name,
    taxType: effectiveTaxCode.type,
    taxMode: breakdown.taxMode,
    taxRate: effectiveTaxRate,
    enteredAmount: breakdown.enteredAmount,
    netAmount: breakdown.netAmount,
    taxAmount: breakdown.taxAmount,
    grossAmount: breakdown.grossAmount,
    outputAccountCode: String(taxSettings.outputVatAccountCode || DEFAULT_TAX_SETTINGS.outputVatAccountCode),
  };
};

export const buildCommissionTaxSnapshot = ({ commissionAmount, propertyTaxSettings = {}, companyTaxConfig }) => {
  const config = companyTaxConfig || normalizeCompanyTaxConfiguration();
  const taxSettings = config.taxSettings || DEFAULT_TAX_SETTINGS;
  const taxCodes = config.taxCodes || DEFAULT_TAX_CODES;
  const precision = Number(taxSettings.roundingPrecision ?? 2);
  const taxEngineActive = Boolean(taxSettings.enabled && propertyTaxSettings?.enabled);
  const requestedKey = propertyTaxSettings?.taxCodeKey || taxSettings.defaultTaxCodeKey || "vat_standard";
  const requestedTaxCode = resolveTaxCode({
    taxCodes,
    requestedKey,
    defaultKey: taxSettings.defaultTaxCodeKey,
    fallbackRate: taxSettings.defaultVatRate,
  });
  const retainsTaxClassification = Boolean(taxEngineActive && requestedTaxCode.key !== "no_tax");
  const effectiveTaxCode = retainsTaxClassification
    ? requestedTaxCode
    : resolveTaxCode({
        taxCodes,
        requestedKey: "no_tax",
        defaultKey: "no_tax",
        fallbackRate: 0,
      });
  const taxMode = String(propertyTaxSettings?.taxMode || "company_default").toLowerCase() === "inclusive"
    ? "inclusive"
    : String(propertyTaxSettings?.taxMode || "company_default").toLowerCase() === "exclusive"
    ? "exclusive"
    : String(taxSettings.defaultTaxMode || "exclusive").toLowerCase() === "inclusive"
    ? "inclusive"
    : "exclusive";
  const requestedRate =
    propertyTaxSettings?.rateOverride !== undefined && propertyTaxSettings?.rateOverride !== null
      ? Number(propertyTaxSettings.rateOverride)
      : Number(effectiveTaxCode.rate || 0);
  const effectiveTaxRate =
    retainsTaxClassification && effectiveTaxCode.type !== "exempt" ? Math.max(requestedRate, 0) : 0;
  const breakdown = calculateTaxBreakdown({
    amount: commissionAmount,
    taxRate: effectiveTaxRate,
    taxMode,
    precision,
    isTaxable: retainsTaxClassification,
  });

  return {
    enabled: retainsTaxClassification,
    taxCodeKey: effectiveTaxCode.key,
    taxCodeName: effectiveTaxCode.name,
    taxType: effectiveTaxCode.type,
    taxMode: breakdown.taxMode,
    taxRate: effectiveTaxRate,
    netAmount: breakdown.netAmount,
    taxAmount: breakdown.taxAmount,
    grossAmount: breakdown.grossAmount,
    outputAccountCode: String(taxSettings.outputVatAccountCode || DEFAULT_TAX_SETTINGS.outputVatAccountCode),
  };
};

export const resolveOutputVatAccount = async ({ businessId, companyTaxConfig }) => {
  await ensureSystemChartOfAccounts(businessId);
  const config = companyTaxConfig || (await getCompanyTaxConfiguration(businessId));
  const accountCode = String(config?.taxSettings?.outputVatAccountCode || DEFAULT_TAX_SETTINGS.outputVatAccountCode).trim() || "2140";

  const exact = await findSystemAccountByCode(businessId, accountCode);
  if (exact) return exact;

  const fallback = await ChartOfAccount.findOne({
    business: businessId,
    isPosting: { $ne: false },
    isHeader: { $ne: true },
    $or: [
      { code: accountCode },
      { name: { $regex: "vat|tax payable", $options: "i" } },
    ],
  }).lean();

  if (!fallback) {
    throw new Error("Output VAT / Tax Payable account was not found for this business.");
  }

  return fallback;
};
