import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { listLeads, getPipeline, getLead, createLead, updateLead, deleteLead, convertLead } from "../controllers/leadsController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"));

router.get("/pipeline", requireCompanyPermission("sale-crm-leads", "view",   "propertySale"), getPipeline);
router.get("/",         requireCompanyPermission("sale-crm-leads", "view",   "propertySale"), listLeads);
router.get("/:id",      requireCompanyPermission("sale-crm-leads", "view",   "propertySale"), getLead);
router.post("/",        requireCompanyPermission("sale-crm-leads", "create", "propertySale"), createLead);
router.put("/:id",      requireCompanyPermission("sale-crm-leads", "update", "propertySale"), updateLead);
router.delete("/:id",   requireCompanyPermission("sale-crm-leads", "update", "propertySale"), deleteLead);
router.patch("/:id/convert", requireCompanyPermission("sale-crm-leads", "update", "propertySale"), convertLead);

export default router;
