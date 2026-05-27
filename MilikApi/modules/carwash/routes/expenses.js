import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { createExpense, listExpenses, updateExpenseStatus } from "../controllers/expensesController.js";
import { validateParamId } from "../middleware/validateObjectId.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("carwash"));
router.get("/", requireCompanyPermission("carwash-expenses", "view", "carwash"), listExpenses);
router.post("/", requireCompanyPermission("carwash-expenses", "create", "carwash"), createExpense);
router.patch("/:id/status", validateParamId(), requireCompanyPermission("carwash-expenses", "update", "carwash"), updateExpenseStatus);

export default router;
