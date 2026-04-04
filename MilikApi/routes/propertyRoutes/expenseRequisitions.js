import express from "express";
import { verifyUser } from "../../controllers/verifyToken.js";
import {
  createExpenseRequisition,
  deleteExpenseRequisition,
  listExpenseRequisitions,
  updateExpenseRequisition,
} from "../../controllers/propertyController/expenseRequisition.js";

const router = express.Router();

router.get("/", verifyUser, listExpenseRequisitions);
router.post("/", verifyUser, createExpenseRequisition);
router.put("/:id", verifyUser, updateExpenseRequisition);
router.delete("/:id", verifyUser, deleteExpenseRequisition);

export default router;
