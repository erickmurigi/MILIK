import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { attachAdvocateScope } from "../middleware/advocateScope.js";
import { createAdvocate, deleteAdvocate, getAdvocate, listAdvocates, reconcileTrust, updateAdvocate } from "../controllers/advocatesController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"), attachAdvocateScope);
router.get("/", requireCompanyPermission("sale-advocates", "view", "propertySale"), listAdvocates);
router.get("/:id", requireCompanyPermission("sale-advocates", "view", "propertySale"), getAdvocate);
router.post("/", requireCompanyPermission("sale-advocates", "create", "propertySale"), createAdvocate);
router.put("/:id", requireCompanyPermission("sale-advocates", "update", "propertySale"), updateAdvocate);
router.post("/:id/reconcile-trust", requireCompanyPermission("sale-advocates", "manage", "propertySale"), reconcileTrust);
router.delete("/:id", requireCompanyPermission("sale-advocates", "update", "propertySale"), deleteAdvocate);

export default router;
