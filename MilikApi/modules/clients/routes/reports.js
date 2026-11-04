import express from "express";
import { verifyUser } from "../../../controllers/verifyToken.js";
import {
  arAging,
  dashboard,
  billingForecast,
  revenue,
  contractRegister,
  renewals,
  salesVat,
  whtCertificates,
} from "../controllers/reportsController.js";

const router = express.Router();

router.use(verifyUser);

router.get("/ar-aging",           arAging);
router.get("/dashboard",          dashboard);
router.get("/billing-forecast",   billingForecast);
router.get("/revenue",            revenue);
router.get("/contract-register",  contractRegister);
router.get("/renewals",           renewals);
router.get("/sales-vat",          salesVat);
router.get("/wht-certificates",   whtCertificates);

export default router;
