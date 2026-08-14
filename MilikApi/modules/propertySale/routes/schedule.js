import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { deleteScheduleItem, getOverdueSchedule, linkPaymentToSchedule, listAllSchedule, listSchedule, sendReminders, setSchedule, updateScheduleItem } from "../controllers/scheduleController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"));

router.get("/all",           requireCompanyPermission("sale-deals", "view",   "propertySale"), listAllSchedule);
router.get("/",              requireCompanyPermission("sale-deals", "view",   "propertySale"), listSchedule);
router.get("/overdue",       requireCompanyPermission("sale-deals", "view",   "propertySale"), getOverdueSchedule);
router.post("/",             requireCompanyPermission("sale-deals", "update", "propertySale"), setSchedule);
router.patch("/:id",         requireCompanyPermission("sale-deals", "update", "propertySale"), updateScheduleItem);
router.patch("/:id/link",    requireCompanyPermission("sale-deals", "update", "propertySale"), linkPaymentToSchedule);
router.delete("/:id",        requireCompanyPermission("sale-deals", "update", "propertySale"), deleteScheduleItem);
router.post("/send-reminders", requireCompanyPermission("sale-deals", "update", "propertySale"), sendReminders);

export default router;
