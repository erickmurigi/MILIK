import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { attachAdvocateScope } from "../middleware/advocateScope.js";
import { getOwnerCommission, listOwnerCommissions, recalculateOwnerCommissionRate, updateOwnerCommissionReleaseScheduleOverride } from "../controllers/ownerCommissionsController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"), attachAdvocateScope);
// Shares the broker commissions permission — same finance audience, same underlying workflow.
router.get("/", requireCompanyPermission("sale-commissions", "view", "propertySale"), listOwnerCommissions);
router.get("/:id", requireCompanyPermission("sale-commissions", "view", "propertySale"), getOwnerCommission);
router.patch("/:id/recalculate", requireCompanyPermission("sale-commissions", "process", "propertySale"), recalculateOwnerCommissionRate);
router.patch("/:id/release-schedule", requireCompanyPermission("sale-commissions", "process", "propertySale"), updateOwnerCommissionReleaseScheduleOverride);

export default router;
