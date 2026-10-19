import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import {
  createBuyer, deleteBuyer, getBuyer, listBuyers, updateBuyer, sendBuyerSms, sendBuyerEmail,
  uploadBuyerDocuments, removeBuyerDocument,
} from "../controllers/buyersController.js";
import { bulkImportBuyers } from "../controllers/bulkImportController.js";
import { buyerDocumentUpload } from "../middleware/buyerDocumentUpload.js";
import { attachAdvocateScope } from "../middleware/advocateScope.js";
import { createError } from "../../../utils/error.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"), attachAdvocateScope);
router.get("/", requireCompanyPermission("sale-buyers", "view", "propertySale"), listBuyers);
router.get("/:id", requireCompanyPermission("sale-buyers", "view", "propertySale"), getBuyer);
router.post("/",      requireCompanyPermission("sale-buyers", "create", "propertySale"), createBuyer);
router.post("/bulk", requireCompanyPermission("sale-buyers", "create", "propertySale"), bulkImportBuyers);
router.put("/:id", requireCompanyPermission("sale-buyers", "update", "propertySale"), updateBuyer);
router.delete("/:id", requireCompanyPermission("sale-buyers", "update", "propertySale"), deleteBuyer);
router.post("/:id/sms",   requireCompanyPermission("sale-buyers", "view", "propertySale"), sendBuyerSms);
router.post("/:id/email", requireCompanyPermission("sale-buyers", "view", "propertySale"), sendBuyerEmail);

router.post(
  "/:id/documents",
  requireCompanyPermission("sale-buyers", "update", "propertySale"),
  (req, res, next) => buyerDocumentUpload(req, res, (err) => err ? next(createError(400, err.message || "Upload failed")) : next()),
  uploadBuyerDocuments
);
router.delete("/:id/documents", requireCompanyPermission("sale-buyers", "update", "propertySale"), removeBuyerDocument);

export default router;
