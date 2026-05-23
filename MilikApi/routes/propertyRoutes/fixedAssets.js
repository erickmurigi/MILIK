import express from "express";
import { requireCompanyModule, verifyUser, GL_ACCESS_MODULES } from "../../controllers/verifyToken.js";
import {
  getFixedAssets,
  getFixedAsset,
  createFixedAsset,
  updateFixedAsset,
  disposeFixedAsset,
  previewDepreciation,
  runDepreciation,
} from "../../controllers/propertyController/fixedAssets.js";

const router = express.Router();

router.get("/",                    verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getFixedAssets);
router.post("/",                   verifyUser, requireCompanyModule(GL_ACCESS_MODULES), createFixedAsset);
router.get("/depreciation/preview", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), previewDepreciation);
router.post("/depreciation/run",    verifyUser, requireCompanyModule(GL_ACCESS_MODULES), runDepreciation);
router.get("/:id",                 verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getFixedAsset);
router.put("/:id",                 verifyUser, requireCompanyModule(GL_ACCESS_MODULES), updateFixedAsset);
router.post("/:id/dispose",        verifyUser, requireCompanyModule(GL_ACCESS_MODULES), disposeFixedAsset);

export default router;
