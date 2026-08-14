import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { listLeads, getPipeline, getLead, createLead, updateLead, deleteLead, convertLead, convertLeadToOffer } from "../controllers/leadsController.js";
import { attachAgentScope } from "../middleware/agentScope.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"));

router.get("/pipeline", requireCompanyPermission("sale-crm-leads", "view",   "propertySale"), getPipeline);
router.get("/",         requireCompanyPermission("sale-crm-leads", "view",   "propertySale"), attachAgentScope, listLeads);
router.get("/:id",      requireCompanyPermission("sale-crm-leads", "view",   "propertySale"), getLead);
router.post("/",        requireCompanyPermission("sale-crm-leads", "create", "propertySale"), createLead);
router.put("/:id",      requireCompanyPermission("sale-crm-leads", "update", "propertySale"), updateLead);
router.delete("/:id",   requireCompanyPermission("sale-crm-leads", "update", "propertySale"), deleteLead);
router.patch("/:id/convert",          requireCompanyPermission("sale-crm-leads", "update", "propertySale"), convertLead);
router.post("/:id/convert-to-offer",  requireCompanyPermission("sale-crm-leads", "update", "propertySale"), convertLeadToOffer);

export default router;
