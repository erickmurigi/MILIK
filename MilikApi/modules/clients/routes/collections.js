import express from "express";
import { verifyUser } from "../../../controllers/verifyToken.js";
import { validateParamId } from "../middleware/validateObjectId.js";
import {
  getSettings,
  updateSettings,
  previewDunning,
  runDunningNow,
  listDunningLog,
  listDisputes,
  getInvoiceFlag,
  setInvoiceDispute,
  listPromises,
  createPromise,
  updatePromise,
  creditCheck,
  setCreditHold,
  previewLateInterest,
} from "../controllers/collectionsController.js";

const router = express.Router();

router.use(verifyUser);

router.get("/settings",                         getSettings);
router.put("/settings",                         updateSettings);
router.get("/dunning/preview",                  previewDunning);
router.post("/dunning/run",                     runDunningNow);
router.get("/dunning/log",                      listDunningLog);
router.get("/disputes",                         listDisputes);
router.get("/invoices/:invoiceId/flag",         validateParamId("invoiceId"), getInvoiceFlag);
router.post("/invoices/:invoiceId/dispute",     validateParamId("invoiceId"), setInvoiceDispute);
router.get("/promises",                         listPromises);
router.post("/promises",                        createPromise);
router.patch("/promises/:id",                   validateParamId(), updatePromise);
router.get("/credit-check/:clientId",           validateParamId("clientId"), creditCheck);
router.patch("/credit-hold/:clientId",          validateParamId("clientId"), setCreditHold);
router.get("/late-interest/preview",            previewLateInterest);

export default router;
