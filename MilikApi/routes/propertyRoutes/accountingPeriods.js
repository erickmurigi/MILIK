import express from "express";
import { requireCompanyModule, requireCompanyPermission, verifyUser } from "../../controllers/verifyToken.js";
import {
  getAccountingPeriods,
  getAccountingPeriod,
  createAccountingPeriod,
  generateAccountingYear,
  updateAccountingPeriod,
  deleteAccountingPeriod,
  getAccountingPeriodChecklist,
  closeAccountingPeriod,
  reopenAccountingPeriod,
  lockAccountingPeriod,
  getAccountingPeriodStats,
  getYearCloseChecklist,
  closeAccountingYear,
  openAccountingPostingWindow,
  endAccountingPostingWindow,
} from "../../controllers/propertyController/accountingPeriods.js";

const router = express.Router();

const can = (action) => requireCompanyPermission("accountingPeriods", action, "accounts");
const view = requireCompanyModule("accounts");

router.get("/", verifyUser, view, getAccountingPeriods);
router.get("/year-close/checklist", verifyUser, view, getYearCloseChecklist);
router.post("/year-close", verifyUser, can("lock"), closeAccountingYear);
router.post("/generate-year", verifyUser, can("create"), generateAccountingYear);
router.get("/:id", verifyUser, view, getAccountingPeriod);
router.get("/:id/stats", verifyUser, view, getAccountingPeriodStats);
router.get("/:id/checklist", verifyUser, view, getAccountingPeriodChecklist);
router.post("/", verifyUser, can("create"), createAccountingPeriod);
router.put("/:id", verifyUser, can("update"), updateAccountingPeriod);
// deleting an open period removes no entry; it uses the edit permission rather than a new action
router.delete("/:id", verifyUser, can("update"), deleteAccountingPeriod);
router.post("/:id/close", verifyUser, can("close"), closeAccountingPeriod);
router.post("/:id/reopen", verifyUser, can("reverse"), reopenAccountingPeriod);
router.post("/:id/lock", verifyUser, can("lock"), lockAccountingPeriod);
// whoever may reopen a period may instead post into it for a few minutes (the path contains "/reopen" so the global route guard asks for the same permission)
router.post("/:id/reopen-window", verifyUser, can("reverse"), openAccountingPostingWindow);
router.delete("/:id/reopen-window", verifyUser, can("reverse"), endAccountingPostingWindow);

export default router;
