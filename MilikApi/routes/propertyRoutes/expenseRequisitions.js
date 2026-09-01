import express from "express";
import { verifyUser } from "../../controllers/verifyToken.js";
import {
  batchDeleteExpenseRequisitions,
  createExpenseRequisition,
  deleteExpenseRequisition,
  getExpenseRequisitions,
  updateExpenseRequisition,
  updateExpenseRequisitionStatus,
} from "../../controllers/propertyController/expenseRequisition.js";

const router = express.Router();

router.get("/", verifyUser, getExpenseRequisitions);
router.post("/", verifyUser, createExpenseRequisition);
router.post("/batch-delete", verifyUser, batchDeleteExpenseRequisitions);
router.put("/:id", verifyUser, updateExpenseRequisition);
router.put("/:id/status", verifyUser, updateExpenseRequisitionStatus);
router.delete("/:id", verifyUser, deleteExpenseRequisition);

export default router;
