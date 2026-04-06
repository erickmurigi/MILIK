import express from "express";
import { requireCompanyModule, verifyUser } from "../../controllers/verifyToken.js";
import { getBalanceSheetReport, getIncomeStatementReport, getRentalCollectionReport, getTenantPaidBalanceReport, getTrialBalanceReport } from "../../controllers/propertyController/financialReports.js";

const router = express.Router();

router.get("/trial-balance", verifyUser, requireCompanyModule("accounts"), getTrialBalanceReport);
router.get("/income-statement", verifyUser, requireCompanyModule("accounts"), getIncomeStatementReport);
router.get("/balance-sheet", verifyUser, requireCompanyModule("accounts"), getBalanceSheetReport);
router.get("/rental-collection", verifyUser, requireCompanyModule("accounts"), getRentalCollectionReport);
router.get("/tenant-paid-balance", verifyUser, requireCompanyModule("accounts"), getTenantPaidBalanceReport);

export default router;
