// routes/tenant.js
import express from "express"
import mongoose from "mongoose"
import {
  createTenant,
  getTenant,
  getTenants,
  updateTenant,
  deleteTenant,
  updateTenantStatus,
  getTenantPayments,
  getTenantBalance,
  getTenantTotalDue,
  migrateTenantCodes,
  bulkImportTenants,
  transferTenantUnit,
  backfillMissingLeases,
} from "../../controllers/propertyController/tenants.js"
import { verifyUser } from "../../controllers/verifyToken.js"

const router = express.Router()

// Create tenant
router.post("/", verifyUser, createTenant)

// Bulk import tenants from Excel
router.post("/bulk-import", verifyUser, bulkImportTenants)

// Get all tenants
router.get("/", verifyUser, getTenants)

// Get single tenant
router.get("/:id", verifyUser, getTenant)

// Update tenant
router.put("/:id", verifyUser, updateTenant)

// Transfer tenant primary unit
router.post("/:id/transfer-unit", verifyUser, transferTenantUnit)

// Delete tenant
router.delete("/:id", verifyUser, deleteTenant)

// Update tenant status
router.put("/status/:id", verifyUser, updateTenantStatus)

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