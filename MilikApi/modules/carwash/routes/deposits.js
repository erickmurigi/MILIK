import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { createDeposit, listDeposits, updateDepositStatus } from "../controllers/depositsController.js";
import { validateParamId } from "../middleware/validateObjectId.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("carwash"));
router.get("/", requireCompanyPermission("carwash-deposits", "view", "carwash"), listDeposits);
router.post("/", requireCompanyPermission("carwash-deposits", "create", "carwash"), createDeposit);
router.patch("/:id/status", validateParamId(), requireCompanyPermission("carwash-deposits", "update", "carwash"), updateDepositStatus);

export default router;
