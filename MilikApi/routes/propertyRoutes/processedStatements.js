// routes/propertyRoutes/processedStatements.js
import express from "express";
import { verifyToken, verifyAdmin } from "../../controllers/verifyToken.js";
import {
  closeStatement,
  getStatementsByBusiness,
  getStatementById,
  updateStatement,
  deleteStatement,
  reverseStatement,
  adminForceReverseStatement,
  adminCleanupOrphanedGLEntries,
  getStatementStats,
  getManagementFeeInvoicePdf,
} from "../../controllers/propertyController/processedStatements.js";

const router = express.Router();

// Protect all routes with auth
router.use(verifyToken);

// Create/close a new statement — requires admin access (irreversible financial action)
router.post("/", verifyAdmin, closeStatement);

// Get all statements for a business
router.get("/business/:businessId", getStatementsByBusiness);

// Get statements stats
router.get("/stats/:businessId", getStatementStats);

// Get single statement
router.get("/detail/:statementId", getStatementById);

// Update statement
router.put("/:statementId", updateStatement);

// Reverse statement — requires admin access
router.post("/:statementId/reverse", verifyAdmin, reverseStatement);

// Admin force-reverse: bypasses hasLaterProcessedStatements for data-correction scenarios
router.post("/:statementId/admin-reverse", verifyAdmin, adminForceReverseStatement);

// Admin: delete orphaned GL entries whose source ProcessedStatement no longer exists
router.post("/admin-cleanup-orphaned-gl/:businessId", verifyAdmin, adminCleanupOrphanedGLEntries);

// Management fee invoice PDF
router.get("/:statementId/management-fee-invoice-pdf", getManagementFeeInvoicePdf);

// Delete statement — requires admin access
router.delete("/:statementId", verifyAdmin, deleteStatement);

export default router;
