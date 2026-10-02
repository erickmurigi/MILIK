import express from "express";
import { requireCompanyModule, requireCompanyPermission, verifyUser } from "../../controllers/verifyToken.js";
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

const can = (action) => requireCompanyPermission("accountingPeriods", action, "accounts");

router.get("/", verifyUser, requireCompanyModule("accounts"), getAccountingPeriods);
router.get("/:id", verifyUser, requireCompanyModule("accounts"), getAccountingPeriod);
router.get("/:id/stats", verifyUser, requireCompanyModule("accounts"), getAccountingPeriodStats);
router.post("/", verifyUser, can("create"), createAccountingPeriod);
router.put("/:id", verifyUser, can("update"), updateAccountingPeriod);
router.post("/:id/close", verifyUser, can("close"), closeAccountingPeriod);
router.post("/:id/reopen", verifyUser, can("reverse"), reopenAccountingPeriod);
router.post("/:id/lock", verifyUser, can("lock"), lockAccountingPeriod);

export default router;
