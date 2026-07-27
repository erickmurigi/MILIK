import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { createPayment, deletePayment, getPayment, listPayments, updatePayment, voidPayment } from "../controllers/paymentsController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"));
router.get("/", requireCompanyPermission("sale-payments", "view", "propertySale"), listPayments);
router.get("/:id", requireCompanyPermission("sale-payments", "view", "propertySale"), getPayment);
router.post("/", requireCompanyPermission("sale-payments", "create", "propertySale"), createPayment);
router.put("/:id", requireCompanyPermission("sale-payments", "update", "propertySale"), updatePayment);
router.patch("/:id/void", requireCompanyPermission("sale-payments", "update", "propertySale"), voidPayment);
router.delete("/:id", requireCompanyPermission("sale-payments", "update", "propertySale"), deletePayment);

export default router;
