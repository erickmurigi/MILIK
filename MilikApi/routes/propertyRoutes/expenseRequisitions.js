import express from "express";
import { verifyUser, requireCompanyPermission } from "../../controllers/verifyToken.js";
import {
  batchDeleteExpenseRequisitions,
  createExpenseRequisition,
  createVendorTakeOnBalance,
  deleteExpenseRequisition,
  getExpenseRequisitions,
  updateExpenseRequisition,
  updateExpenseRequisitionStatus,
} from "../../controllers/propertyController/expenseRequisition.js";

const router = express.Router();

// accessMatrix.js declares expenses' tiers as view/create/approve/approveHighValue/update/delete —
// every route below previously only required verifyUser (logged in), with no permission check at
// all, the same gap found and fixed for petty cash earlier this session.
const can = (action) => requireCompanyPermission("expenses", action, "accounts");

// PUT /:id/status is one shared endpoint for every status transition, so the permission it needs
// depends on the target status in the body rather than being fixed per-route. The high-value
// (amount-tiered) escalation for "approved" is checked inline in the controller, since it also
// depends on the row's amount and the company's configured threshold.
const statusAction = (req) => {
  const status = String(req.body?.status || "").trim().toLowerCase();
  if (status === "approved" || status === "rejected") return "approve";
  if (status === "submitted") return "create";
  return "update"; // reopen to draft, cancel
};

router.get("/", verifyUser, can("view"), getExpenseRequisitions);
router.post("/", verifyUser, can("create"), createExpenseRequisition);
// Separate, narrower permission (mirroring the tenant take-on balance's own dedicated resource) —
// it bypasses the normal draft/submit/approve workflow and posts straight to the ledger, so it's
// deliberately not folded into the everyday `expenses.create` grant.
router.post("/take-on-balance", verifyUser, requireCompanyPermission("vendorTakeOnBalances", "create", "accounts"), createVendorTakeOnBalance);
router.post("/batch-delete", verifyUser, can("delete"), batchDeleteExpenseRequisitions);
router.put("/:id", verifyUser, can("update"), updateExpenseRequisition);
router.put("/:id/status", verifyUser, can(statusAction), updateExpenseRequisitionStatus);
router.delete("/:id", verifyUser, can("delete"), deleteExpenseRequisition);

export default router;
