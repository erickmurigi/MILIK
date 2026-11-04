// Resolves per-line tax codes for client documents against the company's own tax code list
// (CompanySettings.taxCodes via services/taxCalculationService.js), so client invoices honour
// zero-rated / exempt / custom-rate codes instead of a flat vatRate.
//
// Unlike tenant invoices, the PMS "taxSettings.enabled" switch is NOT consulted: that flag decides
// whether rent/utility charges are taxable, while client service invoices have always carried VAT
// (the old flat vatRate defaulted to 16). A line opts out with taxCodeKey "no_tax"/"vat_exempt".
import { getCompanyTaxConfiguration, resolveTaxCode, DEFAULT_TAX_CODES } from "../../../services/taxCalculationService.js";
import { createError } from "../../../utils/error.js";

// Output VAT on client documents posts to 2190, the clients+inventory output VAT account. The VAT
// return (controllers/propertyController/taxRemittance.js resolveVatAccounts) always reads 2190 next
// to the company's configured output account, so one return covers PMS, POS and client VAT.
export const CLIENT_OUTPUT_VAT_CODE = "2190";

const normalizeKey = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");

export const getClientTaxContext = async (businessId) => {
  const config = await getCompanyTaxConfiguration(businessId);
  return {
    taxCodes: config.taxCodes || DEFAULT_TAX_CODES,
    defaultCodeKey: config.taxSettings?.defaultTaxCodeKey || "vat_standard",
    defaultVatRate: Number(config.taxSettings?.defaultVatRate ?? 16),
  };
};

export const listClientTaxCodes = (ctx) => (ctx.taxCodes || []).filter((c) => c.isActive !== false);

// Returns the tax snapshot stored on a line. `legacy` covers callers that still send the old
// { taxable, vatRate } shape: taxable:false (or a 0 rate) -> no_tax, otherwise the company default
// code at the given rate — which reproduces every pre-tax-code invoice exactly.
export const resolveClientLineTax = (ctx, requestedKey, legacy = {}) => {
  const key = normalizeKey(requestedKey);
  if (key) {
    const known = (ctx.taxCodes || []).some((c) => c.key === key && c.isActive !== false)
      || DEFAULT_TAX_CODES.some((c) => c.key === key);
    if (!known) throw createError(400, `Unknown or inactive tax code '${requestedKey}'`);
    const code = resolveTaxCode({ taxCodes: ctx.taxCodes, requestedKey: key, defaultKey: ctx.defaultCodeKey, fallbackRate: ctx.defaultVatRate });
    return snapshotOf(code);
  }

  const legacyRate = legacy.vatRate === undefined || legacy.vatRate === null || legacy.vatRate === "" ? null : Number(legacy.vatRate);
  if (legacy.taxable === false || legacyRate === 0) {
    return snapshotOf(resolveTaxCode({ taxCodes: ctx.taxCodes, requestedKey: "no_tax" }));
  }
  const code = resolveTaxCode({ taxCodes: ctx.taxCodes, requestedKey: ctx.defaultCodeKey, defaultKey: "vat_standard", fallbackRate: ctx.defaultVatRate });
  const snap = snapshotOf(code);
  if (legacyRate !== null && snap.taxType === "vat") snap.taxRate = Math.max(0, legacyRate);
  return snap;
};

const snapshotOf = (code = {}) => {
  const taxType = String(code.type || "none").toLowerCase();
  return {
    taxCodeKey: code.key || "no_tax",
    taxCodeName: code.name || "No Tax",
    taxType,
    taxRate: taxType === "vat" ? Math.max(0, Number(code.rate || 0)) : 0,
  };
};

export const applyClientTaxToLines = (ctx, lines = [], legacy = {}) =>
  lines.map((line) => ({
    ...line,
    ...resolveClientLineTax(ctx, line.taxCodeKey, { taxable: line.taxable, vatRate: legacy.vatRate }),
  }));
