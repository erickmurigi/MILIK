import express from "express";
import { requireCompanyModule, verifyUser } from "../../controllers/verifyToken.js";
import {
  getAccountingPeriods,
  getAccountingPeriod,
  createAccountingPeriod,
  updateAccountingPeriod,
  closeAccountingPeriod,
  reopenAccountingPeriod,
  lockAccountingPeriod,
  getAccountingPeriodStats,
} from "../../controllers/propertyController/accountingPeriods.js";

const router = express.Router();

router.get("/", verifyUser, requireCompanyModule("accounts"), getAccountingPeriods);
router.get("/:id", verifyUser, requireCompanyModule("accounts"), getAccountingPeriod);
router.get("/:id/stats", verifyUser, requireCompanyModule("accounts"), getAccountingPeriodStats);
router.post("/", verifyUser, requireCompanyModule("accounts"), createAccountingPeriod);
router.put("/:id", verifyUser, requireCompanyModule("accounts"), updateAccountingPeriod);
router.post("/:id/close", verifyUser, requireCompanyModule("accounts"), closeAccountingPeriod);
router.post("/:id/reopen", verifyUser, requireCompanyModule("accounts"), reopenAccountingPeriod);
router.post("/:id/lock", verifyUser, requireCompanyModule("accounts"), lockAccountingPeriod);

export default router;
