import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { createBuyer, deleteBuyer, getBuyer, listBuyers, updateBuyer, sendBuyerSms, sendBuyerEmail } from "../controllers/buyersController.js";
import { bulkImportBuyers } from "../controllers/bulkImportController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"));
router.get("/", requireCompanyPermission("sale-buyers", "view", "propertySale"), listBuyers);
router.get("/:id", requireCompanyPermission("sale-buyers", "view", "propertySale"), getBuyer);
router.post("/",      requireCompanyPermission("sale-buyers", "create", "propertySale"), createBuyer);
router.post("/bulk", requireCompanyPermission("sale-buyers", "create", "propertySale"), bulkImportBuyers);
router.put("/:id", requireCompanyPermission("sale-buyers", "update", "propertySale"), updateBuyer);
router.delete("/:id", requireCompanyPermission("sale-buyers", "update", "propertySale"), deleteBuyer);
router.post("/:id/sms",   requireCompanyPermission("sale-buyers", "view", "propertySale"), sendBuyerSms);
router.post("/:id/email", requireCompanyPermission("sale-buyers", "view", "propertySale"), sendBuyerEmail);

export default router;
