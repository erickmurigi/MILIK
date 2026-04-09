import express from "express";
import { verifyUser } from "../../controllers/verifyToken.js";
import {
  createLandlordAdvancement,
  deleteLandlordAdvancement,
  getLandlordAdvancements,
  processLandlordAdvancementRecovery,
  updateLandlordAdvancement,
  updateLandlordAdvancementStatus,
} from "../../controllers/propertyController/landlordAdvancements.js";

const router = express.Router();

router.get("/", verifyUser, getLandlordAdvancements);
router.post("/", verifyUser, createLandlordAdvancement);
router.put("/:id", verifyUser, updateLandlordAdvancement);
router.put("/:id/status", verifyUser, updateLandlordAdvancementStatus);
router.post("/:id/recover", verifyUser, processLandlordAdvancementRecovery);
router.delete("/:id", verifyUser, deleteLandlordAdvancement);

export default router;