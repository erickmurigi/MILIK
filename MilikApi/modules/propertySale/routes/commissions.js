import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { getCommission, listCommissionPayoutEvents, listCommissions, recalculateCommissionRate, updateCommissionReleaseScheduleOverride, updateCommissionStatus } from "../controllers/commissionsController.js";
import { attachAgentScope } from "../middleware/agentScope.js";
import { attachAdvocateScope } from "../middleware/advocateScope.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"), attachAgentScope, attachAdvocateScope);
router.get("/", requireCompanyPermission("sale-commissions", "view", "propertySale"), listCommissions);
// Must come before "/:id" — otherwise Express would treat "payouts" as an :id.
router.get("/payouts", requireCompanyPermission("sale-commissions", "view", "propertySale"), listCommissionPayoutEvents);
router.get("/:id", requireCompanyPermission("sale-commissions", "view", "propertySale"), getCommission);
router.patch("/:id/status", requireCompanyPermission("sale-commissions", "process", "propertySale"), updateCommissionStatus);
router.patch("/:id/recalculate", requireCompanyPermission("sale-commissions", "process", "propertySale"), recalculateCommissionRate);
router.patch("/:id/release-schedule", requireCompanyPermission("sale-commissions", "process", "propertySale"), updateCommissionReleaseScheduleOverride);

export default router;
