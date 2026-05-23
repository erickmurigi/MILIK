import express from "express";
import { requireCompanyModule, verifyUser, GL_ACCESS_MODULES } from "../../controllers/verifyToken.js";
import {
  getBudgets,
  getBudget,
  createBudget,
  updateBudget,
  deleteBudget,
} from "../../controllers/propertyController/budgets.js";

const router = express.Router();

router.get("/",       verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getBudgets);
router.post("/",      verifyUser, requireCompanyModule(GL_ACCESS_MODULES), createBudget);
router.get("/:id",    verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getBudget);
router.put("/:id",    verifyUser, requireCompanyModule(GL_ACCESS_MODULES), updateBudget);
router.delete("/:id", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), deleteBudget);

export default router;
