import CompanySettings from "../../models/CompanySettings.js";
import mongoose from "mongoose";
import {
  validateAccountingDefaultAccount,
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

const archiveEmbeddedSetting = async ({ req, res, businessId, itemId, collectionKey, successLabel }) => {
  const settings = await findCompanySettings(businessId);
  if (!settings) {
    return res.status(404).json({ message: "Settings not found" });
  }

  const item = settings[collectionKey]?.id(itemId);
  if (!item) {
    return res.status(404).json({ message: `${successLabel} not found` });
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

    res.status(200).json(settings);
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
      return res.status(400).json({ message: "Utility name is required" });
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
      return res.status(404).json({ message: "Settings not found" });
    }

    const utility = settings.utilityTypes.id(utilityId);
    if (!utility) {
      return res.status(404).json({ message: "Utility not found" });
    }

    if (name !== undefined) {
      if (!name) {
        return res.status(400).json({ message: "Utility name is required" });
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
      businessId,
      itemId: utilityId,
      collectionKey: "utilityTypes",
      successLabel: "Utility",
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
      return res.status(400).json({ message: "Name and duration in months are required" });
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
      return res.status(400).json({ message: "Billing period key already exists. Use a different name." });
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
      return res.status(404).json({ message: "Settings not found" });
    }

    ensureSettingsBillingPeriods(settings);

    const period = settings.billingPeriods.id(periodId);
    if (!period) {
      return res.status(404).json({ message: "Billing period not found" });
    }

    if (req.body?.name !== undefined) {
      const name = normalizeText(req.body.name);
      if (!name) {
        return res.status(400).json({ message: "Billing period name is required" });
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
        return res.status(400).json({ message: "Billing period duration in months must be greater than zero" });
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
      return res.status(400).json({ message: "Billing period key already exists. Use a different name." });
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
      businessId,
      itemId: periodId,
      collectionKey: "billingPeriods",
      successLabel: "Billing period",
    });
  } catch (err) {
    next(err);
  }
};

export const addCommission = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const name = normalizeText(req.body?.name);
    const percentage = toNumber(req.body?.percentage, NaN);
    const applicableTo = normalizeText(req.body?.applicableTo) || "rent";
    const description = normalizeText(req.body?.description);

    if (!name || Number.isNaN(percentage)) {
      return res.status(400).json({ message: "Name and percentage are required" });
    }

    const settings = await ensureSettingsDocument(businessId);
    ensureUniqueCollectionName({ items: settings.commissions, name, label: "Commission" });

    const newCommission = {
      _id: new mongoose.Types.ObjectId(),
      name,
      percentage,
      applicableTo,
      description,
      isActive: true,
    };

    settings.commissions.push(newCommission);
    await settings.save();

    res.status(201).json({ commission: newCommission, settings, message: "Commission added successfully" });
  } catch (err) {
    next(err);
  }
};

export const updateCommission = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const { commissionId } = req.params;
    const settings = await findCompanySettings(businessId);
    if (!settings) {
      return res.status(404).json({ message: "Settings not found" });
    }

    const commission = settings.commissions.id(commissionId);
    if (!commission) {
      return res.status(404).json({ message: "Commission not found" });
    }

    if (req.body?.name !== undefined) {
      const name = normalizeText(req.body.name);
      if (!name) {
        return res.status(400).json({ message: "Commission name is required" });
      }
      ensureUniqueCollectionName({
        items: settings.commissions,
        name,
        excludeId: commissionId,
        label: "Commission",
      });
      commission.name = name;
    }
    if (req.body?.percentage !== undefined) commission.percentage = toNumber(req.body.percentage, 0);
    if (req.body?.applicableTo !== undefined) commission.applicableTo = normalizeText(req.body.applicableTo) || "rent";
    if (req.body?.description !== undefined) commission.description = normalizeText(req.body.description);
    if (req.body?.isActive !== undefined) commission.isActive = Boolean(req.body.isActive);

    await settings.save();
    res.status(200).json({ commission, settings, message: "Commission updated successfully" });
  } catch (err) {
    next(err);
  }
};

export const deleteCommission = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const { commissionId } = req.params;
    return await archiveEmbeddedSetting({
      req,
      res,
      businessId,
      itemId: commissionId,
      collectionKey: "commissions",
      successLabel: "Commission",
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
      return res.status(400).json({ message: "Expense item name is required" });
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
      return res.status(404).json({ message: "Settings not found" });
    }

    const expenseItem = settings.expenseItems.id(expenseId);
    if (!expenseItem) {
      return res.status(404).json({ message: "Expense item not found" });
    }

    if (req.body?.name !== undefined) {
      const name = normalizeText(req.body.name);
      if (!name) {
        return res.status(400).json({ message: "Expense item name is required" });
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
      businessId,
      itemId: expenseId,
      collectionKey: "expenseItems",
      successLabel: "Expense item",
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

    return res.status(200).json({
      message: "Accounting defaults updated successfully",
      accountingDefaults: settings.accountingDefaults,
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

    await settings.save();
    await settings.populate?.("accountingDefaults.tenantReceivableAccount accountingDefaults.rentIncomeAccount accountingDefaults.utilityRechargeIncomeAccount accountingDefaults.penaltyIncomeAccount accountingDefaults.depositLiabilityAccount accountingDefaults.managementCommissionIncomeAccount");

    res.status(200).json({
      message: "Tax configuration updated successfully",
      taxSettings: settings.taxSettings,
      taxCodes: settings.taxCodes,
      settings,
    });
  } catch (err) {
    next(err);
  }
};
