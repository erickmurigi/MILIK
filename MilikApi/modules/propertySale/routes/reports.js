import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { getDashboardStats, getMonthlyDetail, getSalesReport } from "../controllers/reportsController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"));
router.get("/dashboard", requireCompanyPermission("sale-dashboard", "view", "propertySale"), getDashboardStats);
router.get("/sales", requireCompanyPermission("sale-reports", "view", "propertySale"), getSalesReport);
router.get("/monthly-detail", requireCompanyPermission("sale-reports", "view", "propertySale"), getMonthlyDetail);

export default router;
