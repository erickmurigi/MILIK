import express from "express";
import { verifyUser } from "../../controllers/verifyToken.js";
import {
  getLatePenaltyRules,
  getLatePenaltyPostingAccounts,
  createLatePenaltyRule,
  updateLatePenaltyRule,
  previewLatePenalties,
  processLatePenalties,
  getLatePenaltyBatches,
  getLatePenaltyBatch,
  deleteLatePenaltyBatch,
} from "../../controllers/propertyController/latePenalties.js";

const router = express.Router();

router.get("/rules", verifyUser, getLatePenaltyRules);
router.get("/posting-accounts", verifyUser, getLatePenaltyPostingAccounts);
router.post("/rules", verifyUser, createLatePenaltyRule);
router.put("/rules/:id", verifyUser, updateLatePenaltyRule);
router.post("/preview", verifyUser, previewLatePenalties);
router.post("/process", verifyUser, processLatePenalties);
router.get("/batches", verifyUser, getLatePenaltyBatches);
router.get("/batches/:id", verifyUser, getLatePenaltyBatch);
router.delete("/batches/:id", verifyUser, deleteLatePenaltyBatch);

export default router;
