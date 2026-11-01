import express from "express";
import { requireCompanyPermission, requireCompanyModule, verifyUser } from "../../controllers/verifyToken.js";
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
// Provider list/detail is shared reference data (expense requisitions, payment vouchers and
// the creditor ledger all look vendors up from it), so viewing it only requires the Financial
// Accounting module rather than the narrower `expenses.view` action — but it must still be
// scoped to a company the requesting user actually belongs to.
const canAccessAccounts = requireCompanyModule("accounts");

router.get("/creditors/summary", verifyUser, canViewCreditorLedger, getCreditorsSummary);
router.get("/creditors/:id/statement", verifyUser, canViewCreditorLedger, getCreditorStatement);
router.get("/", verifyUser, canAccessAccounts, getServiceProviders);
router.post("/", verifyUser, requireCompanyPermission("expenses", "create", "accounts"), createServiceProvider);
router.put("/:id", verifyUser, requireCompanyPermission("expenses", "update", "accounts"), updateServiceProvider);
router.delete("/:id", verifyUser, requireCompanyPermission("expenses", "delete", "accounts"), deleteServiceProvider);

export default router;
