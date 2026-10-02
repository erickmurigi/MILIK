import express from "express";
import { requireCompanyPermission, verifyUser } from "../../controllers/verifyToken.js";
import {
  createServiceProvider,
  deleteServiceProvider,
  getServiceProviders,
  updateServiceProvider,
  getCreditorsSummary,
  getCreditorStatement,
} from "../../controllers/propertyController/serviceProviders.js";

const router = express.Router();

const canViewCreditorLedger = requireCompanyPermission("creditorLedger", "view", "accounts");

router.get("/creditors/summary", verifyUser, canViewCreditorLedger, getCreditorsSummary);
router.get("/creditors/:id/statement", verifyUser, canViewCreditorLedger, getCreditorStatement);
router.get("/", verifyUser, getServiceProviders);
router.post("/", verifyUser, createServiceProvider);
router.put("/:id", verifyUser, updateServiceProvider);
router.delete("/:id", verifyUser, deleteServiceProvider);

export default router;
