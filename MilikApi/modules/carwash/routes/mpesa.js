import express from "express";
import { confirmCarWashCallback, validateCarWashCallback, listMpesaNotifications, reassignMpesaNotification, listUnpaidJobs, allocateNotification, registerCarWashPaybillUrls, devTestHashedSms } from "../controllers/mpesaCallbackController.js";
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

// Authenticated — all unpaid jobs (for allocation modal)
router.get(
  "/unpaid-jobs",
  verifyUser,
  requireCompanyModule("carwash"),
  requireCompanyPermission("carwash-payments", "view", "carwash"),
  listUnpaidJobs
);

// Authenticated — allocate one notification across multiple jobs
router.post(
  "/notifications/:id/allocate",
  verifyUser,
  requireCompanyModule("carwash"),
  requireCompanyPermission("carwash-payments", "edit", "carwash"),
  allocateNotification
);

// Authenticated — register validation/confirmation URLs with Safaricom
router.post(
  "/register-urls",
  verifyUser,
  requireCompanyModule("carwash"),
  requireCompanyPermission("carwash-settings", "manage", "carwash"),
  registerCarWashPaybillUrls
);

// Dev only — test masked SMS without a real payment (blocked in production)
router.post("/dev/test-hashed-sms", devTestHashedSms);

// No auth — Safaricom calls these directly
router.post("/validation/:shortCode", validateCarWashCallback);
router.post("/confirmation/:shortCode", confirmCarWashCallback);

export default router;
