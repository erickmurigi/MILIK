import express from "express";
import { requireCompanyModule, verifyUser } from "../../controllers/verifyToken.js";
import { getBalanceSheetReport, getIncomeStatementReport, getTrialBalanceReport } from "../../controllers/propertyController/financialReports.js";

const router = express.Router();

router.get("/trial-balance", verifyUser, requireCompanyModule("accounts"), getTrialBalanceReport);
router.get("/income-statement", verifyUser, requireCompanyModule("accounts"), getIncomeStatementReport);
router.get("/balance-sheet", verifyUser, requireCompanyModule("accounts"), getBalanceSheetReport);

export default router;
