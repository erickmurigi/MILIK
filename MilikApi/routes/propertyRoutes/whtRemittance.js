import express from "express";
import { requireCompanyModule, verifyUser, GL_ACCESS_MODULES } from "../../controllers/verifyToken.js";
import {
  getWhtReturnSummary,
  getWhtRemittanceHistory,
  remitWht,
  voidWhtRemittance,
} from "../../controllers/propertyController/whtRemittance.js";

const router = express.Router();

router.get("/summary",    verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getWhtReturnSummary);
router.get("/",           verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getWhtRemittanceHistory);
router.post("/remit",     verifyUser, requireCompanyModule("accounts"),        remitWht);
router.patch("/:id/void", verifyUser, requireCompanyModule("accounts"),        voidWhtRemittance);

export default router;
