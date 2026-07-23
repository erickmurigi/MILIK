import express from "express";
import { requireCompanyModule, verifyUser, GL_ACCESS_MODULES } from "../../controllers/verifyToken.js";
import {
  getBalanceSheetReport,
  getCashFlowReport,
  getCashMonthlySummary,
  getIncomeMonthlySummary,
  getIncomeStatementReport,
  getMRITaxSummaryReport,
  getPropertyIncomeSummaryReport,
  getRentalCollectionReport,
  getTenantPaidBalanceReport,
  getTrialBalanceReport,
  getARAgingReport,
  getAPAgingReport,
  getTrialBalanceExceptions,
  getFinancialRatios,
  performYearEndClose,
  getLiabilitySubledger,
} from "../../controllers/propertyController/financialReports.js";

const router = express.Router();

// All financial reports — read-only, accessible to any GL-posting module company
router.get("/trial-balance", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getTrialBalanceReport);
router.get("/income-statement", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getIncomeStatementReport);
router.get("/balance-sheet", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getBalanceSheetReport);
router.get("/cash-flow", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getCashFlowReport);
router.get("/cash-monthly-summary", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getCashMonthlySummary);
router.get("/income-monthly-summary", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getIncomeMonthlySummary);
router.get("/rental-collection", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getRentalCollectionReport);
router.get("/tenant-paid-balance", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getTenantPaidBalanceReport);
router.get("/property-income-summary", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getPropertyIncomeSummaryReport);
router.get("/mri-tax-summary", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getMRITaxSummaryReport);
router.get("/ar-aging", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getARAgingReport);
router.get("/ap-aging", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getAPAgingReport);
router.get("/trial-balance-exceptions", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getTrialBalanceExceptions);
router.get("/financial-ratios", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getFinancialRatios);

router.get("/liability-subledger", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getLiabilitySubledger);

// Year-end close — write operation, requires dedicated accounts module
router.post("/year-end-close", verifyUser, requireCompanyModule("accounts"), performYearEndClose);

export default router;
