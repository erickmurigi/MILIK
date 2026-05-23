import express from "express";
import { requireCompanyModule, verifyUser, GL_ACCESS_MODULES } from "../../controllers/verifyToken.js";
import { getBalanceSheetReport, getCashFlowReport, getIncomeStatementReport, getMRITaxSummaryReport, getPropertyIncomeSummaryReport, getRentalCollectionReport, getTenantPaidBalanceReport, getTrialBalanceReport, getARAgingReport, getAPAgingReport } from "../../controllers/propertyController/financialReports.js";

const router = express.Router();

// All financial reports are read-only — accessible to any GL-posting module company
router.get("/trial-balance", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getTrialBalanceReport);
router.get("/income-statement", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getIncomeStatementReport);
router.get("/balance-sheet", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getBalanceSheetReport);
router.get("/cash-flow",    verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getCashFlowReport);
router.get("/rental-collection", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getRentalCollectionReport);
router.get("/tenant-paid-balance", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getTenantPaidBalanceReport);
router.get("/property-income-summary", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getPropertyIncomeSummaryReport);
router.get("/mri-tax-summary", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getMRITaxSummaryReport);
router.get("/ar-aging",        verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getARAgingReport);
router.get("/ap-aging",        verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getAPAgingReport);

export default router;
