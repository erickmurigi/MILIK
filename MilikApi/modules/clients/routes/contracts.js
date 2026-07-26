import express from "express";
import { verifyUser } from "../../../controllers/verifyToken.js";
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
} from "../controllers/contractsController.js";

const router = express.Router();

router.use(verifyUser);

router.get("/",                                          listContracts);
router.post("/",                                         createContract);
router.get("/:id",            validateParamId(),         getContract);
router.put("/:id",            validateParamId(),         updateContract);
router.patch("/:id/activate",      validateParamId(),   activateContract);
router.patch("/:id/renewal-stage", validateParamId(),   updateRenewalStage);
router.post("/:id/renew",     validateParamId(),         renewContract);
router.post("/:id/terminate", validateParamId(),         terminateContract);

export default router;
