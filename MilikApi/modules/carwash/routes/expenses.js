import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { createExpense, deleteExpense, getExpenseCategories, getExpensesReport, listExpenses, updateExpense, updateExpenseCategories, updateExpenseStatus } from "../controllers/expensesController.js";
import { validateParamId } from "../middleware/validateObjectId.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("carwash"));
router.get("/categories",       requireCompanyPermission("carwash-expenses", "view",   "carwash"), getExpenseCategories);
router.put("/categories",       requireCompanyPermission("carwash-expenses", "update", "carwash"), updateExpenseCategories);
router.get("/report",           requireCompanyPermission("carwash-expenses", "view",   "carwash"), getExpensesReport);
router.get("/",                 requireCompanyPermission("carwash-expenses", "view",   "carwash"), listExpenses);
router.post("/",                requireCompanyPermission("carwash-expenses", "create", "carwash"), createExpense);
router.put("/:id",              validateParamId(), requireCompanyPermission("carwash-expenses", "update", "carwash"), updateExpense);
router.patch("/:id/status",     validateParamId(), requireCompanyPermission("carwash-expenses", "update", "carwash"), updateExpenseStatus);
router.delete("/:id",           validateParamId(), requireCompanyPermission("carwash-expenses", "delete", "carwash"), deleteExpense);

export default router;
