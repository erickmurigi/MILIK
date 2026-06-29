import express from "express";
import { requireCompanyModule, verifyUser, GL_ACCESS_MODULES } from "../../controllers/verifyToken.js";
import {
  getVatReturnSummary,
  getRemittanceHistory,
  remitVat,
  voidRemittance,
} from "../../controllers/propertyController/taxRemittance.js";

const router = express.Router();

router.get("/summary",    verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getVatReturnSummary);
router.get("/",           verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getRemittanceHistory);
router.post("/remit",     verifyUser, requireCompanyModule("accounts"),        remitVat);
router.patch("/:id/void", verifyUser, requireCompanyModule("accounts"),        voidRemittance);

export default router;
