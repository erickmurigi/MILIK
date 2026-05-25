import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { createJob, deleteJob, deleteJobsBulk, getJob, listJobs, updateJob, updateJobStatus, sendJobSms } from "../controllers/jobsController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("carwash"));
router.get("/", requireCompanyPermission("carwash-jobs", "view", "carwash"), listJobs);
router.get("/:id", requireCompanyPermission("carwash-jobs", "view", "carwash"), getJob);
router.post("/", requireCompanyPermission("carwash-jobs", "create", "carwash"), createJob);
router.post("/bulk-delete", requireCompanyPermission("carwash-jobs", "update", "carwash"), deleteJobsBulk);
router.put("/:id", requireCompanyPermission("carwash-jobs", "update", "carwash"), updateJob);
router.patch("/:id/status", requireCompanyPermission("carwash-jobs", "update", "carwash"), updateJobStatus);
router.delete("/:id", requireCompanyPermission("carwash-jobs", "update", "carwash"), deleteJob);
router.post("/:id/sms", requireCompanyPermission("carwash-jobs", "view", "carwash"), sendJobSms);

export default router;
