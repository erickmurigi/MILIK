import express from "express";
import { listLandlordPayments, payLandlord, recordRecoveryFromLandlord, postCommission } from "../../controllers/propertyController/landlordPaymentController.js";
import { verifyUser } from "../../controllers/verifyToken.js";

const router = express.Router();
router.get("/", verifyUser, listLandlordPayments);
router.post("/pay", verifyUser, payLandlord);
router.post("/record-recovery", verifyUser, recordRecoveryFromLandlord);
router.post("/post-commission", verifyUser, postCommission);

export default router;
