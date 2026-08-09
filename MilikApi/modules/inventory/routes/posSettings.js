import express from "express";
import { verifyUser, requireCompanyModule } from "../../../controllers/verifyToken.js";
import { getPOSSettings, updatePOSSettings } from "../controllers/posSettingsController.js";

const router = express.Router();
router.use(verifyUser, requireCompanyModule("inventory"));

router.get("/",  getPOSSettings);
router.put("/",  updatePOSSettings);

export default router;
