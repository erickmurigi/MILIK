import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { getCarWashSettings, updateCarWashSettings, backfillBranches, uploadQueueBgImage } from "../controllers/settingsController.js";
import { queueBgUpload } from "../middleware/queueBgUpload.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("carwash"));

router.get("/", requireCompanyPermission("carwash-settings", "view", "carwash"), getCarWashSettings);
router.put("/", requireCompanyPermission("carwash-settings", "manage", "carwash"), updateCarWashSettings);
router.post("/backfill-branches", requireCompanyPermission("carwash-settings", "manage", "carwash"), backfillBranches);
router.post(
  "/queue-bg-image",
  requireCompanyPermission("carwash-settings", "manage", "carwash"),
  (req, res, next) => queueBgUpload(req, res, (err) => {
    if (err) return next({ status: 400, message: err.message || "Image upload failed" });
    next();
  }),
  uploadQueueBgImage,
);

export default router;
