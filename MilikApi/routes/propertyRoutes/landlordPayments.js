import express from "express";
import { listLandlordPayments, payLandlord, recordRecoveryFromLandlord, postCommission } from "../../controllers/propertyController/landlordPaymentController.js";
import { verifyToken } from "../../controllers/verifyToken.js";

const router = express.Router();
router.get("/", verifyToken, listLandlordPayments);
router.post("/pay", verifyToken, payLandlord);
router.post("/record-recovery", verifyToken, recordRecoveryFromLandlord);
router.post("/post-commission", verifyToken, postCommission);

export default router;
