import express from "express";
import { requireCompanyModule, requireCompanyPermission, verifyUser, GL_ACCESS_MODULES } from "../../controllers/verifyToken.js";
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

const can = (action) => requireCompanyPermission("fixedAssets", action, "accounts");

router.get("/",                    verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getFixedAssets);
router.get("/depreciation/preview", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), previewDepreciation);
router.get("/:id",                 verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getFixedAsset);
router.post("/",                   verifyUser, can("create"), createFixedAsset);
router.put("/:id",                 verifyUser, can("update"), updateFixedAsset);
router.post("/depreciation/run",    verifyUser, can("depreciate"), runDepreciation);
router.post("/:id/dispose",        verifyUser, can("dispose"), disposeFixedAsset);

export default router;
