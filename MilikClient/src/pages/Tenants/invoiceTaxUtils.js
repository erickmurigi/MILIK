const DEFAULT_TAX_CODES = [
  { key: "no_tax", name: "No Tax", type: "none", rate: 0, isDefault: false, isActive: true },
  { key: "vat_standard", name: "VAT Standard", type: "vat", rate: 16, isDefault: true, isActive: true },
  { key: "vat_zero", name: "VAT Zero Rated", type: "zero_rated", rate: 0, isDefault: false, isActive: true },
  { key: "vat_exempt", name: "VAT Exempt", type: "exempt", rate: 0, isDefault: false, isActive: true },
];

export const DEFAULT_TAX_SETTINGS = {
  enabled: false,
  defaultTaxMode: "exclusive",
  defaultTaxCodeKey: "vat_standard",
  defaultVatRate: 16,
  roundingPrecision: 2,
  invoiceTaxableByDefault: false,
  invoiceTaxabilityByCategory: {
    rent: false,
    utility: false,
    penalty: false,
    deposit: false,
  },
};

const roundTo = (value, precision = 2) => {
  const factor = 10 ** Number(precision || 0);
  return Math.round((Number(value || 0) + Number.EPSILON) * factor) / factor;
};

const normalizeCodeKey = (value, fallback = "no_tax") =>
  String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_");

export const normalizeCompanyTaxConfig = (settings = null) => {
  const rawSettings = settings?.taxSettings || {};
  const taxSettings = {
    ...DEFAULT_TAX_SETTINGS,
    ...rawSettings,
    invoiceTaxabilityByCategory: {
      ...DEFAULT_TAX_SETTINGS.invoiceTaxabilityByCategory,
      ...(rawSettings?.invoiceTaxabilityByCategory || {}),
    },
  };

  const sourceCodes = Array.isArray(settings?.taxCodes) && settings.taxCodes.length > 0
    ? settings.taxCodes
    : DEFAULT_TAX_CODES;

  const taxCodes = sourceCodes
    .map((code) => ({
      key: normalizeCodeKey(code?.key || code?.name),
      name: String(code?.name || code?.key || "Tax Code").trim(),
      type: String(code?.type || "vat").trim().toLowerCase(),
      rate: Number(code?.rate ?? taxSettings.defaultVatRate ?? 0),
      isDefault: Boolean(code?.isDefault),
      isActive: code?.isActive !== false,
      description: String(code?.description || "").trim(),
    }))
    .filter((code) => code.key);

  if (!taxCodes.some((code) => code.key === "no_tax")) {
    taxCodes.unshift(DEFAULT_TAX_CODES[0]);
  }

  if (!taxCodes.some((code) => code.key === normalizeCodeKey(taxSettings.defaultTaxCodeKey, "vat_standard"))) {
    taxSettings.defaultTaxCodeKey = "vat_standard";
  }

  return { taxSettings, taxCodes };
};

export const getActiveTaxCodes = (companyTaxConfig = null) => {
  const config = normalizeCompanyTaxConfig(companyTaxConfig);
  return (config.taxCodes || []).filter((code) => code.isActive !== false);
};

export const getTaxCodeLabel = (key, companyTaxConfig = null) => {
  const normalizedKey = normalizeCodeKey(key, "no_tax");
  const code = getActiveTaxCodes(companyTaxConfig).find((item) => item.key === normalizedKey);
  return code?.name || (normalizedKey === "no_tax" ? "No Tax" : normalizedKey);
};

const resolveTaxCode = ({ companyTaxConfig = null, requestedKey = null }) => {
  const config = normalizeCompanyTaxConfig(companyTaxConfig);
  const normalizedKey = normalizeCodeKey(requestedKey || config.taxSettings.defaultTaxCodeKey, "no_tax");
  const activeCodes = getActiveTaxCodes(config);
  return (
    activeCodes.find((code) => code.key === normalizedKey) ||
    activeCodes.find((code) => code.key === "no_tax") ||
    DEFAULT_TAX_CODES[0]
  );
};

const resolveCategoryTaxability = ({ category, taxSettings }) => {
  const normalizedCategory = String(category || "").toUpperCase();
  if (normalizedCategory === "DEPOSIT_CHARGE") return false;
  if (normalizedCategory === "RENT_CHARGE") {
    return Boolean(taxSettings.invoiceTaxabilityByCategory?.rent ?? taxSettings.invoiceTaxableByDefault);
  }
  if (normalizedCategory === "UTILITY_CHARGE") {
    return Boolean(taxSettings.invoiceTaxabilityByCategory?.utility ?? taxSettings.invoiceTaxableByDefault);
  }
  if (normalizedCategory === "LATE_PENALTY_CHARGE") {
    return Boolean(taxSettings.invoiceTaxabilityByCategory?.penalty ?? taxSettings.invoiceTaxableByDefault);
  }
  return Boolean(taxSettings.invoiceTaxableByDefault);
};

const calculateBreakdown = ({ amount, taxRate = 0, taxMode = "exclusive", precision = 2, isTaxable = false }) => {
  const enteredAmount = roundTo(Math.abs(Number(amount || 0)), precision);
  const normalizedRate = Math.max(Number(taxRate || 0), 0);
  const normalizedMode = String(taxMode || "exclusive").toLowerCase() === "inclusive" ? "inclusive" : "exclusive";

  if (!isTaxable || normalizedRate <= 0 || enteredAmount <= 0) {
    return {
      netAmount: enteredAmount,
      taxAmount: 0,
      grossAmount: enteredAmount,
      taxMode: normalizedMode,
    };
  }

  if (normalizedMode === "inclusive") {
    const netAmount = roundTo(enteredAmount / (1 + normalizedRate / 100), precision);
    return {
      netAmount,
      taxAmount: roundTo(enteredAmount - netAmount, precision),
      grossAmount: enteredAmount,
      taxMode: normalizedMode,
    };
  }

  const taxAmount = roundTo((enteredAmount * normalizedRate) / 100, precision);
  return {
    netAmount: enteredAmount,
    taxAmount,
    grossAmount: roundTo(enteredAmount + taxAmount, precision),
    taxMode: normalizedMode,
  };
};

export const buildTaxPreviewForCategory = ({ amount, category, companyTaxConfig = null, selection = {} }) => {
  const config = normalizeCompanyTaxConfig(companyTaxConfig);
  const taxSettings = config.taxSettings || DEFAULT_TAX_SETTINGS;
  const handling = String(selection?.handling || "company_default").toLowerCase();
  const precision = Number(taxSettings.roundingPrecision ?? 2);
  const normalizedCategory = String(category || "").toUpperCase();

  if (normalizedCategory === "DEPOSIT_CHARGE") {
    return {
      isTaxable: false,
      taxCodeKey: "no_tax",
      taxCodeName: "No Tax",
      taxRate: 0,
      taxMode: "exclusive",
      netAmount: roundTo(amount, precision),
      taxAmount: 0,
      grossAmount: roundTo(amount, precision),
    };
  }

  const companyTaxEnabled = Boolean(taxSettings.enabled);
  const companyDefaultTaxable = resolveCategoryTaxability({ category: normalizedCategory, taxSettings });
  const useManualTax = handling !== "company_default";
  const manuallyTaxable = handling === "taxable";
  const shouldApplyTax = companyTaxEnabled && (useManualTax ? manuallyTaxable : companyDefaultTaxable);
  const requestedCodeKey = handling === "non_taxable"
    ? "no_tax"
    : selection?.taxCodeKey || taxSettings.defaultTaxCodeKey || "vat_standard";
  const taxCode = resolveTaxCode({ companyTaxConfig: config, requestedKey: requestedCodeKey });
  const finalTaxable = Boolean(shouldApplyTax && taxCode.key !== "no_tax" && taxCode.type !== "exempt");
  const taxMode = String(selection?.taxMode || "company_default").toLowerCase() === "company_default"
    ? String(taxSettings.defaultTaxMode || "exclusive").toLowerCase()
    : String(selection?.taxMode || taxSettings.defaultTaxMode || "exclusive").toLowerCase();
  const breakdown = calculateBreakdown({
    amount,
    taxRate: finalTaxable ? Number(taxCode.rate || 0) : 0,
    taxMode,
    precision,
    isTaxable: finalTaxable,
  });

  return {
    isTaxable: finalTaxable,
    taxCodeKey: finalTaxable ? taxCode.key : "no_tax",
    taxCodeName: finalTaxable ? taxCode.name : "No Tax",
    taxRate: finalTaxable ? Number(taxCode.rate || 0) : 0,
    taxMode: breakdown.taxMode,
    netAmount: breakdown.netAmount,
    taxAmount: breakdown.taxAmount,
    grossAmount: breakdown.grossAmount,
  };
};

export const buildTaxPreviewForComponents = ({ components = [], companyTaxConfig = null, selection = {} }) => {
  return (Array.isArray(components) ? components : []).reduce(
    (acc, component) => {
      const preview = buildTaxPreviewForCategory({
        amount: Number(component?.amount || 0),
        category: component?.category,
        companyTaxConfig,
        selection,
      });

      return {
        netAmount: roundTo(acc.netAmount + preview.netAmount),
        taxAmount: roundTo(acc.taxAmount + preview.taxAmount),
        grossAmount: roundTo(acc.grossAmount + preview.grossAmount),
      };
    },
    { netAmount: 0, taxAmount: 0, grossAmount: 0 }
  );
};

export const resolveTaxSelectionPayload = (selection = {}, companyTaxConfig = null) => {
  const config = normalizeCompanyTaxConfig(companyTaxConfig);
  const handling = String(selection?.handling || "company_default").toLowerCase();

  if (handling === "company_default") return {};
  if (handling === "non_taxable") {
    return {
      isTaxable: false,
      taxCodeKey: "no_tax",
    };
  }

  return {
    isTaxable: true,
    taxCodeKey: selection?.taxCodeKey || config.taxSettings?.defaultTaxCodeKey || "vat_standard",
    ...(selection?.taxMode && String(selection.taxMode).toLowerCase() !== "company_default"
      ? { taxMode: selection.taxMode }
      : {}),
  };
};
