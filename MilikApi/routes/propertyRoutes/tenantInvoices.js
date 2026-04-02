import express from "express";
import { verifyUser } from "../../controllers/verifyToken.js";
import {
  createTenantInvoice,
  createTenantInvoicesBatch,
  deleteTenantInvoice,
  createTenantInvoiceNote,
  reverseTenantInvoiceNote,
  getTenantInvoiceNotes,
  getCreditableTenantInvoices,
  getTenantInvoiceNoteChargeTypes,
  getTenantInvoicesList,
  getTakeOnBalances,
  updateTakeOnBalance,
} from "../../controllers/propertyController/tenantInvoices.js";
import TenantInvoice from "../../models/TenantInvoice.js";

const router = express.Router();

// Create tenant invoice
router.post(
  "/",
  (req, res, next) => {
    console.log("ROUTE HANDLER: /api/tenant-invoices POST hit", req.body);
    next();
  },
  verifyUser,
  createTenantInvoice
);

router.post("/batch", verifyUser, createTenantInvoicesBatch);

router.put("/:id/take-on-balance", verifyUser, updateTakeOnBalance);
router.delete("/:id", verifyUser, deleteTenantInvoice);

// Credit/debit note routes
router.get("/note-charge-types", verifyUser, getTenantInvoiceNoteChargeTypes);
router.post("/notes", verifyUser, createTenantInvoiceNote);
router.delete("/notes/:id", verifyUser, reverseTenantInvoiceNote);
router.get("/notes", verifyUser, getTenantInvoiceNotes);
router.get("/creditable", verifyUser, getCreditableTenantInvoices);
router.get("/take-on-balances", verifyUser, getTakeOnBalances);

// Get tenant invoices
// Supports:
//   /api/tenant-invoices?tenant=<tenantId>
//   /api/tenant-invoices?business=<businessId>
//   /api/tenant-invoices?tenant=<tenantId>&business=<businessId>
router.get("/", verifyUser, getTenantInvoicesList);

export default router;
