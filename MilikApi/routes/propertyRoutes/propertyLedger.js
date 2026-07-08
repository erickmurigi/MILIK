import express from "express";
import { verifyUser, requireCompanyModule, GL_ACCESS_MODULES } from "../../controllers/verifyToken.js";
import {
  getPropertyLedgerTrialBalance,
  getPropertyLedgerIncomeStatement,
  getPropertyLedgerBalanceSheet,
  getPropertyLedgerJournalEntries,
} from "../../controllers/propertyController/propertyLedger.js";

const router = express.Router();

router.get("/:propertyId/trial-balance",    verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getPropertyLedgerTrialBalance);
router.get("/:propertyId/income-statement", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getPropertyLedgerIncomeStatement);
router.get("/:propertyId/balance-sheet",    verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getPropertyLedgerBalanceSheet);
router.get("/:propertyId/journals",         verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getPropertyLedgerJournalEntries);

export default router;
