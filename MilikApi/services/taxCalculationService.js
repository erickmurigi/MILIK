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

export const normalizeCompanyTaxConfiguration = (settings = null) => {
  const rawSettings = settings?.taxSettings || {};
  const normalizedSettings = {
    ...DEFAULT_TAX_SETTINGS,
    ...rawSettings,
    invoiceTaxabilityByCategory: {
      ...DEFAULT_TAX_SETTINGS.invoiceTaxabilityByCategory,
      ...(rawSettings?.invoiceTaxabilityByCategory || {}),
    },
  };

  const sourceCodes = Array.isArray(settings?.taxCodes) && settings.taxCodes.length > 0 ? settings.taxCodes : DEFAULT_TAX_CODES;

  const taxCodes = sourceCodes
    .map((code) => ({
      key: normalizeCodeKey(code?.key || code?.name),
      name: String(code?.name || code?.key || "Tax Code").trim(),
      type: String(code?.type || "vat").trim().toLowerCase(),
      rate: Number(code?.rate ?? normalizedSettings.defaultVatRate ?? 0),
      isDefault: Boolean(code?.isDefault),
      isActive: code?.isActive !== false,
      description: String(code?.description || "").trim(),
    }))
    .filter((code) => code.key);

  if (!taxCodes.some((code) => code.key === "no_tax")) {
    taxCodes.unshift(DEFAULT_TAX_CODES[0]);
  }

  const defaultCodeExists = taxCodes.some((code) => code.key === normalizeCodeKey(normalizedSettings.defaultTaxCodeKey, "vat_standard"));
  if (!defaultCodeExists) {
    normalizedSettings.defaultTaxCodeKey = "vat_standard";
  }

  return { taxSettings: normalizedSettings, taxCodes };
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
  if (normalizedCategory === "DEPOSIT_CHARGE") return false;
  if (typeof overrides?.isTaxable === "boolean") return overrides.isTaxable;

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
  const isTaxable = Boolean(taxSettings.enabled && categoryTaxable);
  const requestedCodeKey = overrides?.taxCodeKey || requestedTaxCodeKey || (isTaxable ? taxSettings.defaultTaxCodeKey : "no_tax");
  const taxCode = resolveTaxCode({ taxCodes, requestedKey: requestedCodeKey, defaultKey: taxSettings.defaultTaxCodeKey, fallbackRate: taxSettings.defaultVatRate });
  const finalTaxable = Boolean(isTaxable && taxCode.key !== "no_tax" && taxCode.type !== "exempt");
  const taxMode = String(overrides?.taxMode || requestedTaxMode || taxSettings.defaultTaxMode || "exclusive").toLowerCase() === "inclusive" ? "inclusive" : "exclusive";
  const taxRate = overrides?.rateOverride !== undefined && overrides?.rateOverride !== null ? Number(overrides.rateOverride) : Number(taxCode.rate || 0);
  const breakdown = calculateTaxBreakdown({ amount, taxRate, taxMode, precision, isTaxable: finalTaxable });

  return {
    isTaxable: finalTaxable,
    taxCodeKey: taxCode.key,
    taxCodeName: taxCode.name,
    taxType: taxCode.type,
    taxMode: breakdown.taxMode,
    taxRate: finalTaxable ? taxRate : 0,
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
  const enabled = Boolean(taxSettings.enabled && propertyTaxSettings?.enabled);
  const requestedKey = propertyTaxSettings?.taxCodeKey || taxSettings.defaultTaxCodeKey || "vat_standard";
  const taxCode = resolveTaxCode({ taxCodes, requestedKey, defaultKey: taxSettings.defaultTaxCodeKey, fallbackRate: taxSettings.defaultVatRate });
  const finalTaxable = Boolean(enabled && taxCode.key !== "no_tax" && taxCode.type !== "exempt");
  const taxMode = String(propertyTaxSettings?.taxMode || "company_default").toLowerCase() === "inclusive"
    ? "inclusive"
    : String(propertyTaxSettings?.taxMode || "company_default").toLowerCase() === "exclusive"
    ? "exclusive"
    : String(taxSettings.defaultTaxMode || "exclusive").toLowerCase() === "inclusive"
    ? "inclusive"
    : "exclusive";
  const taxRate = propertyTaxSettings?.rateOverride !== undefined && propertyTaxSettings?.rateOverride !== null
    ? Number(propertyTaxSettings.rateOverride)
    : Number(taxCode.rate || 0);
  const breakdown = calculateTaxBreakdown({ amount: commissionAmount, taxRate, taxMode, precision, isTaxable: finalTaxable });

  return {
    enabled: finalTaxable,
    taxCodeKey: taxCode.key,
    taxCodeName: taxCode.name,
    taxType: taxCode.type,
    taxMode: breakdown.taxMode,
    taxRate: finalTaxable ? taxRate : 0,
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
