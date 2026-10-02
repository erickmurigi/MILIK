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
  deleteReconciliation,
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
router.delete("/:id",    verifyUser, can("delete"), deleteReconciliation);

export default router;
