import express from "express";
import {
  getCompanySettings,
  invalidateSettingsCache,
  addUtilityType,
  updateUtilityType,
  deleteUtilityType,
  getUnitTypes,
  addUnitType,
  updateUnitType,
  deleteUnitType,
  getMaintenanceCategories,
  addMaintenanceCategory,
  updateMaintenanceCategory,
  deleteMaintenanceCategory,
  addBillingPeriod,
  updateBillingPeriod,
  deleteBillingPeriod,
  addExpenseItem,
  updateExpenseItem,
  deleteExpenseItem,
  addDepositType,
  updateDepositType,
  deleteDepositType,
  updateAccountingDefaults,
  updateHrAccountingDefaults,
  updateInventoryAccountingDefaults,
  updateTaxConfiguration,
  updateAutoInvoicing,
  updateIncomeRules,
  updateTerminology,
} from "../controllers/propertyController/companySettings.js";
import { processAutoRentInvoices } from "../services/autoRentInvoicingService.js";
import { verifyUser, verifySetupAccess } from "../controllers/verifyToken.js";

const router = express.Router();

// Invalidate the in-memory cache after any successful mutation
router.use((req, res, next) => {
  if (req.method !== "GET") {
    const businessId = req.params.businessId;
    res.on("finish", () => {
      if (res.statusCode < 400 && businessId) invalidateSettingsCache(businessId);
    });
  }
  next();
});

// Get company settings
router.get("/:businessId", verifyUser, getCompanySettings);

// Utility Types
router.post("/:businessId/utilities", verifyUser, addUtilityType);
router.put("/:businessId/utilities/:utilityId", verifyUser, updateUtilityType);
router.delete("/:businessId/utilities/:utilityId", verifyUser, deleteUtilityType);

// Unit Types
router.get("/:businessId/unit-types", verifyUser, getUnitTypes);
router.post("/:businessId/unit-types", verifyUser, addUnitType);
router.put("/:businessId/unit-types/:itemId", verifyUser, updateUnitType);
router.delete("/:businessId/unit-types/:itemId", verifyUser, deleteUnitType);

// Maintenance Categories
router.get("/:businessId/maintenance-categories", verifyUser, getMaintenanceCategories);
router.post("/:businessId/maintenance-categories", verifyUser, addMaintenanceCategory);
router.put("/:businessId/maintenance-categories/:itemId", verifyUser, updateMaintenanceCategory);
router.delete("/:businessId/maintenance-categories/:itemId", verifyUser, deleteMaintenanceCategory);

// Billing Periods — setup/admin only
router.post("/:businessId/periods", verifySetupAccess, addBillingPeriod);
router.put("/:businessId/periods/:periodId", verifySetupAccess, updateBillingPeriod);
router.delete("/:businessId/periods/:periodId", verifySetupAccess, deleteBillingPeriod);

// Tax Configuration — setup/admin only
router.put("/:businessId/tax-configuration", verifySetupAccess, updateTaxConfiguration);

// Accounting Defaults — setup/admin only
router.put("/:businessId/accounting-defaults", verifySetupAccess, updateAccountingDefaults);

// HR Accounting Defaults — setup/admin only
router.put("/:businessId/hr-accounting-defaults", verifySetupAccess, updateHrAccountingDefaults);

// Inventory Accounting Defaults — setup/admin only
router.put("/:businessId/inventory-accounting-defaults", verifySetupAccess, updateInventoryAccountingDefaults);

// Expense Items — setup/admin only
router.post("/:businessId/expenses", verifySetupAccess, addExpenseItem);
router.put("/:businessId/expenses/:expenseId", verifySetupAccess, updateExpenseItem);
router.delete("/:businessId/expenses/:expenseId", verifySetupAccess, deleteExpenseItem);

// Deposit Types — setup/admin only
router.post("/:businessId/deposits", verifySetupAccess, addDepositType);
router.put("/:businessId/deposits/:depositTypeId", verifySetupAccess, updateDepositType);
router.delete("/:businessId/deposits/:depositTypeId", verifySetupAccess, deleteDepositType);

// Income Rules — setup/admin only
router.put("/:businessId/income-rules", verifySetupAccess, updateIncomeRules);

// Terminology — setup/admin only
router.patch("/:businessId/terminology", verifySetupAccess, updateTerminology);

// Auto Invoicing — setup/admin only
router.put("/:businessId/auto-invoicing", verifySetupAccess, updateAutoInvoicing);
router.post("/:businessId/auto-invoicing/trigger", verifySetupAccess, async (req, res) => {
  try {
    const businessId = req.params.businessId;
    let today = new Date();
    if (req.body?.date) {
      today = new Date(req.body.date);
      if (isNaN(today.getTime())) {
        return res.status(400).json({ message: "Invalid date supplied. Use an ISO 8601 date string (e.g. 2026-08-31)." });
      }
    }
    const results = await processAutoRentInvoices(businessId, today, { forceRun: true, triggeredBy: "manual" });
    const summary = results[0] || { created: 0, skipped: 0, errors: [] };
    res.status(200).json({
      message: `Auto invoicing run complete: created ${summary.created}, skipped ${summary.skipped}`,
      ...summary,
    });
  } catch (err) {
    res.status(500).json({ message: err?.message || "Auto invoicing trigger failed" });
  }
});

export default router;
