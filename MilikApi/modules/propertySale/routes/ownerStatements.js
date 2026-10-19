import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { approveStatement, createDraftStatement, deleteDraftStatement, getStatement, listStatements, reverseStatementApproval } from "../controllers/ownerStatementsController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"));
router.get("/", requireCompanyPermission("sale-owner-statements", "view", "propertySale"), listStatements);
router.get("/:id", requireCompanyPermission("sale-owner-statements", "view", "propertySale"), getStatement);
router.post("/draft", requireCompanyPermission("sale-owner-statements", "create", "propertySale"), createDraftStatement);
router.post("/:id/approve", requireCompanyPermission("sale-owner-statements", "approve", "propertySale"), approveStatement);
router.post("/:id/reverse", requireCompanyPermission("sale-owner-statements", "approve", "propertySale"), reverseStatementApproval);
router.delete("/:id", requireCompanyPermission("sale-owner-statements", "create", "propertySale"), deleteDraftStatement);

export default router;
