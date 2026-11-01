import express from "express";
import { requireCompanyPermission, requireCompanyModule, verifyUser, GL_ACCESS_MODULES } from "../../controllers/verifyToken.js";
import { createCostCentre, deleteCostCentre, listCostCentres, updateCostCentre } from "../../controllers/propertyController/costCentres.js";

const router = express.Router();

// Any company with ledger access can read the list (it's what the journal-line tag dropdown and the
// Profit by Tag report both need); only "accounts" permission can add/edit/remove entries.
router.get("/", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), listCostCentres);
router.post("/", verifyUser, requireCompanyPermission("costCentres", "create", "accounts"), createCostCentre);
router.put("/:id", verifyUser, requireCompanyPermission("costCentres", "update", "accounts"), updateCostCentre);
router.delete("/:id", verifyUser, requireCompanyPermission("costCentres", "delete", "accounts"), deleteCostCentre);

export default router;
