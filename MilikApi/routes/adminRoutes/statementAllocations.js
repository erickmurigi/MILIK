import express from "express";
import { verifyUser } from "../../controllers/verifyToken.js";
import {
  searchTransactions,
  adjustBookingDate,
  reallocatePayment,
  getTenantInvoicesForRealloc,
  getAdjustmentHistory,
  recomputeTenantState,
} from "../../controllers/adminController/statementAllocations.js";

const router = express.Router();

router.get("/search",          verifyUser, searchTransactions);
router.get("/invoices",        verifyUser, getTenantInvoicesForRealloc);
router.get("/history",         verifyUser, getAdjustmentHistory);
router.patch("/booking-date",         verifyUser, adjustBookingDate);
router.patch("/reallocate",           verifyUser, reallocatePayment);
router.post("/recompute",             verifyUser, recomputeTenantState);

export default router;
