import express from "express";
import { requireCompanyModule, requireCompanyPermission, verifyUser, GL_ACCESS_MODULES } from "../../controllers/verifyToken.js";
import {
  getBankAccounts,
  getReconciliationEntries,
  getReconciliations,
  getReconciliation,
  createReconciliation,
  updateReconciliation,
  finalizeReconciliation,
  reopenReconciliation,
  deleteReconciliation,
  importStatementLines,
  listStatementLines,
  matchStatementLine,
  unmatchStatementLine,
  createTransactionFromStatementLine,
} from "../../controllers/propertyController/bankReconciliation.js";

const router = express.Router();

const can = (action) => requireCompanyPermission("bankReconciliation", action, "accounts");

router.get("/accounts",  verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getBankAccounts);
router.get("/entries",   verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getReconciliationEntries);
router.get("/",          verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getReconciliations);
router.get("/:id",       verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getReconciliation);
router.post("/",         verifyUser, can("create"), createReconciliation);
router.put("/:id",       verifyUser, can("update"), updateReconciliation);
router.post("/:id/finalize", verifyUser, can("process"), finalizeReconciliation);
router.post("/:id/reopen",   verifyUser, can("reopen"),  reopenReconciliation);
router.delete("/:id",    verifyUser, can("delete"), deleteReconciliation);

router.post("/:id/statement-lines",                   verifyUser, can("update"), importStatementLines);
router.get("/:id/statement-lines",                    verifyUser, requireCompanyModule(GL_ACCESS_MODULES), listStatementLines);
router.post("/:id/statement-lines/:lineId/match",     verifyUser, can("update"), matchStatementLine);
router.post("/:id/statement-lines/:lineId/unmatch",   verifyUser, can("update"), unmatchStatementLine);
router.post("/:id/statement-lines/:lineId/create-transaction", verifyUser, can("update"), createTransactionFromStatementLine);

export default router;
