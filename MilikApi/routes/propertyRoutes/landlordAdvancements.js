import express from "express";
import { requireCompanyPermission, verifyUser } from "../../controllers/verifyToken.js";
import {
  cancelLandlordAdvancementRecovery,
  createLandlordAdvancement,
  deleteLandlordAdvancement,
  getLandlordAdvancements,
  processLandlordAdvancementRecovery,
  updateLandlordAdvancement,
  updateLandlordAdvancementStatus,
} from "../../controllers/propertyController/landlordAdvancements.js";

const router = express.Router();

const can = (action) => requireCompanyPermission("landlordAdvancements", action, "accounts");

router.get("/", verifyUser, can("view"), getLandlordAdvancements);
router.post("/", verifyUser, can("create"), createLandlordAdvancement);
router.put("/:id", verifyUser, can("update"), updateLandlordAdvancement);
router.put("/:id/status", verifyUser, can("update"), updateLandlordAdvancementStatus);
router.post("/:id/recover", verifyUser, can("process"), processLandlordAdvancementRecovery);
router.post("/:id/recoveries/:recoveryId/cancel", verifyUser, can("reverse"), cancelLandlordAdvancementRecovery);
router.delete("/:id", verifyUser, can("delete"), deleteLandlordAdvancement);

export default router;