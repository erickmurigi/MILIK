import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { getDashboardStats, getMonthlyDetail, getSalesReport, getCashFlowForecast, getConversionFunnel, getAgentsPerformance } from "../controllers/reportsController.js";
import { attachAgentScope } from "../middleware/agentScope.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"), attachAgentScope);
router.get("/dashboard", requireCompanyPermission("sale-dashboard", "view", "propertySale"), getDashboardStats);
router.get("/sales", requireCompanyPermission("sale-reports", "view", "propertySale"), getSalesReport);
router.get("/monthly-detail", requireCompanyPermission("sale-reports", "view", "propertySale"), getMonthlyDetail);
router.get("/cash-flow",      requireCompanyPermission("sale-reports", "view", "propertySale"), getCashFlowForecast);
router.get("/funnel",         requireCompanyPermission("sale-reports", "view", "propertySale"), getConversionFunnel);
// Per-agent figures for the all-agents page: gated like that page (sale-agents view), agent-scoped like listDeals
router.get("/agents-performance", requireCompanyPermission("sale-agents", "view", "propertySale"), getAgentsPerformance);

export default router;
