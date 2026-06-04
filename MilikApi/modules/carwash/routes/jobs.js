import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { createJob, deleteJob, deleteJobsBulk, deleteJobPhoto, getJob, listJobs, updateJob, updateJobStatus, uploadJobPhotos, sendJobSms } from "../controllers/jobsController.js";
import { validateParamId } from "../middleware/validateObjectId.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("carwash"));
router.get("/", requireCompanyPermission("carwash-jobs", "view", "carwash"), listJobs);
router.post("/", requireCompanyPermission("carwash-jobs", "create", "carwash"), createJob);
router.post("/bulk-delete", requireCompanyPermission("carwash-jobs", "update", "carwash"), deleteJobsBulk);
router.get("/:id", validateParamId(), requireCompanyPermission("carwash-jobs", "view", "carwash"), getJob);
router.put("/:id", validateParamId(), requireCompanyPermission("carwash-jobs", "update", "carwash"), updateJob);
router.patch("/:id/status", validateParamId(), requireCompanyPermission("carwash-jobs", "update", "carwash"), updateJobStatus);
router.delete("/:id", validateParamId(), requireCompanyPermission("carwash-jobs", "update", "carwash"), deleteJob);
router.post("/:id/sms",    validateParamId(), requireCompanyPermission("carwash-jobs", "view",   "carwash"), sendJobSms);
router.post("/:id/photos", validateParamId(), requireCompanyPermission("carwash-jobs", "update", "carwash"), uploadJobPhotos);
router.delete("/:id/photos", validateParamId(), requireCompanyPermission("carwash-jobs", "update", "carwash"), deleteJobPhoto);

export default router;
