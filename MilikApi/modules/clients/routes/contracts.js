import express from "express";
import { verifyUser, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { validateParamId } from "../middleware/validateObjectId.js";
import {
  listContracts,
  getContract,
  createContract,
  updateContract,
  activateContract,
  updateRenewalStage,
  renewContract,
  terminateContract,
  submitContract,
  approveContract,
  rejectContract,
  suspendContract,
  resumeContract,
  cancelContract,
  amendContract,
  listContractVersions,
  approveContractVersion,
  rejectContractVersion,
  getContractSchedule,
  changeSchedulePeriod,
  runEscalations,
} from "../controllers/contractsController.js";
import {
  getContractPdf,
  recordSignedContract,
  addContractDocument,
  removeContractDocument,
} from "../controllers/contractDocumentsController.js";

const router = express.Router();

router.use(verifyUser);

// Granular actions for the new lifecycle endpoints (approve, process, reverse ...). Admins and users
// with Full access to the Contract Management module pass; an explicit clientContracts.<action>
// grant/denial in the user's permission map takes precedence.
const can = (action) => requireCompanyPermission("clientContracts", action, "clients");

router.get("/",                                          listContracts);
router.post("/",                                         createContract);
router.post("/escalations/run",                          can("process"), runEscalations);
router.get("/:id",            validateParamId(),         getContract);
router.put("/:id",            validateParamId(),         updateContract);
router.patch("/:id/activate",      validateParamId(),   activateContract);
router.patch("/:id/renewal-stage", validateParamId(),   updateRenewalStage);
router.post("/:id/renew",     validateParamId(),         renewContract);
router.post("/:id/terminate", validateParamId(),         terminateContract);

router.post("/:id/submit",    validateParamId(), can("update"),  submitContract);
router.post("/:id/approve",   validateParamId(), can("approve"), approveContract);
router.post("/:id/reject",    validateParamId(), can("approve"), rejectContract);
router.post("/:id/suspend",   validateParamId(), can("update"),  suspendContract);
router.post("/:id/resume",    validateParamId(), can("update"),  resumeContract);
router.post("/:id/cancel",    validateParamId(), can("delete"),  cancelContract);

router.post("/:id/amend",     validateParamId(), can("update"),  amendContract);
router.get("/:id/versions",   validateParamId(),                 listContractVersions);
router.post("/:id/versions/:versionId/approve", validateParamId(), validateParamId("versionId"), can("approve"), approveContractVersion);
router.post("/:id/versions/:versionId/reject",  validateParamId(), validateParamId("versionId"), can("approve"), rejectContractVersion);

router.get("/:id/schedule",   validateParamId(),                 getContractSchedule);
router.post("/:id/schedule/:rowId/hold",    validateParamId(), validateParamId("rowId"), can("update"), changeSchedulePeriod("hold"));
router.post("/:id/schedule/:rowId/skip",    validateParamId(), validateParamId("rowId"), can("update"), changeSchedulePeriod("skip"));
router.post("/:id/schedule/:rowId/release", validateParamId(), validateParamId("rowId"), can("update"), changeSchedulePeriod("release"));

router.get("/:id/pdf",        validateParamId(),                 getContractPdf);
router.post("/:id/signed-copy", validateParamId(), can("update"), recordSignedContract);
router.post("/:id/documents", validateParamId(), can("update"),  addContractDocument);
router.delete("/:id/documents/:documentId", validateParamId(), validateParamId("documentId"), can("update"), removeContractDocument);

export default router;
