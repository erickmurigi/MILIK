import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { deleteScheduleItem, getOverdueSchedule, linkPaymentToSchedule, listSchedule, setSchedule, updateScheduleItem } from "../controllers/scheduleController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"));

router.get("/",              requireCompanyPermission("sale-deals", "view",   "propertySale"), listSchedule);
router.get("/overdue",       requireCompanyPermission("sale-deals", "view",   "propertySale"), getOverdueSchedule);
router.post("/",             requireCompanyPermission("sale-deals", "update", "propertySale"), setSchedule);
router.patch("/:id",         requireCompanyPermission("sale-deals", "update", "propertySale"), updateScheduleItem);
router.patch("/:id/link",    requireCompanyPermission("sale-deals", "update", "propertySale"), linkPaymentToSchedule);
router.delete("/:id",        requireCompanyPermission("sale-deals", "update", "propertySale"), deleteScheduleItem);

export default router;
