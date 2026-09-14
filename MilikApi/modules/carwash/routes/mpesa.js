import express from "express";
import multer from "multer";
import { confirmCarWashCallback, validateCarWashCallback, listMpesaNotifications, reassignMpesaNotification, listUnpaidJobs, allocateNotification, registerCarWashPaybillUrls, bulkUploadMpesaStatement, markNotificationReversed, devTestHashedSms } from "../controllers/mpesaCallbackController.js";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { safaricomIPWhitelist } from "../../../utils/ipWhiteList.js";

const router = express.Router();

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_, file, cb) => {
    const ok = file.mimetype === "text/csv"
      || file.mimetype === "application/vnd.ms-excel"
      || file.originalname.toLowerCase().endsWith(".csv");
    cb(ok ? null : new Error("Only CSV files are accepted"), ok);
  },
});

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

// Authenticated — mark a notification as reversed (M-Pesa portal reversal)
router.patch(
  "/notifications/:id/reverse",
  verifyUser,
  requireCompanyModule("carwash"),
  requireCompanyPermission("carwash-payments", "edit", "carwash"),
  markNotificationReversed,
);

// Authenticated — bulk upload M-Pesa statement CSV to reconcile missed payments
router.post(
  "/bulk-upload",
  verifyUser,
  requireCompanyModule("carwash"),
  requireCompanyPermission("carwash-payments", "edit", "carwash"),
  csvUpload.single("file"),
  bulkUploadMpesaStatement,
);

// Dev only — test masked SMS without a real payment (blocked in production)
router.post("/dev/test-hashed-sms", devTestHashedSms);

// No auth — Safaricom calls these directly. IP-whitelisted the same way
// routes/propertyRoutes/pmsPublicCallbacks.js already is.
router.post("/validation/:shortCode", safaricomIPWhitelist, validateCarWashCallback);
router.post("/confirmation/:shortCode", safaricomIPWhitelist, confirmCarWashCallback);

export default router;
