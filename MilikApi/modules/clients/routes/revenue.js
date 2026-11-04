import express from "express";
import { verifyUser, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { validateParamId } from "../middleware/validateObjectId.js";
import {
  listRevenueSchedules,
  previewRecognition,
  runRecognition,
  recognizeMilestoneHandler,
  deferredBalanceReport,
  waterfallReport,
  billedVsRecognisedReport,
} from "../controllers/revenueController.js";

const router = express.Router();
router.use(verifyUser);

const can = (action) => requireCompanyPermission("clientRevenue", action, "clients");

router.get("/schedules",                         listRevenueSchedules);
router.post("/schedules/:id/milestone",          validateParamId(), can("process"), recognizeMilestoneHandler);
router.get("/recognition/preview",               previewRecognition);
router.post("/recognition/run",                  can("process"), runRecognition);
router.get("/reports/deferred-balance",          deferredBalanceReport);
router.get("/reports/waterfall",                 waterfallReport);
router.get("/reports/billed-vs-recognised",      billedVsRecognisedReport);

export default router;
