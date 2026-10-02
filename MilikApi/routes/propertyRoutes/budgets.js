import express from "express";
import { requireCompanyModule, requireCompanyPermission, verifyUser, GL_ACCESS_MODULES } from "../../controllers/verifyToken.js";
import {
  getBudgets,
  getBudget,
  createBudget,
  updateBudget,
  deleteBudget,
} from "../../controllers/propertyController/budgets.js";

const router = express.Router();

const can = (action) => requireCompanyPermission("budgets", action, "accounts");

router.get("/",       verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getBudgets);
router.get("/:id",    verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getBudget);
router.post("/",      verifyUser, can("create"), createBudget);
router.put("/:id",    verifyUser, can("update"), updateBudget);
router.delete("/:id", verifyUser, can("delete"), deleteBudget);

export default router;
