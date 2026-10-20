import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { attachAdvocateScope } from "../middleware/advocateScope.js";
import { createOwnerPayout, getOwnerOutstandingBalance, getOwnerPayout, listOwnerPayouts, voidOwnerPayout } from "../controllers/ownerPayoutsController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"), attachAdvocateScope);
router.get("/", requireCompanyPermission("sale-owners", "view", "propertySale"), listOwnerPayouts);
router.get("/balance/:ownerId", requireCompanyPermission("sale-owners", "view", "propertySale"), getOwnerOutstandingBalance);
router.get("/:id", requireCompanyPermission("sale-owners", "view", "propertySale"), getOwnerPayout);
router.post("/", requireCompanyPermission("sale-owners", "create", "propertySale"), createOwnerPayout);
router.patch("/:id/void", requireCompanyPermission("sale-owners", "update", "propertySale"), voidOwnerPayout);

export default router;
