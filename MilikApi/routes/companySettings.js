import express from "express";
import {
  getCompanySettings,
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
  updateTaxConfiguration,
} from "../controllers/propertyController/companySettings.js";
import { verifyUser } from "../controllers/verifyToken.js";

const router = express.Router();

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

// Expense Items
router.post("/:businessId/expenses", verifyUser, addExpenseItem);
router.put("/:businessId/expenses/:expenseId", verifyUser, updateExpenseItem);
router.delete("/:businessId/expenses/:expenseId", verifyUser, deleteExpenseItem);

export default router;
