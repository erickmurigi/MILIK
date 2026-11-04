import express from "express";
import { verifyUser } from "../../../controllers/verifyToken.js";
import { validateParamId } from "../middleware/validateObjectId.js";
import {
  portalSummary,
  portalInvoices,
  portalStatement,
  portalReceipts,
  portalContracts,
} from "../controllers/portalController.js";

// Staff-authenticated for now. A client-portal router would swap verifyUser
// for a portal-token middleware that sets req.clientPortal = { business,
// client } and mount the same handlers without the :clientId segment.
const router = express.Router();

router.use(verifyUser);

router.get("/:clientId/summary",    validateParamId("clientId"), portalSummary);
router.get("/:clientId/invoices",   validateParamId("clientId"), portalInvoices);
router.get("/:clientId/statement",  validateParamId("clientId"), portalStatement);
router.get("/:clientId/receipts",   validateParamId("clientId"), portalReceipts);
router.get("/:clientId/contracts",  validateParamId("clientId"), portalContracts);

export default router;
