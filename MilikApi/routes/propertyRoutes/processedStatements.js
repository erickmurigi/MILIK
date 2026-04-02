// routes/propertyRoutes/processedStatements.js
import express from "express";
import { verifyToken } from "../../controllers/verifyToken.js";
import {
  closeStatement,
  getStatementsByBusiness,
  getStatementById,
  updateStatement,
  deleteStatement,
  reverseStatement,
  getStatementStats,
} from "../../controllers/propertyController/processedStatements.js";

const router = express.Router();

// Protect all routes with auth
router.use(verifyToken);

// Create/close a new statement
router.post("/", closeStatement);

// Get all statements for a business
router.get("/business/:businessId", getStatementsByBusiness);

// Get statements stats
router.get("/stats/:businessId", getStatementStats);

// Get single statement
router.get("/detail/:statementId", getStatementById);

// Update statement
router.put("/:statementId", updateStatement);

// Reverse statement
router.post("/:statementId/reverse", reverseStatement);

// Delete statement
router.delete("/:statementId", deleteStatement);

export default router;
