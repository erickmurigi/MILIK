import express from "express";
import { requireCompanyModule, verifyUser, GL_ACCESS_MODULES } from "../../controllers/verifyToken.js";
import { getBalanceSheetReport, getIncomeStatementReport, getMRITaxSummaryReport, getPropertyIncomeSummaryReport, getRentalCollectionReport, getTenantPaidBalanceReport, getTrialBalanceReport } from "../../controllers/propertyController/financialReports.js";

const router = express.Router();

// All financial reports are read-only — accessible to any GL-posting module company
router.get("/trial-balance", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getTrialBalanceReport);
router.get("/income-statement", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getIncomeStatementReport);
router.get("/balance-sheet", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getBalanceSheetReport);
router.get("/rental-collection", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getRentalCollectionReport);
router.get("/tenant-paid-balance", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getTenantPaidBalanceReport);
router.get("/property-income-summary", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getPropertyIncomeSummaryReport);
router.get("/mri-tax-summary", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getMRITaxSummaryReport);

export default router;
