import express from "express";
import { verifyUser } from "../../../controllers/verifyToken.js";
import { validateParamId } from "../middleware/validateObjectId.js";
import {
  getSettings,
  updateSettings,
  testConnection,
  submitInvoiceToEtims,
  submitCreditNoteToEtims,
  listSubmissions,
} from "../controllers/etimsController.js";

const router = express.Router();

router.use(verifyUser);

router.get("/settings",                  getSettings);
router.put("/settings",                  updateSettings);
router.post("/test-connection",          testConnection);
router.get("/submissions",               listSubmissions);
router.post("/invoices/:id/submit",      validateParamId(), submitInvoiceToEtims);
router.post("/credit-notes/:id/submit",  validateParamId(), submitCreditNoteToEtims);

export default router;
