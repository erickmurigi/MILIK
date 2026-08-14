import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { getDashboardStats, getMonthlyDetail, getSalesReport, getCashFlowForecast, getConversionFunnel } from "../controllers/reportsController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"));
router.get("/dashboard", requireCompanyPermission("sale-dashboard", "view", "propertySale"), getDashboardStats);
router.get("/sales", requireCompanyPermission("sale-reports", "view", "propertySale"), getSalesReport);
router.get("/monthly-detail", requireCompanyPermission("sale-reports", "view", "propertySale"), getMonthlyDetail);
router.get("/cash-flow",      requireCompanyPermission("sale-reports", "view", "propertySale"), getCashFlowForecast);
router.get("/funnel",         requireCompanyPermission("sale-reports", "view", "propertySale"), getConversionFunnel);

export default router;
