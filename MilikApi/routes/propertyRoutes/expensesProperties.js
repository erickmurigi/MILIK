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
import { requireCompanyPermission, verifyUser } from "../../controllers/verifyToken.js";

const router = express.Router();

const can = (action) => requireCompanyPermission("propertyExpenses", action, "propertyManagement");

// Create expense
router.post("/", verifyUser, can("create"), createExpense);

// Get all expenses
router.get("/", verifyUser, can("view"), getExpenses);

// Get expense summary
router.get("/get/summary", verifyUser, can("view"), getExpenseSummary);

// Get property expenses
router.get("/property/:propertyId", verifyUser, can("view"), getPropertyExpenses);

// Get single expense
router.get("/:id", verifyUser, can("view"), getExpense);

// Update expense
router.put("/:id", verifyUser, can("update"), updateExpense);

// Delete expense
router.delete("/:id", verifyUser, can("delete"), deleteExpense);

export default router;