import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import {
  cancelDeal, closeDeal, createDeal, createDealFromOffer, deleteDeal, getDeal,
  listDeals, updateDeal, sendDealSms, sendDealEmail,
  uploadDealDocument, deleteDealDocument,
} from "../controllers/dealsController.js";
import { dealDocumentUpload } from "../middleware/dealDocumentUpload.js";
import { attachAgentScope } from "../middleware/agentScope.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"));
router.get("/", requireCompanyPermission("sale-deals", "view", "propertySale"), attachAgentScope, listDeals);
router.get("/:id", requireCompanyPermission("sale-deals", "view", "propertySale"), getDeal);
router.post("/", requireCompanyPermission("sale-deals", "create", "propertySale"), createDeal);
router.post("/from-offer/:offerId", requireCompanyPermission("sale-deals", "create", "propertySale"), createDealFromOffer);
router.put("/:id", requireCompanyPermission("sale-deals", "update", "propertySale"), updateDeal);
router.patch("/:id/close", requireCompanyPermission("sale-deals", "process", "propertySale"), closeDeal);
router.patch("/:id/cancel", requireCompanyPermission("sale-deals", "process", "propertySale"), cancelDeal);
router.delete("/:id", requireCompanyPermission("sale-deals", "delete", "propertySale"), deleteDeal);
router.post("/:id/sms",   requireCompanyPermission("sale-deals", "view", "propertySale"), sendDealSms);
router.post("/:id/email", requireCompanyPermission("sale-deals", "view", "propertySale"), sendDealEmail);
router.post("/:id/documents", requireCompanyPermission("sale-deals", "update", "propertySale"), dealDocumentUpload, uploadDealDocument);
router.delete("/:id/documents/:docId", requireCompanyPermission("sale-deals", "update", "propertySale"), deleteDealDocument);

export default router;
