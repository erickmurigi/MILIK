import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { dailySummary, monthlySummary, serviceReport, staffReport, weeklySummary } from "../controllers/reportsController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("carwash"));
router.get("/daily-summary", requireCompanyPermission("carwash-reports", "view", "carwash"), dailySummary);
router.get("/weekly-summary", requireCompanyPermission("carwash-reports", "view", "carwash"), weeklySummary);
router.get("/monthly-summary", requireCompanyPermission("carwash-reports", "view", "carwash"), monthlySummary);
router.get("/service-report", requireCompanyPermission("carwash-reports", "view", "carwash"), serviceReport);
router.get("/staff-report", requireCompanyPermission("carwash-reports", "view", "carwash"), staffReport);

export default router;
