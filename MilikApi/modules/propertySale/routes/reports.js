import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { createError } from "../../../utils/error.js";
import { getDashboardStats, getMonthlyDetail, getSalesReport, getCashFlowForecast, getConversionFunnel, getAgentsPerformance } from "../controllers/reportsController.js";
import { getOverdueInstallments, getReceivables, getSalesRegister } from "../controllers/collectionsReportsController.js";
import { attachAgentScope } from "../middleware/agentScope.js";
import { attachAdvocateScope } from "../middleware/advocateScope.js";
import { generateReportPdf } from "../controllers/salePdfReportsController.js";
import { SALE_REPORTS } from "../services/saleReportPdfData.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"), attachAgentScope, attachAdvocateScope);
router.get("/dashboard", requireCompanyPermission("sale-dashboard", "view", "propertySale"), getDashboardStats);
router.get("/sales", requireCompanyPermission("sale-reports", "view", "propertySale"), getSalesReport);
router.get("/monthly-detail", requireCompanyPermission("sale-reports", "view", "propertySale"), getMonthlyDetail);
router.get("/cash-flow",      requireCompanyPermission("sale-reports", "view", "propertySale"), getCashFlowForecast);
router.get("/funnel",         requireCompanyPermission("sale-reports", "view", "propertySale"), getConversionFunnel);
router.get("/receivables",    requireCompanyPermission("sale-reports", "view", "propertySale"), getReceivables);
router.get("/overdue-installments", requireCompanyPermission("sale-reports", "view", "propertySale"), getOverdueInstallments);
router.get("/register",       requireCompanyPermission("sale-reports", "view", "propertySale"), getSalesRegister);
// Per-agent figures for the all-agents page: gated like that page (sale-agents view), agent-scoped like listDeals
router.get("/agents-performance", requireCompanyPermission("sale-agents", "view", "propertySale"), getAgentsPerformance);

// Reports Center PDFs: one route for every report, but each report's data mirrors a different existing
// endpoint's own permission (e.g. Commissions mirrors /sale/commissions' "sale-commissions" check) —
// so the permission check is picked per report id rather than one blanket check for all of them.
const reportPdfPermission = {
  "sale-reports": requireCompanyPermission("sale-reports", "view", "propertySale"),
  "sale-commissions": requireCompanyPermission("sale-commissions", "view", "propertySale"),
};
const requireReportPdfPermission = (req, res, next) => {
  const report = SALE_REPORTS[req.params.reportId];
  if (!report) return next(createError(404, "Unknown report"));
  return reportPdfPermission[report.permission](req, res, next);
};
router.get("/pdf/:reportId", requireReportPdfPermission, generateReportPdf);

export default router;
