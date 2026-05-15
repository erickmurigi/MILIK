import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { createBuyer, deleteBuyer, getBuyer, listBuyers, updateBuyer } from "../controllers/buyersController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"));
router.get("/", requireCompanyPermission("sale-buyers", "view", "propertySale"), listBuyers);
router.get("/:id", requireCompanyPermission("sale-buyers", "view", "propertySale"), getBuyer);
router.post("/", requireCompanyPermission("sale-buyers", "create", "propertySale"), createBuyer);
router.put("/:id", requireCompanyPermission("sale-buyers", "update", "propertySale"), updateBuyer);
router.delete("/:id", requireCompanyPermission("sale-buyers", "update", "propertySale"), deleteBuyer);

export default router;
