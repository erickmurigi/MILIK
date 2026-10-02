import express from "express";
import { listLandlordPayments, payLandlord, recordRecoveryFromLandlord, postCommission } from "../../controllers/propertyController/landlordPaymentController.js";
import { requireCompanyPermission, verifyUser } from "../../controllers/verifyToken.js";

const router = express.Router();

const canProcessCommission = requireCompanyPermission("commissions", "process", "propertyManagement");

router.get("/", verifyUser, listLandlordPayments);
router.post("/pay", verifyUser, payLandlord);
router.post("/record-recovery", verifyUser, recordRecoveryFromLandlord);
router.post("/post-commission", verifyUser, canProcessCommission, postCommission);

export default router;
