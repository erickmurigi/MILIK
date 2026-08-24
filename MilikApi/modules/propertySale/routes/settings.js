import express from "express";
import { verifyUser, requireCompanyModule } from "../../../controllers/verifyToken.js";
import {
  getSettings,
  addPipelineStage, updatePipelineStage, archivePipelineStage,
  addLeadSource,    updateLeadSource,    archiveLeadSource,
  addPropertyType,  updatePropertyType,  archivePropertyType,
  updateCommissionDefaults,
  loadDefaults,
  addCommTemplate, updateCommTemplate, deleteCommTemplate,
} from "../controllers/settingsController.js";

const router = express.Router();
router.use(verifyUser, requireCompanyModule("propertySale"));

router.get("/", getSettings);

router.post("/pipeline-stages",           addPipelineStage);
router.put("/pipeline-stages/:itemId",    updatePipelineStage);
router.delete("/pipeline-stages/:itemId", archivePipelineStage);

router.post("/lead-sources",              addLeadSource);
router.put("/lead-sources/:itemId",       updateLeadSource);
router.delete("/lead-sources/:itemId",    archiveLeadSource);

router.post("/property-types",            addPropertyType);
router.put("/property-types/:itemId",     updatePropertyType);
router.delete("/property-types/:itemId",  archivePropertyType);

router.put("/commission-defaults",        updateCommissionDefaults);

router.post("/load-defaults/:collection", loadDefaults);

router.post("/comm-templates",           addCommTemplate);
router.put("/comm-templates/:itemId",    updateCommTemplate);
router.delete("/comm-templates/:itemId", deleteCommTemplate);

export default router;
