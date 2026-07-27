import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { getCommission, listCommissions, updateCommissionStatus } from "../controllers/commissionsController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"));
router.get("/", requireCompanyPermission("sale-commissions", "view", "propertySale"), listCommissions);
router.get("/:id", requireCompanyPermission("sale-commissions", "view", "propertySale"), getCommission);
router.patch("/:id/status", requireCompanyPermission("sale-commissions", "process", "propertySale"), updateCommissionStatus);

export default router;
