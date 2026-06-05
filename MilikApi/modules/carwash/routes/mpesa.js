import express from "express";
import { confirmCarWashCallback, validateCarWashCallback, listMpesaNotifications, reassignMpesaNotification } from "../controllers/mpesaCallbackController.js";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";

const router = express.Router();

// Authenticated — admin views notification log
router.get(
  "/notifications",
  verifyUser,
  requireCompanyModule("carwash"),
  requireCompanyPermission("carwash-payments", "view", "carwash"),
  listMpesaNotifications
);

// Authenticated — reassign a wrong/unmatched notification to the correct job
router.patch(
  "/notifications/:id/reassign",
  verifyUser,
  requireCompanyModule("carwash"),
  requireCompanyPermission("carwash-payments", "edit", "carwash"),
  reassignMpesaNotification
);

// No auth — Safaricom calls these directly
router.post("/validation/:shortCode", validateCarWashCallback);
router.post("/confirmation/:shortCode", confirmCarWashCallback);

export default router;
