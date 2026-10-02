import express from "express";
import { requireCompanyModule, requireCompanyPermission, verifyUser, GL_ACCESS_MODULES } from "../../controllers/verifyToken.js";
import {
  getWhtReturnSummary,
  getWhtRemittanceHistory,
  remitWht,
  voidWhtRemittance,
} from "../../controllers/propertyController/whtRemittance.js";

const router = express.Router();

const can = (action) => requireCompanyPermission("taxRemittance", action, "accounts");

router.get("/summary",    verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getWhtReturnSummary);
router.get("/",           verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getWhtRemittanceHistory);
router.post("/remit",     verifyUser, can("process"), remitWht);
router.patch("/:id/void", verifyUser, can("reverse"), voidWhtRemittance);

export default router;
