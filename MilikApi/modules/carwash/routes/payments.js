import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { deletePayment, initiateStkPush, listPayments, recordPayment, updatePaymentReconciliation, sendPaymentSms } from "../controllers/paymentsController.js";
import { validateParamId } from "../middleware/validateObjectId.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("carwash"));
router.get("/", requireCompanyPermission("carwash-payments", "view", "carwash"), listPayments);
router.post("/", requireCompanyPermission("carwash-payments", "record", "carwash"), recordPayment);
router.post("/jobs/:jobId", validateParamId("jobId"), requireCompanyPermission("carwash-payments", "record", "carwash"), recordPayment);
router.patch("/:id/reconciliation", validateParamId(), requireCompanyPermission("carwash-payments", "record", "carwash"), updatePaymentReconciliation);
router.delete("/:id", validateParamId(), requireCompanyPermission("carwash-payments", "record", "carwash"), deletePayment);
router.post("/:id/sms", validateParamId(), requireCompanyPermission("carwash-payments", "view", "carwash"), sendPaymentSms);
router.post("/stk-push", requireCompanyPermission("carwash-payments", "record", "carwash"), initiateStkPush);

export default router;
