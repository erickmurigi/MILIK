import express from "express";
import { verifyUser, verifySuperAdmin } from "../../controllers/verifyToken.js";
import {
  searchTransactions,
  adjustBookingDate,
  reallocatePayment,
  getTenantInvoicesForRealloc,
  getAdjustmentHistory,
  recomputeTenantState,
} from "../../controllers/adminController/statementAllocations.js";

const router = express.Router();

// All routes in this file are system-admin only. verifySuperAdmin enforces this at the
// route layer (the controller also verifies, providing defense-in-depth).
router.get("/search",          verifySuperAdmin, searchTransactions);
router.get("/invoices",        verifySuperAdmin, getTenantInvoicesForRealloc);
router.get("/history",         verifySuperAdmin, getAdjustmentHistory);
router.patch("/booking-date",  verifySuperAdmin, adjustBookingDate);
router.patch("/reallocate",    verifySuperAdmin, reallocatePayment);
router.post("/recompute",      verifySuperAdmin, recomputeTenantState);

export default router;
