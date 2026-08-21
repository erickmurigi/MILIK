import CompanySettings from "../../models/CompanySettings.js";
import mongoose from "mongoose";
import { createError } from "../../utils/error.js";
import {
  validateAccountingDefaultAccount,
  validateHrAccountingDefaultAccount,
  validateInvAccountingDefaultAccount,
} from "../../services/companyAccountingDefaultsService.js";
import {
  DEFAULT_TAX_CODES,
  DEFAULT_TAX_SETTINGS,
  normalizeCompanyTaxConfiguration,
} from "../../services/taxCalculationService.js";
import {
  DEFAULT_BILLING_PERIODS,
  buildBillingPeriodRecord,
  canonicalizeBillingPeriodKey,
  ensureSettingsBillingPeriods,
} from "../../services/billingPeriodService.js";
import { logAuditEvent } from "../../utils/auditLogger.js";

// In-memory settings cache — avoids a DB round-trip on every page load.
// Invalidated via invalidateSettingsCache() from the routes layer on any mutation.
const settingsCache = new Map(); // businessId -> { data, expiresAt }
const SETTINGS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export const invalidateSettingsCache = (businessId) => {
  if (businessId) settingsCache.delete(String(businessId));
};

const normalizeText = (value = "") => String(value ?? "").trim();
const normalizeLower = (value = "") => normalizeText(value).toLowerCase();
const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeTaxCodeKey = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_");

const resolveEmbeddedTaxCodeId = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  const raw = String(value).trim();
  return mongoose.Types.ObjectId.isValid(raw) ? new mongoose.Types.ObjectId(raw) : null;
};

const validateNormalizedTaxConfiguration = ({ taxSettings = {}, taxCodes = [] } = {}) => {
  const seenKeys = new Set();
  let activeCount = 0;
  let activeDefaultCount = 0;

  for (const code of Array.isArray(taxCodes) ? taxCodes : []) {
    const normalizedKey = normalizeTaxCodeKey(code?.key);
    if (!normalizedKey) {
      const error = new Error("Every tax code must have a valid key.");
      error.statusCode = 400;
      throw error;
    }
    if (seenKeys.has(normalizedKey)) {
      const error = new Error(`Duplicate tax code key detected: ${normalizedKey}.`);
      error.statusCode = 400;
      throw error;
    }
    seenKeys.add(normalizedKey);

    if (!String(code?.name || "").trim()) {
      const error = new Error(`Tax code ${normalizedKey} must have a name.`);
      error.statusCode = 400;
      throw error;
    }

    const rate = Number(code?.rate ?? 0);
    if (!Number.isFinite(rate) || rate < 0) {
      const error = new Error(`Tax code ${normalizedKey} has an invalid rate.`);
      error.statusCode = 400;
      throw error;
    }

    if (code?.isActive !== false) {
      activeCount += 1;
      if (code?.isDefault) activeDefaultCount += 1;
    }
  }

  if (activeCount <= 0) {
    const error = new Error("At least one active tax code is required.");
    error.statusCode = 400;
    throw error;
  }

  if (activeDefaultCount !== 1) {
    const error = new Error("Exactly one active default tax code is required.");
    error.statusCode = 400;
    throw error;
  }

  if (taxSettings?.enabled && !String(taxSettings.outputVatAccountCode || "").trim()) {
    const error = new Error("Output VAT / Tax Payable account code is required when tax is enabled.");
    error.statusCode = 400;
    throw error;
  }
};

const mapTaxCodeForStorage = (code) => ({
  _id: resolveEmbeddedTaxCodeId(code?._id) || new mongoose.Types.ObjectId(),
  key: code.key,
  name: code.name,
  type: code.type,
  rate: Number(code.rate || 0),
  isDefault: Boolean(code.isDefault),
  isActive: code.isActive !== false,
  description: code.description || "",
});


const resolveAuthorizedBusinessId = (req) => {
  const requested = req.params?.businessId || req.body?.business || req.query?.business || null;
  const authenticated = req.user?.company?._id || req.user?.company || req.user?.businessId || null;

  if (req.user?.isSystemAdmin || req.user?.superAdminAccess) {
    return requested || authenticated || null;
  }

  if (!authenticated) {
    const error = new Error("No company associated with user.");
    error.statusCode = 403;
    throw error;
  }

  if (requested && String(requested) !== String(authenticated)) {
    const error = new Error("Not authorized to access this company's settings.");
    error.statusCode = 403;
    throw error;
  }

  return authenticated;
};

const findCompanySettings = (companyId) => CompanySettings.findOne({ company: companyId });

const buildDefaultTaxConfiguration = () => ({
  taxSettings: {
    ...DEFAULT_TAX_SETTINGS,
    invoiceTaxabilityByCategory: { ...DEFAULT_TAX_SETTINGS.invoiceTaxabilityByCategory },
  },
  taxCodes: DEFAULT_TAX_CODES.map((code) => ({
    _id: new mongoose.Types.ObjectId(),
    ...code,
  })),
});

const ensureSettingsTaxConfiguration = (settings) => {
  if (!settings) return settings;

  const normalized = normalizeCompanyTaxConfiguration(settings);
  const storedCodes = normalized.taxCodes.map(mapTaxCodeForStorage);

  if (typeof settings.set === "function") {
    settings.set("taxSettings", normalized.taxSettings);
    settings.set("taxCodes", storedCodes);
    settings.markModified("taxSettings");
    settings.markModified("taxCodes");
  } else {
    settings.taxSettings = normalized.taxSettings;
    settings.taxCodes = storedCodes;
  }

  return settings;
};

const ACCOUNTING_DEFAULT_FIELDS = [
  "tenantReceivableAccount",
  "rentIncomeAccount",
  "utilityRechargeIncomeAccount",
  "penaltyIncomeAccount",
  "depositLiabilityAccount",
  "managementCommissionIncomeAccount",
  "leaseAgreementFeeIncomeAccount",
];

const HR_ACCOUNTING_DEFAULT_FIELDS = [
  "salaryExpenseAccount",
  "netPayableAccount",
  "payePayableAccount",
  "nhifPayableAccount",
  "nssfPayableAccount",
  "ahlPayableAccount",
  "otherDeductionsPayableAccount",
  "employerNhifExpenseAccount",
  "employerNssfExpenseAccount",
  "employerAhlExpenseAccount",
];

const INV_ACCOUNTING_DEFAULT_FIELDS = [
  "inventoryAssetAccount",
  "cogsAccount",
  "salesRevenueAccount",
  "stockAdjustmentAccount",
  "purchaseClearingAccount",
];

const DEFAULT_DEPOSIT_TYPES = [
  {
    name: "Security Deposit",
    code: "SECURITY",
    defaultAmount: 0,
    refundable: true,
    description: "Standard refundable tenant security deposit.",
  },
  {
    name: "Water Deposit",
    code: "WATER",
    defaultAmount: 0,
    refundable: true,
    description: "Refundable utility deposit for water services.",
  },
  {
    name: "Electricity Deposit",
    code: "ELECTRICITY",
    defaultAmount: 0,
    refundable: true,
    description: "Refundable utility deposit for electricity services.",
  },
];

const ensureSettingsDocument = async (businessId) => {
  let settings = await findCompanySettings(businessId);
  if (!settings) {
    settings = new CompanySettings({ company: businessId });
  }
  ensureSettingsTaxConfiguration(settings);
  ensureSettingsBillingPeriods(settings);
  return settings;
};

const ensureUniqueCollectionName = ({ items = [], name = "", excludeId = null, label = "Item" }) => {
  const normalizedName = normalizeLower(name);
  if (!normalizedName) return;

  const duplicate = items.find(
    (item) =>
      String(item?._id || "") !== String(excludeId || "") &&
      normalizeLower(item?.name) === normalizedName
  );

  if (duplicate) {
    const error = new Error(`${label} name already exists. Use a different name.`);
    error.statusCode = 400;
    throw error;
  }
};

const archiveEmbeddedSetting = async ({ req, res, next, businessId, itemId, collectionKey, successLabel }) => {
  const settings = await findCompanySettings(businessId);
  if (!settings) {
    return next(createError(404, "Settings not found"));
  }

  const item = settings[collectionKey]?.id(itemId);
  if (!item) {
    return next(createError(404, `${successLabel} not found`));
  }

  item.isActive = false;
  await settings.save();

  return res.status(200).json({
    mode: "archived",
    message: `${successLabel} archived successfully. Historical references stay intact and the setting will no longer be available for new use.`,
    item,
    settings,
  });
};

// Get company settings
export const getCompanySettings = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const cacheKey = String(businessId);
    const cached = settingsCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return res.status(200).json(cached.data);
    }

    let settings = await findCompanySettings(businessId);

    if (!settings) {
      const defaults = buildDefaultTaxConfiguration();
      settings = new CompanySettings({
        company: businessId,
        utilityTypes: [
          { _id: new mongoose.Types.ObjectId(), name: "Electricity", category: "utility" },
          { _id: new mongoose.Types.ObjectId(), name: "Water", category: "utility" },
          { _id: new mongoose.Types.ObjectId(), name: "Garbage", category: "service_charge" },
          { _id: new mongoose.Types.ObjectId(), name: "Security", category: "service_charge" },
        ],
        billingPeriods: DEFAULT_BILLING_PERIODS.map((period) =>
          buildBillingPeriodRecord({
            _id: new mongoose.Types.ObjectId(),
            ...period,
          })
        ),
        commissions: [{ _id: new mongoose.Types.ObjectId(), name: "Default", percentage: 10, applicableTo: "rent" }],
        expenseItems: [
          { _id: new mongoose.Types.ObjectId(), name: "Maintenance", category: "maintenance" },
          { _id: new mongoose.Types.ObjectId(), name: "Cleaning", category: "supplies" },
          { _id: new mongoose.Types.ObjectId(), name: "Repairs", category: "maintenance" },
        ],
        depositTypes: DEFAULT_DEPOSIT_TYPES.map((item) => ({
          _id: new mongoose.Types.ObjectId(),
          ...item,
          isActive: true,
        })),
        taxSettings: defaults.taxSettings,
        taxCodes: defaults.taxCodes,
      });

      await settings.save();
    } else {
      ensureSettingsTaxConfiguration(settings);
      ensureSettingsBillingPeriods(settings);
      if (settings.isModified()) {
        await settings.save();
      }
    }

    const data = settings.toJSON ? settings.toJSON() : settings;
    settingsCache.set(cacheKey, { data, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS });
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
};

export const addUtilityType = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const name = normalizeText(req.body?.name);
    const description = normalizeText(req.body?.description);
    const category = normalizeText(req.body?.category) || "utility";

    if (!name) {
      return next(createError(400, "Utility name is required"));
    }

    const settings = await ensureSettingsDocument(businessId);
    ensureUniqueCollectionName({ items: settings.utilityTypes, name, label: "Utility" });

    const newUtility = {
      _id: new mongoose.Types.ObjectId(),
      name,
      description,
      category,
      isActive: true,
    };

    settings.utilityTypes.push(newUtility);
    await settings.save();

    res.status(201).json({ utility: newUtility, settings, message: "Utility type added successfully" });
  } catch (err) {
    next(err);
  }
};

export const updateUtilityType = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const { utilityId } = req.params;
    const { isActive } = req.body;
    const name = req.body?.name === undefined ? undefined : normalizeText(req.body.name);
    const description = req.body?.description === undefined ? undefined : normalizeText(req.body.description);
    const category = req.body?.category === undefined ? undefined : normalizeText(req.body.category);

    const settings = await findCompanySettings(businessId);
    if (!settings) {
      return next(createError(404, "Settings not found"));
    }

    const utility = settings.utilityTypes.id(utilityId);
    if (!utility) {
      return next(createError(404, "Utility not found"));
    }

    if (name !== undefined) {
      if (!name) {
        return next(createError(400, "Utility name is required"));
      }
      ensureUniqueCollectionName({
        items: settings.utilityTypes,
        name,
        excludeId: utilityId,
        label: "Utility",
      });
      utility.name = name;
    }
    if (description !== undefined) utility.description = description;
    if (category !== undefined) utility.category = category || "utility";
    if (isActive !== undefined) utility.isActive = Boolean(isActive);

    await settings.save();
    res.status(200).json({ utility, settings, message: "Utility type updated successfully" });
  } catch (err) {
    next(err);
  }
};

export const deleteUtilityType = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const { utilityId } = req.params;
    return await archiveEmbeddedSetting({
      req,
      res,
      next,
      businessId,
      itemId: utilityId,
      collectionKey: "utilityTypes",
      successLabel: "Utility",
    });
  } catch (err) {
    next(err);
  }
};

// ─── Unit Types ───────────────────────────────────────────────────────────────

export const getUnitTypes = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const settings = await findCompanySettings(businessId);
    const items = settings?.unitTypes || [];
    res.status(200).json({ unitTypes: items });
  } catch (err) {
    next(err);
  }
};

export const addUnitType = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const name = normalizeText(req.body?.name);
    const description = normalizeText(req.body?.description);
    const category = normalizeText(req.body?.category) || "residential";

    if (!name) {
      return next(createError(400, "Unit type name is required"));
    }

    const settings = await ensureSettingsDocument(businessId);
    ensureUniqueCollectionName({ items: settings.unitTypes, name, label: "Unit type" });

    const newUnitType = {
      _id: new mongoose.Types.ObjectId(),
      name,
      description,
      category,
      isActive: true,
    };

    settings.unitTypes.push(newUnitType);
    await settings.save();

    res.status(201).json({ unitType: newUnitType, settings, message: "Unit type added successfully" });
  } catch (err) {
    next(err);
  }
};

export const updateUnitType = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const { itemId } = req.params;
    const { isActive } = req.body;
    const name = req.body?.name === undefined ? undefined : normalizeText(req.body.name);
    const description = req.body?.description === undefined ? undefined : normalizeText(req.body.description);
    const category = req.body?.category === undefined ? undefined : normalizeText(req.body.category);

    const settings = await findCompanySettings(businessId);
    if (!settings) {
      return next(createError(404, "Settings not found"));
    }

    const unitType = settings.unitTypes.id(itemId);
    if (!unitType) {
      return next(createError(404, "Unit type not found"));
    }

    if (name !== undefined) {
      if (!name) {
        return next(createError(400, "Unit type name is required"));
      }
      ensureUniqueCollectionName({
        items: settings.unitTypes,
        name,
        excludeId: itemId,
        label: "Unit type",
      });
      unitType.name = name;
    }
    if (description !== undefined) unitType.description = description;
    if (category !== undefined) unitType.category = category || "residential";
    if (isActive !== undefined) unitType.isActive = Boolean(isActive);

    await settings.save();
    res.status(200).json({ unitType, settings, message: "Unit type updated successfully" });
  } catch (err) {
    next(err);
  }
};

export const deleteUnitType = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const { itemId } = req.params;
    return await archiveEmbeddedSetting({
      req,
      res,
      next,
      businessId,
      itemId,
      collectionKey: "unitTypes",
      successLabel: "Unit type",
    });
  } catch (err) {
    next(err);
  }
};

// ─── Maintenance Categories ───────────────────────────────────────────────────

export const getMaintenanceCategories = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const settings = await findCompanySettings(businessId);
    const items = settings?.maintenanceCategories || [];
    res.status(200).json({ maintenanceCategories: items });
  } catch (err) {
    next(err);
  }
};

export const addMaintenanceCategory = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const name = normalizeText(req.body?.name);
    const description = normalizeText(req.body?.description);
    const priority = normalizeText(req.body?.priority) || "medium";

    if (!name) {
      return next(createError(400, "Maintenance category name is required"));
    }

    const settings = await ensureSettingsDocument(businessId);
    ensureUniqueCollectionName({ items: settings.maintenanceCategories, name, label: "Maintenance category" });

    const newCategory = {
      _id: new mongoose.Types.ObjectId(),
      name,
      description,
      priority,
      isActive: true,
    };

    settings.maintenanceCategories.push(newCategory);
    await settings.save();

    res.status(201).json({ maintenanceCategory: newCategory, settings, message: "Maintenance category added successfully" });
  } catch (err) {
    next(err);
  }
};

export const updateMaintenanceCategory = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const { itemId } = req.params;
    const { isActive } = req.body;
    const name = req.body?.name === undefined ? undefined : normalizeText(req.body.name);
    const description = req.body?.description === undefined ? undefined : normalizeText(req.body.description);
    const priority = req.body?.priority === undefined ? undefined : normalizeText(req.body.priority);

    const settings = await findCompanySettings(businessId);
    if (!settings) {
      return next(createError(404, "Settings not found"));
    }

    const category = settings.maintenanceCategories.id(itemId);
    if (!category) {
      return next(createError(404, "Maintenance category not found"));
    }

    if (name !== undefined) {
      if (!name) {
        return next(createError(400, "Maintenance category name is required"));
      }
      ensureUniqueCollectionName({
        items: settings.maintenanceCategories,
        name,
        excludeId: itemId,
        label: "Maintenance category",
      });
      category.name = name;
    }
    if (description !== undefined) category.description = description;
    if (priority !== undefined) category.priority = priority || "medium";
    if (isActive !== undefined) category.isActive = Boolean(isActive);

    await settings.save();
    res.status(200).json({ maintenanceCategory: category, settings, message: "Maintenance category updated successfully" });
  } catch (err) {
    next(err);
  }
};

export const deleteMaintenanceCategory = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const { itemId } = req.params;
    return await archiveEmbeddedSetting({
      req,
      res,
      next,
      businessId,
      itemId,
      collectionKey: "maintenanceCategories",
      successLabel: "Maintenance category",
    });
  } catch (err) {
    next(err);
  }
};

export const addBillingPeriod = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const name = normalizeText(req.body?.name);
    const durationInMonths = toNumber(req.body?.durationInMonths, 0);
    const durationInDays = toNumber(req.body?.durationInDays, durationInMonths * 30);

    if (!name || durationInMonths <= 0) {
      return next(createError(400, "Name and duration in months are required"));
    }

    const settings = await ensureSettingsDocument(businessId);
    ensureUniqueCollectionName({ items: settings.billingPeriods, name, label: "Billing period" });

    const newPeriod = buildBillingPeriodRecord({
      _id: new mongoose.Types.ObjectId(),
      key: req.body?.key || name,
      name,
      durationInMonths,
      durationInDays,
      isActive: true,
    });

    const duplicateKey = settings.billingPeriods.find(
      (item) => canonicalizeBillingPeriodKey(item?.key || item?.name) === newPeriod.key
    );
    if (duplicateKey) {
      return next(createError(400, "Billing period key already exists. Use a different name."));
    }

    settings.billingPeriods.push(newPeriod);
    await settings.save();

    res.status(201).json({ period: newPeriod, settings, message: "Billing period added successfully" });
  } catch (err) {
    next(err);
  }
};

export const updateBillingPeriod = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const { periodId } = req.params;
    const settings = await findCompanySettings(businessId);
    if (!settings) {
      return next(createError(404, "Settings not found"));
    }

    ensureSettingsBillingPeriods(settings);

    const period = settings.billingPeriods.id(periodId);
    if (!period) {
      return next(createError(404, "Billing period not found"));
    }

    if (req.body?.name !== undefined) {
      const name = normalizeText(req.body.name);
      if (!name) {
        return next(createError(400, "Billing period name is required"));
      }
      ensureUniqueCollectionName({
        items: settings.billingPeriods,
        name,
        excludeId: periodId,
        label: "Billing period",
      });
      period.name = name;
    }

    if (req.body?.durationInMonths !== undefined) {
      const durationInMonths = toNumber(req.body.durationInMonths, 0);
      if (durationInMonths <= 0) {
        return next(createError(400, "Billing period duration in months must be greater than zero"));
      }
      period.durationInMonths = durationInMonths;
      if (req.body?.durationInDays === undefined) {
        period.durationInDays = durationInMonths * 30;
      }
    }

    if (req.body?.durationInDays !== undefined) {
      period.durationInDays = toNumber(req.body.durationInDays, 0);
    }

    if (req.body?.isActive !== undefined) {
      period.isActive = Boolean(req.body.isActive);
    }

    period.key = canonicalizeBillingPeriodKey(period.key || req.body?.key || period.name);

    const duplicateKey = settings.billingPeriods.find(
      (item) =>
        String(item?._id || "") !== String(periodId || "") &&
        canonicalizeBillingPeriodKey(item?.key || item?.name) === period.key
    );
    if (duplicateKey) {
      return next(createError(400, "Billing period key already exists. Use a different name."));
    }

    await settings.save();
    res.status(200).json({ period, settings, message: "Billing period updated successfully" });
  } catch (err) {
    next(err);
  }
};

export const deleteBillingPeriod = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const { periodId } = req.params;
    return await archiveEmbeddedSetting({
      req,
      res,
      next,
      businessId,
      itemId: periodId,
      collectionKey: "billingPeriods",
      successLabel: "Billing period",
    });
  } catch (err) {
    next(err);
  }
};

export const addExpenseItem = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const name = normalizeText(req.body?.name);
    const description = normalizeText(req.body?.description);
    const code = normalizeText(req.body?.code);
    const category = normalizeText(req.body?.category) || "other";
    const defaultAmount = toNumber(req.body?.defaultAmount, 0);

    if (!name) {
      return next(createError(400, "Expense item name is required"));
    }

    const settings = await ensureSettingsDocument(businessId);
    ensureUniqueCollectionName({ items: settings.expenseItems, name, label: "Expense item" });

    const newExpenseItem = {
      _id: new mongoose.Types.ObjectId(),
      name,
      description,
      code,
      category,
      defaultAmount,
      isActive: true,
    };

    settings.expenseItems.push(newExpenseItem);
    await settings.save();

    res.status(201).json({ expenseItem: newExpenseItem, settings, message: "Expense item added successfully" });
  } catch (err) {
    next(err);
  }
};

export const updateExpenseItem = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const { expenseId } = req.params;
    const settings = await findCompanySettings(businessId);
    if (!settings) {
      return next(createError(404, "Settings not found"));
    }

    const expenseItem = settings.expenseItems.id(expenseId);
    if (!expenseItem) {
      return next(createError(404, "Expense item not found"));
    }

    if (req.body?.name !== undefined) {
      const name = normalizeText(req.body.name);
      if (!name) {
        return next(createError(400, "Expense item name is required"));
      }
      ensureUniqueCollectionName({
        items: settings.expenseItems,
        name,
        excludeId: expenseId,
        label: "Expense item",
      });
      expenseItem.name = name;
    }
    if (req.body?.description !== undefined) expenseItem.description = normalizeText(req.body.description);
    if (req.body?.code !== undefined) expenseItem.code = normalizeText(req.body.code);
    if (req.body?.category !== undefined) expenseItem.category = normalizeText(req.body.category) || "other";
    if (req.body?.defaultAmount !== undefined) expenseItem.defaultAmount = toNumber(req.body.defaultAmount, 0);
    if (req.body?.isActive !== undefined) expenseItem.isActive = Boolean(req.body.isActive);

    await settings.save();
    res.status(200).json({ expenseItem, settings, message: "Expense item updated successfully" });
  } catch (err) {
    next(err);
  }
};

export const deleteExpenseItem = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const { expenseId } = req.params;
    return await archiveEmbeddedSetting({
      req,
      res,
      next,
      businessId,
      itemId: expenseId,
      collectionKey: "expenseItems",
      successLabel: "Expense item",
    });
  } catch (err) {
    next(err);
  }
};

export const addDepositType = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const name = normalizeText(req.body?.name);
    const description = normalizeText(req.body?.description);
    const code = normalizeText(req.body?.code).toUpperCase();
    const defaultAmount = toNumber(req.body?.defaultAmount, 0);
    const refundable = req.body?.refundable === undefined ? true : Boolean(req.body.refundable);

    if (!name) {
      return next(createError(400, "Deposit type name is required"));
    }

    if (defaultAmount < 0) {
      return next(createError(400, "Default deposit amount cannot be negative"));
    }

    const settings = await ensureSettingsDocument(businessId);
    ensureUniqueCollectionName({ items: settings.depositTypes, name, label: "Deposit type" });

    const newDepositType = {
      _id: new mongoose.Types.ObjectId(),
      name,
      description,
      code,
      defaultAmount,
      refundable,
      isActive: true,
    };

    settings.depositTypes.push(newDepositType);
    await settings.save();

    res.status(201).json({ depositType: newDepositType, settings, message: "Deposit type added successfully" });
  } catch (err) {
    next(err);
  }
};

export const updateDepositType = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const { depositTypeId } = req.params;
    const settings = await findCompanySettings(businessId);
    if (!settings) {
      return next(createError(404, "Settings not found"));
    }

    const depositType = settings.depositTypes.id(depositTypeId);
    if (!depositType) {
      return next(createError(404, "Deposit type not found"));
    }

    if (req.body?.name !== undefined) {
      const name = normalizeText(req.body.name);
      if (!name) {
        return next(createError(400, "Deposit type name is required"));
      }
      ensureUniqueCollectionName({
        items: settings.depositTypes,
        name,
        excludeId: depositTypeId,
        label: "Deposit type",
      });
      depositType.name = name;
    }
    if (req.body?.description !== undefined) depositType.description = normalizeText(req.body.description);
    if (req.body?.code !== undefined) depositType.code = normalizeText(req.body.code).toUpperCase();
    if (req.body?.defaultAmount !== undefined) {
      const defaultAmount = toNumber(req.body.defaultAmount, 0);
      if (defaultAmount < 0) {
        return next(createError(400, "Default deposit amount cannot be negative"));
      }
      depositType.defaultAmount = defaultAmount;
    }
    if (req.body?.refundable !== undefined) depositType.refundable = Boolean(req.body.refundable);
    if (req.body?.isActive !== undefined) depositType.isActive = Boolean(req.body.isActive);

    await settings.save();
    res.status(200).json({ depositType, settings, message: "Deposit type updated successfully" });
  } catch (err) {
    next(err);
  }
};

export const deleteDepositType = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const { depositTypeId } = req.params;
    return await archiveEmbeddedSetting({
      req,
      res,
      next,
      businessId,
      itemId: depositTypeId,
      collectionKey: "depositTypes",
      successLabel: "Deposit type",
    });
  } catch (err) {
    next(err);
  }
};

export const updateAccountingDefaults = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    let settings = await findCompanySettings(businessId);
    if (!settings) {
      settings = new CompanySettings({ company: businessId });
      ensureSettingsTaxConfiguration(settings);
    }

    const incomingDefaults = req.body?.accountingDefaults || {};
    const nextDefaults = { ...(settings.accountingDefaults?.toObject?.() || settings.accountingDefaults || {}) };

    for (const field of ACCOUNTING_DEFAULT_FIELDS) {
      if (!(field in incomingDefaults)) continue;
      const account = await validateAccountingDefaultAccount({
        businessId,
        field,
        rawValue: incomingDefaults[field],
      });
      nextDefaults[field] = account?._id || null;
    }

    settings.accountingDefaults = nextDefaults;
    await settings.save();
    await logAuditEvent({
      req,
      company: businessId,
      action: "settings.accounting_defaults.update",
      category: "settings",
      severity: "critical",
      targetType: "CompanySettings",
      targetId: settings._id,
      targetName: "Accounting defaults",
      message: "Updated accounting defaults",
      metadata: { fields: Object.keys(incomingDefaults || {}) },
    });

    return res.status(200).json({
      message: "Accounting defaults updated successfully",
      accountingDefaults: settings.accountingDefaults,
      settings,
    });
  } catch (err) {
    next(err);
  }
};

export const updateHrAccountingDefaults = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    let settings = await findCompanySettings(businessId);
    if (!settings) {
      settings = new CompanySettings({ company: businessId });
      ensureSettingsTaxConfiguration(settings);
    }

    const incomingDefaults = req.body?.hrAccountingDefaults || {};
    const nextDefaults = { ...(settings.hrAccountingDefaults?.toObject?.() || settings.hrAccountingDefaults || {}) };

    for (const field of HR_ACCOUNTING_DEFAULT_FIELDS) {
      if (!(field in incomingDefaults)) continue;
      const account = await validateHrAccountingDefaultAccount({
        businessId,
        field,
        rawValue: incomingDefaults[field],
      });
      nextDefaults[field] = account?._id || null;
    }

    settings.hrAccountingDefaults = nextDefaults;
    await settings.save();
    await logAuditEvent({
      req,
      company: businessId,
      action: "settings.hr_accounting_defaults.update",
      category: "settings",
      severity: "critical",
      targetType: "CompanySettings",
      targetId: settings._id,
      targetName: "HR accounting defaults",
      message: "Updated HR accounting defaults",
      metadata: { fields: Object.keys(incomingDefaults || {}) },
    });

    return res.status(200).json({
      message: "HR accounting defaults updated successfully",
      hrAccountingDefaults: settings.hrAccountingDefaults,
      settings,
    });
  } catch (err) {
    next(err);
  }
};

export const updateInventoryAccountingDefaults = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    let settings = await findCompanySettings(businessId);
    if (!settings) {
      settings = new CompanySettings({ company: businessId });
      ensureSettingsTaxConfiguration(settings);
    }

    const incomingDefaults = req.body?.inventoryAccountingDefaults || {};
    const nextDefaults = { ...(settings.inventoryAccountingDefaults?.toObject?.() || settings.inventoryAccountingDefaults || {}) };

    for (const field of INV_ACCOUNTING_DEFAULT_FIELDS) {
      if (!(field in incomingDefaults)) continue;
      const account = await validateInvAccountingDefaultAccount({
        businessId,
        field,
        rawValue: incomingDefaults[field],
      });
      nextDefaults[field] = account?._id || null;
    }

    settings.inventoryAccountingDefaults = nextDefaults;
    await settings.save();
    await logAuditEvent({
      req,
      company: businessId,
      action: "settings.inventory_accounting_defaults.update",
      category: "settings",
      severity: "critical",
      targetType: "CompanySettings",
      targetId: settings._id,
      targetName: "Inventory accounting defaults",
      message: "Updated inventory accounting defaults",
      metadata: { fields: Object.keys(incomingDefaults || {}) },
    });

    return res.status(200).json({
      message: "Inventory accounting defaults updated successfully",
      inventoryAccountingDefaults: settings.inventoryAccountingDefaults,
      settings,
    });
  } catch (err) {
    next(err);
  }
};

export const updateTaxConfiguration = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    let settings = await findCompanySettings(businessId);
    if (!settings) {
      settings = new CompanySettings({ company: businessId });
    }

    ensureSettingsTaxConfiguration(settings);

    const incomingSettings = req.body?.taxSettings || {};
    const incomingCodes = Array.isArray(req.body?.taxCodes) ? req.body.taxCodes : settings.taxCodes;

    const normalized = normalizeCompanyTaxConfiguration({
      taxSettings: { ...(settings.taxSettings?.toObject?.() || settings.taxSettings || {}), ...incomingSettings },
      taxCodes: incomingCodes,
    });

    validateNormalizedTaxConfiguration(normalized);

    const storedCodes = normalized.taxCodes.map(mapTaxCodeForStorage);

    settings.set("taxSettings", normalized.taxSettings);
    settings.set("taxCodes", storedCodes);
    settings.markModified("taxSettings");
    settings.markModified("taxCodes");

    if (req.body?.mriRate !== undefined) {
      const parsedMriRate = Number(req.body.mriRate);
      if (!Number.isFinite(parsedMriRate) || parsedMriRate < 0 || parsedMriRate > 1) {
        return next(createError(400, "MRI rate must be between 0 and 1 (e.g. 0.075 for 7.5%)."));
      }
      settings.mriRate = parsedMriRate;
    }

    await settings.save();
    await settings.populate?.("accountingDefaults.tenantReceivableAccount accountingDefaults.rentIncomeAccount accountingDefaults.utilityRechargeIncomeAccount accountingDefaults.penaltyIncomeAccount accountingDefaults.depositLiabilityAccount accountingDefaults.managementCommissionIncomeAccount accountingDefaults.leaseAgreementFeeIncomeAccount");
    await logAuditEvent({
      req,
      company: businessId,
      action: "settings.tax.update",
      category: "settings",
      severity: "critical",
      targetType: "CompanySettings",
      targetId: settings._id,
      targetName: "Tax configuration",
      message: "Updated tax configuration",
      metadata: {
        taxEnabled: Boolean(settings.taxSettings?.enabled),
        taxCodeCount: Array.isArray(settings.taxCodes) ? settings.taxCodes.length : 0,
      },
    });

    res.status(200).json({
      message: "Tax configuration updated successfully",
      taxSettings: settings.taxSettings,
      taxCodes: settings.taxCodes,
      mriRate: settings.mriRate,
      settings,
    });
  } catch (err) {
    next(err);
  }
};

export const updateIncomeRules = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    let settings = await findCompanySettings(businessId);
    if (!settings) {
      settings = new CompanySettings({ company: businessId });
    }

    const { latePenaltyBeneficiary } = req.body || {};

    if (latePenaltyBeneficiary !== undefined) {
      if (!["landlord", "manager"].includes(latePenaltyBeneficiary)) {
        return next(createError(400, "latePenaltyBeneficiary must be 'landlord' or 'manager'."));
      }
      settings.set("incomeRules.latePenaltyBeneficiary", latePenaltyBeneficiary);
    }

    settings.markModified("incomeRules");
    await settings.save();
    invalidateSettingsCache(String(businessId));

    res.status(200).json({
      message: "Income rules updated successfully",
      incomeRules: settings.incomeRules,
      settings,
    });
  } catch (err) {
    next(err);
  }
};

export const updateAutoInvoicing = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    let settings = await findCompanySettings(businessId);
    if (!settings) {
      settings = new CompanySettings({ company: businessId });
    }

    const {
      enabled,
      billingDay,
      daysInAdvance,
      notifyTenants,
      notifyChannel,
    } = req.body || {};

    const current = settings.autoInvoicing?.toObject?.() || settings.autoInvoicing || {};

    const merged = {
      ...current,
      ...(enabled !== undefined ? { enabled: Boolean(enabled) } : {}),
      ...(billingDay !== undefined ? { billingDay: Math.max(1, Math.min(28, Number(billingDay) || 1)) } : {}),
      ...(daysInAdvance !== undefined ? { daysInAdvance: Math.max(0, Math.min(14, Number(daysInAdvance) || 0)) } : {}),
      ...(notifyTenants !== undefined ? { notifyTenants: Boolean(notifyTenants) } : {}),
      ...(notifyChannel !== undefined ? { notifyChannel } : {}),
    };

    settings.set("autoInvoicing", merged);
    settings.markModified("autoInvoicing");
    await settings.save();

    invalidateSettingsCache(String(businessId));

    res.status(200).json({
      message: "Auto invoicing settings updated",
      autoInvoicing: settings.autoInvoicing,
    });
  } catch (err) {
    next(err);
  }
};
