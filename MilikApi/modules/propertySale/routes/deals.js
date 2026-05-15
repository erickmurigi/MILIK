import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { cancelDeal, closeDeal, createDeal, deleteDeal, getDeal, listDeals, updateDeal } from "../controllers/dealsController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"));
router.get("/", requireCompanyPermission("sale-deals", "view", "propertySale"), listDeals);
router.get("/:id", requireCompanyPermission("sale-deals", "view", "propertySale"), getDeal);
router.post("/", requireCompanyPermission("sale-deals", "create", "propertySale"), createDeal);
router.put("/:id", requireCompanyPermission("sale-deals", "update", "propertySale"), updateDeal);
router.patch("/:id/close", requireCompanyPermission("sale-deals", "process", "propertySale"), closeDeal);
router.patch("/:id/cancel", requireCompanyPermission("sale-deals", "process", "propertySale"), cancelDeal);
router.delete("/:id", requireCompanyPermission("sale-deals", "delete", "propertySale"), deleteDeal);

export default router;
