import express from "express";
import {
  getCompanySettings,
  invalidateSettingsCache,
  addUtilityType,
  updateUtilityType,
  deleteUtilityType,
  addBillingPeriod,
  updateBillingPeriod,
  deleteBillingPeriod,
  addCommission,
  updateCommission,
  deleteCommission,
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
} from "../controllers/propertyController/companySettings.js";
import { processAutoRentInvoices } from "../services/autoRentInvoicingService.js";
import { verifyUser } from "../controllers/verifyToken.js";

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

// Billing Periods
router.post("/:businessId/periods", verifyUser, addBillingPeriod);
router.put("/:businessId/periods/:periodId", verifyUser, updateBillingPeriod);
router.delete("/:businessId/periods/:periodId", verifyUser, deleteBillingPeriod);

// Commissions
router.post("/:businessId/commissions", verifyUser, addCommission);
router.put("/:businessId/commissions/:commissionId", verifyUser, updateCommission);
router.delete("/:businessId/commissions/:commissionId", verifyUser, deleteCommission);

// Tax Configuration
router.put("/:businessId/tax-configuration", verifyUser, updateTaxConfiguration);

// Accounting Defaults
router.put("/:businessId/accounting-defaults", verifyUser, updateAccountingDefaults);

// HR Accounting Defaults
router.put("/:businessId/hr-accounting-defaults", verifyUser, updateHrAccountingDefaults);

// Inventory Accounting Defaults
router.put("/:businessId/inventory-accounting-defaults", verifyUser, updateInventoryAccountingDefaults);

// Expense Items
router.post("/:businessId/expenses", verifyUser, addExpenseItem);
router.put("/:businessId/expenses/:expenseId", verifyUser, updateExpenseItem);
router.delete("/:businessId/expenses/:expenseId", verifyUser, deleteExpenseItem);

// Deposit Types
router.post("/:businessId/deposits", verifyUser, addDepositType);
router.put("/:businessId/deposits/:depositTypeId", verifyUser, updateDepositType);
router.delete("/:businessId/deposits/:depositTypeId", verifyUser, deleteDepositType);

// Income Rules
router.put("/:businessId/income-rules", verifyUser, updateIncomeRules);

// Auto Invoicing
router.put("/:businessId/auto-invoicing", verifyUser, updateAutoInvoicing);
router.post("/:businessId/auto-invoicing/trigger", verifyUser, async (req, res) => {
  try {
    const businessId = req.params.businessId;
    const today = req.body?.date ? new Date(req.body.date) : new Date();
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
