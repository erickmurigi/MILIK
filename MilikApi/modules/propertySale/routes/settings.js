import express from "express";
import { verifyUser, requireCompanyModule } from "../../../controllers/verifyToken.js";
import {
  getSettings,
  addPipelineStage, updatePipelineStage, archivePipelineStage,
  addLeadSource,    updateLeadSource,    archiveLeadSource,
  addPropertyType,  updatePropertyType,  archivePropertyType,
  updateCommissionDefaults,
  updateOwnerCommissionDefaults,
  updateCommissionReleaseSchedule,
  updateAgentVisibility,
  updateUseProjects,
  updateUseOwners,
  updateUseAdvocates,
  loadDefaults,
  addCommTemplate, updateCommTemplate, deleteCommTemplate,
  listAccountingDefaultTemplates, updatePSAccountingDefaults,
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
router.put("/owner-commission-defaults",  updateOwnerCommissionDefaults);
router.put("/commission-release-schedule", updateCommissionReleaseSchedule);
router.put("/agent-visibility",           updateAgentVisibility);
router.put("/use-projects",               updateUseProjects);
router.put("/use-owners",                 updateUseOwners);
router.put("/use-advocates",              updateUseAdvocates);

router.get("/accounting-defaults/templates", listAccountingDefaultTemplates);
router.put("/accounting-defaults",           updatePSAccountingDefaults);

router.post("/load-defaults/:collection", loadDefaults);

router.post("/comm-templates",           addCommTemplate);
router.put("/comm-templates/:itemId",    updateCommTemplate);
router.delete("/comm-templates/:itemId", deleteCommTemplate);

export default router;
