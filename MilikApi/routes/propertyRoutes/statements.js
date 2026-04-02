import express from "express";
import {
  createDraft,
  approve,
  getStatement,
  listStatementsForLandlord,
  createStatementRevision,
  markAsSent,
  deleteDraft,
  validateAudit,
  generatePdf,
  getStatementSummary,
} from "../../controllers/propertyController/statementController.js";
import { verifyToken, verifyCompanyScope } from "../../controllers/verifyToken.js";

const router = express.Router();

// All routes require authentication and company verification
router.use(verifyToken);
router.use(verifyCompanyScope);

/**
 * POST /api/statements/draft
 * Create a new draft statement or return existing draft for period
 */
router.post("/draft", createDraft);

/**
 * POST /api/statements/:statementId/approve
 * Approve a draft statement (freezes as immutable)
 */
router.post("/:statementId/approve", approve);

/**
 * GET /api/statements/:statementId
 * Get a statement by ID with frozen lines
 * Query params: includeLines (default: true), populateRefs (default: false)
 */
router.get("/:statementId", getStatement);

/**
 * GET /api/statements
 * List statements for a landlord with filtering
 * Query params: landlordId (required), propertyId, periodStart, periodEnd, status, page, limit
 */
router.get("/", listStatementsForLandlord);

/**
 * GET /api/statements/:statementId/pdf
 * Generate and download PDF from immutable statement snapshot
 */
router.get("/:statementId/pdf", generatePdf);

/**
 * POST /api/statements/:statementId/revise
 * Create a revision of an approved/sent statement
 */
router.post("/:statementId/revise", createStatementRevision);

/**
 * POST /api/statements/:statementId/send
 * Mark an approved statement as sent
 */
router.post("/:statementId/send", markAsSent);

/**
 * DELETE /api/statements/:statementId
 * Delete a draft statement (only drafts can be deleted)
 */
router.delete("/:statementId", deleteDraft);

/**
 * GET /api/statements/:statementId/validate
 * Validate statement audit integrity (header counts vs actual lines)
 */
router.get("/:statementId/validate", validateAudit);

/**
 * GET /api/statements/summary
 * Get summary statistics for a landlord's statements
 * Query params: landlordId (required), propertyId, year
 */
router.get("/summary/stats", getStatementSummary);

export default router;
