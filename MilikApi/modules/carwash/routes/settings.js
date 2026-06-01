import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { getCarWashSettings, updateCarWashSettings } from "../controllers/settingsController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("carwash"));

router.get("/", requireCompanyPermission("carwash-settings", "view", "carwash"), getCarWashSettings);
router.put("/", requireCompanyPermission("carwash-settings", "manage", "carwash"), updateCarWashSettings);

export default router;
