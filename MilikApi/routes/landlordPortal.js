import express from "express";
import { verifyLandlordPortalToken } from "../middleware/landlordPortalAuth.js";
import {
  listMyStatements,
  downloadMyStatementPdf,
  getMyLiveStatement,
  downloadMyLiveStatementPdf,
  listMyProperties,
  listMyUnits,
  listMyTenants,
} from "../controllers/propertyController/landlordPortalController.js";

const router = express.Router();

router.use(verifyLandlordPortalToken);

router.get("/statements", listMyStatements);
router.get("/statements/:statementId/pdf", downloadMyStatementPdf);
router.get("/live-statement", getMyLiveStatement);
router.get("/live-statement/pdf", downloadMyLiveStatementPdf);
router.get("/properties", listMyProperties);
router.get("/units", listMyUnits);
router.get("/tenants", listMyTenants);

export default router;
