// routes/tenant.js
import express from "express"
import mongoose from "mongoose"
import {
  createTenant,
  getTenant,
  getTenants,
  updateTenant,
  deleteTenant,
  batchDeleteTenants,
  updateTenantStatus,
  getTenantPayments,
  getTenantBalance,
  getTenantTotalDue,
  getTenantStatementBundle,
  migrateTenantCodes,
  bulkImportTenants,
  transferTenantUnit,
  rollbackTenantTransfer,
  backfillMissingLeases,
} from "../../controllers/propertyController/tenants.js"
import { requireCompanyPermission, verifyUser } from "../../controllers/verifyToken.js"

const router = express.Router()

const canRefundDeposit = requireCompanyPermission("deposits", "refund", "propertyManagement");

// Terminating a tenant always settles/computes their deposit refund as part of
// the same request (see updateTenantStatus), even when the client sends no
// deposit fields explicitly — so the only reliable signal here is the status
// transition itself, not body-field presence.
const guardStatusDepositRefund = (req, res, next) => {
  const requestedStatus = String(req.body?.status || "").toLowerCase();
  const status = requestedStatus === "moved_out" ? "terminated" : requestedStatus;
  if (status === "terminated") return canRefundDeposit(req, res, next);
  next();
};

// The general tenant-update route can also directly edit a previously recorded
// deposit refund — gate only requests that actually touch those fields.
const guardUpdateDepositRefund = (req, res, next) => {
  const body = req.body || {};
  if (
    body.depositRefundAmount !== undefined ||
    body.depositRefundStatus !== undefined ||
    body.depositRefundReference !== undefined
  ) {
    return canRefundDeposit(req, res, next);
  }
  next();
};

// Create tenant
router.post("/", verifyUser, createTenant)

// Bulk import tenants from Excel
router.post("/bulk-import", verifyUser, bulkImportTenants)

// Batch delete tenants
router.post("/batch-delete", verifyUser, batchDeleteTenants)

// Get all tenants
router.get("/", verifyUser, getTenants)

// Get tenant statement bundle (tenant + leases + receipts + invoices + notes in one round trip)
router.get("/:id/statement-bundle", verifyUser, getTenantStatementBundle)

// Get single tenant
router.get("/:id", verifyUser, getTenant)

// Update tenant
router.put("/:id", verifyUser, guardUpdateDepositRefund, updateTenant)

// Transfer tenant primary unit
router.post("/:id/transfer-unit", verifyUser, transferTenantUnit)

// Undo the tenant's most recent unit transfer
router.post("/:id/rollback-transfer", verifyUser, rollbackTenantTransfer)

// Delete tenant
router.delete("/:id", verifyUser, deleteTenant)

// Update tenant status
router.put("/status/:id", verifyUser, guardStatusDepositRefund, updateTenantStatus)

// Get tenant payments
router.get("/payments/:id", verifyUser, getTenantPayments)

// Get tenant balance
router.get("/balance/:id", verifyUser, getTenantBalance)

// Migration: Assign codes to existing tenants without codes
router.post("/migrate-codes", verifyUser, migrateTenantCodes)

// Backfill: Create lease agreements for active tenants that don't have one
router.post("/backfill-leases", verifyUser, backfillMissingLeases)

router.get('/:id/total-due', verifyUser, async (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: "Invalid tenant ID" });
  }
  try {
    const totalDue = await getTenantTotalDue(req.params.id);
    res.status(200).json(totalDue);
  } catch (err) {
    next(err);
  }
});
export default router