import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { deletePayment, listPayments, recordPayment, updatePaymentReconciliation, sendPaymentSms } from "../controllers/paymentsController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("carwash"));
router.get("/", requireCompanyPermission("carwash-payments", "view", "carwash"), listPayments);
router.post("/", requireCompanyPermission("carwash-payments", "record", "carwash"), recordPayment);
router.post("/jobs/:jobId", requireCompanyPermission("carwash-payments", "record", "carwash"), recordPayment);
router.patch("/:id/reconciliation", requireCompanyPermission("carwash-payments", "record", "carwash"), updatePaymentReconciliation);
router.delete("/:id", requireCompanyPermission("carwash-payments", "record", "carwash"), deletePayment);
router.post("/:id/sms", requireCompanyPermission("carwash-payments", "view", "carwash"), sendPaymentSms);

export default router;
