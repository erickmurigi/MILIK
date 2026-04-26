import express from "express";
import { payLandlord, recordRecoveryFromLandlord, postCommission } from "../../controllers/propertyController/landlordPaymentController.js";
import { listLandlordPayments, createLandlordPayment, reverseLandlordPayment } from "../../controllers/propertyController/landlordPayments.js";
import { verifyToken } from "../../controllers/verifyToken.js";

const router = express.Router();
router.get("/", verifyToken, listLandlordPayments);
router.post("/", verifyToken, createLandlordPayment);
router.post("/:id/reverse", verifyToken, reverseLandlordPayment);


/**
 * POST /api/landlord-payments/pay
 * Record payment to landlord
 */
router.post("/pay", verifyToken, payLandlord);

/**
 * POST /api/landlord-payments/record-recovery
 * Record recovery from landlord for a negative processed statement
 */
router.post("/record-recovery", verifyToken, recordRecoveryFromLandlord);

/**
 * POST /api/landlord-payments/post-commission
 * Post commission income
 */
router.post("/post-commission", verifyToken, postCommission);

export default router;
