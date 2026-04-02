import CompanySettings from "../../models/CompanySettings.js";
import mongoose from "mongoose";
import { DEFAULT_TAX_CODES, DEFAULT_TAX_SETTINGS, normalizeCompanyTaxConfiguration } from "../../services/taxCalculationService.js";

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
  settings.taxSettings = normalized.taxSettings;
  settings.taxCodes = normalized.taxCodes.map((code) => ({
    _id: code._id || new mongoose.Types.ObjectId(),
    key: code.key,
    name: code.name,
    type: code.type,
    rate: Number(code.rate || 0),
    isDefault: Boolean(code.isDefault),
    isActive: code.isActive !== false,
    description: code.description || "",
  }));

  return settings;
};


// Get company settings
export const getCompanySettings = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);

    let settings = await findCompanySettings(businessId);

    // If no settings exist, create default ones
    if (!settings) {
      const defaults = buildDefaultTaxConfiguration();
      settings = new CompanySettings({
        company: businessId,
        utilityTypes: [
          { name: "Electricity", category: "utility" },
          { name: "Water", category: "utility" },
          { name: "Garbage", category: "service_charge" },
          { name: "Security", category: "service_charge" },
        ],
        billingPeriods: [
          { name: "Monthly", durationInMonths: 1, durationInDays: 30 },
          { name: "Quarterly", durationInMonths: 3, durationInDays: 90 },
          { name: "Semi-Annual", durationInMonths: 6, durationInDays: 180 },
          { name: "Annual", durationInMonths: 12, durationInDays: 365 },
        ],
        commissions: [
          { name: "Default", percentage: 10, applicableTo: "rent" },
        ],
        expenseItems: [
          { name: "Maintenance", category: "maintenance" },
          { name: "Cleaning", category: "supplies" },
          { name: "Repairs", category: "maintenance" },
        ],
        taxSettings: defaults.taxSettings,
        taxCodes: defaults.taxCodes,
      });

      await settings.save();
    } else {
      ensureSettingsTaxConfiguration(settings);
      if (settings.isModified()) {
        await settings.save();
      }
    }

    res.status(200).json(settings);
  } catch (err) {
    next(err);
  }
};

// Update utility type
export const addUtilityType = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const { name, description, category } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Utility name is required" });
    }

    let settings = await findCompanySettings(businessId);
    if (!settings) {
      settings = new CompanySettings({ company: businessId });
    }

    const newUtility = {
      _id: new mongoose.Types.ObjectId(),
      name,
      description: description || "",
      category: category || "utility",
      isActive: true,
    };

    settings.utilityTypes.push(newUtility);
    await settings.save();

    res.status(201).json({ utility: newUtility, message: "Utility type added successfully" });
  } catch (err) {
    next(err);
  }
};

// Update utility type
export const updateUtilityType = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const { utilityId } = req.params;
    const { name, description, category, isActive } = req.body;

    const settings = await findCompanySettings(businessId);
    if (!settings) {
      return res.status(404).json({ message: "Settings not found" });
    }

    const utility = settings.utilityTypes.id(utilityId);
    if (!utility) {
      return res.status(404).json({ message: "Utility not found" });
    }

    if (name) utility.name = name;
    if (description !== undefined) utility.description = description;
    if (category) utility.category = category;
    if (isActive !== undefined) utility.isActive = isActive;

    await settings.save();
    res.status(200).json({ utility, message: "Utility type updated successfully" });
  } catch (err) {
    next(err);
  }
};

// Delete utility type
export const deleteUtilityType = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const { utilityId } = req.params;

    const settings = await findCompanySettings(businessId);
    if (!settings) {
      return res.status(404).json({ message: "Settings not found" });
    }

    settings.utilityTypes.id(utilityId).deleteOne();
    await settings.save();

    res.status(200).json({ message: "Utility type deleted successfully" });
  } catch (err) {
    next(err);
  }
};

// Add billing period
export const addBillingPeriod = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const { name, durationInMonths, durationInDays } = req.body;

    if (!name || !durationInMonths) {
      return res.status(400).json({ message: "Name and duration are required" });
    }

    let settings = await findCompanySettings(businessId);
    if (!settings) {
      settings = new CompanySettings({ company: businessId });
    }

    const newPeriod = {
      _id: new mongoose.Types.ObjectId(),
      name,
      durationInMonths,
      durationInDays: durationInDays || durationInMonths * 30,
      isActive: true,
    };

    settings.billingPeriods.push(newPeriod);
    await settings.save();

    res.status(201).json({ period: newPeriod, message: "Billing period added successfully" });
  } catch (err) {
    next(err);
  }
};

// Update billing period
export const updateBillingPeriod = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const { periodId } = req.params;
    const { name, durationInMonths, durationInDays, isActive } = req.body;

    const settings = await findCompanySettings(businessId);
    if (!settings) {
      return res.status(404).json({ message: "Settings not found" });
    }

    const period = settings.billingPeriods.id(periodId);
    if (!period) {
      return res.status(404).json({ message: "Billing period not found" });
    }

    if (name) period.name = name;
    if (durationInMonths !== undefined) period.durationInMonths = durationInMonths;
    if (durationInDays !== undefined) period.durationInDays = durationInDays;
    if (isActive !== undefined) period.isActive = isActive;

    await settings.save();
    res.status(200).json({ period, message: "Billing period updated successfully" });
  } catch (err) {
    next(err);
  }
};

// Delete billing period
export const deleteBillingPeriod = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const { periodId } = req.params;

    const settings = await findCompanySettings(businessId);
    if (!settings) {
      return res.status(404).json({ message: "Settings not found" });
    }

    settings.billingPeriods.id(periodId).deleteOne();
    await settings.save();

    res.status(200).json({ message: "Billing period deleted successfully" });
  } catch (err) {
    next(err);
  }
};

// Add commission
export const addCommission = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const { name, percentage, applicableTo, description } = req.body;

    if (!name || percentage === undefined) {
      return res.status(400).json({ message: "Name and percentage are required" });
    }

    let settings = await findCompanySettings(businessId);
    if (!settings) {
      settings = new CompanySettings({ company: businessId });
    }

    const newCommission = {
      _id: new mongoose.Types.ObjectId(),
      name,
      percentage,
      applicableTo: applicableTo || "rent",
      description: description || "",
      isActive: true,
    };

    settings.commissions.push(newCommission);
    await settings.save();

    res.status(201).json({ commission: newCommission, message: "Commission added successfully" });
  } catch (err) {
    next(err);
  }
};

// Update commission
export const updateCommission = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const { commissionId } = req.params;
    const { name, percentage, applicableTo, description, isActive } = req.body;

    const settings = await findCompanySettings(businessId);
    if (!settings) {
      return res.status(404).json({ message: "Settings not found" });
    }

    const commission = settings.commissions.id(commissionId);
    if (!commission) {
      return res.status(404).json({ message: "Commission not found" });
    }

    if (name) commission.name = name;
    if (percentage !== undefined) commission.percentage = percentage;
    if (applicableTo) commission.applicableTo = applicableTo;
    if (description !== undefined) commission.description = description;
    if (isActive !== undefined) commission.isActive = isActive;

    await settings.save();
    res.status(200).json({ commission, message: "Commission updated successfully" });
  } catch (err) {
    next(err);
  }
};

// Delete commission
export const deleteCommission = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const { commissionId } = req.params;

    const settings = await findCompanySettings(businessId);
    if (!settings) {
      return res.status(404).json({ message: "Settings not found" });
    }

    settings.commissions.id(commissionId).deleteOne();
    await settings.save();

    res.status(200).json({ message: "Commission deleted successfully" });
  } catch (err) {
    next(err);
  }
};

// Add expense item
export const addExpenseItem = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const { name, description, code, category, defaultAmount } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Expense item name is required" });
    }

    let settings = await findCompanySettings(businessId);
    if (!settings) {
      settings = new CompanySettings({ company: businessId });
    }

    const newExpenseItem = {
      _id: new mongoose.Types.ObjectId(),
      name,
      description: description || "",
      code: code || "",
      category: category || "other",
      defaultAmount: defaultAmount || 0,
      isActive: true,
    };

    settings.expenseItems.push(newExpenseItem);
    await settings.save();

    res.status(201).json({ expenseItem: newExpenseItem, message: "Expense item added successfully" });
  } catch (err) {
    next(err);
  }
};

// Update expense item
export const updateExpenseItem = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const { expenseId } = req.params;
    const { name, description, code, category, defaultAmount, isActive } = req.body;

    const settings = await findCompanySettings(businessId);
    if (!settings) {
      return res.status(404).json({ message: "Settings not found" });
    }

    const expenseItem = settings.expenseItems.id(expenseId);
    if (!expenseItem) {
      return res.status(404).json({ message: "Expense item not found" });
    }

    if (name) expenseItem.name = name;
    if (description !== undefined) expenseItem.description = description;
    if (code) expenseItem.code = code;
    if (category) expenseItem.category = category;
    if (defaultAmount !== undefined) expenseItem.defaultAmount = defaultAmount;
    if (isActive !== undefined) expenseItem.isActive = isActive;

    await settings.save();
    res.status(200).json({ expenseItem, message: "Expense item updated successfully" });
  } catch (err) {
    next(err);
  }
};

// Delete expense item
export const deleteExpenseItem = async (req, res, next) => {
  try {
    const businessId = resolveAuthorizedBusinessId(req);
    const { expenseId } = req.params;

    const settings = await findCompanySettings(businessId);
    if (!settings) {
      return res.status(404).json({ message: "Settings not found" });
    }

    settings.expenseItems.id(expenseId).deleteOne();
    await settings.save();

    res.status(200).json({ message: "Expense item deleted successfully" });
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
      taxSettings: { ...settings.taxSettings?.toObject?.() || settings.taxSettings || {}, ...incomingSettings },
      taxCodes: incomingCodes,
    });

    settings.taxSettings = normalized.taxSettings;
    settings.taxCodes = normalized.taxCodes.map((code) => ({
      _id: code._id || new mongoose.Types.ObjectId(),
      key: code.key,
      name: code.name,
      type: code.type,
      rate: Number(code.rate || 0),
      isDefault: Boolean(code.isDefault),
      isActive: code.isActive !== false,
      description: code.description || "",
    }));

    await settings.save();

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
