import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { listActivities, createActivity, updateActivity, deleteActivity } from "../controllers/activitiesController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"));

router.get("/",       requireCompanyPermission("sale-crm-activities", "view",   "propertySale"), listActivities);
router.post("/",      requireCompanyPermission("sale-crm-activities", "create", "propertySale"), createActivity);
router.put("/:id",    requireCompanyPermission("sale-crm-activities", "update", "propertySale"), updateActivity);
router.delete("/:id", requireCompanyPermission("sale-crm-activities", "update", "propertySale"), deleteActivity);

export default router;
