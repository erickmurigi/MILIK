import express from "express";
import {
  createExpense,
  getExpense,
  getExpenses,
  updateExpense,
  deleteExpense,
  getExpenseSummary,
  getPropertyExpenses,
} from "../../controllers/propertyController/expenseProperty.js";
import { verifyUser } from "../../controllers/verifyToken.js";

const router = express.Router();

// Create expense
router.post("/", verifyUser, createExpense);

// Get all expenses
router.get("/", verifyUser, getExpenses);

// Get expense summary
router.get("/get/summary", verifyUser, getExpenseSummary);

// Get property expenses
router.get("/property/:propertyId", verifyUser, getPropertyExpenses);

// Get single expense
router.get("/:id", verifyUser, getExpense);

// Update expense
router.put("/:id", verifyUser, updateExpense);

// Delete expense
router.delete("/:id", verifyUser, deleteExpense);

export default router;