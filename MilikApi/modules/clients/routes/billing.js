import express from "express";
import { verifyUser, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { validateParamId } from "../middleware/validateObjectId.js";
import {
  previewBillingRun,
  executeBillingRun,
  listBillingRuns,
  getBillingRun,
  getBillingSettings,
  updateBillingSettings,
} from "../controllers/billingController.js";

const router = express.Router();
router.use(verifyUser);

const can = (action) => requireCompanyPermission("clientBilling", action, "clients");

router.get("/preview",    previewBillingRun);
router.post("/run",       can("process"), executeBillingRun);
router.get("/runs",       listBillingRuns);
router.get("/runs/:id",   validateParamId(), getBillingRun);
router.get("/settings",   getBillingSettings);
router.put("/settings",   requireCompanyPermission("companySettings", "update"), updateBillingSettings);

export default router;
