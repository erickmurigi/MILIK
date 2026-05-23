import express from "express";
import { requireCompanyModule, verifyUser, GL_ACCESS_MODULES } from "../../controllers/verifyToken.js";
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

router.get("/accounts",  verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getBankAccounts);
router.get("/entries",   verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getReconciliationEntries);
router.get("/",          verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getReconciliations);
router.post("/",         verifyUser, requireCompanyModule(GL_ACCESS_MODULES), createReconciliation);
router.get("/:id",       verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getReconciliation);
router.put("/:id",       verifyUser, requireCompanyModule(GL_ACCESS_MODULES), updateReconciliation);
router.post("/:id/finalize", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), finalizeReconciliation);
router.delete("/:id",    verifyUser, requireCompanyModule(GL_ACCESS_MODULES), deleteReconciliation);

export default router;
