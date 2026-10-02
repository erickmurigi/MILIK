import express from "express";
import { requireCompanyModule, requireCompanyPermission, verifyUser, GL_ACCESS_MODULES } from "../../controllers/verifyToken.js";
import {
  getVatReturnSummary,
  getRemittanceHistory,
  remitVat,
  voidRemittance,
} from "../../controllers/propertyController/taxRemittance.js";

const router = express.Router();

const can = (action) => requireCompanyPermission("taxRemittance", action, "accounts");

router.get("/summary",    verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getVatReturnSummary);
router.get("/",           verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getRemittanceHistory);
router.post("/remit",     verifyUser, can("process"), remitVat);
router.patch("/:id/void", verifyUser, can("reverse"), voidRemittance);

export default router;
