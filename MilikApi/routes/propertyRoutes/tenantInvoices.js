import express from "express";
import { requireCompanyPermission, verifyUser } from "../../controllers/verifyToken.js";
import { resolveBusinessId } from "../../utils/requestContext.js";
import {
  createTenantInvoice,
  createTenantInvoicesBatch,
  deleteTenantInvoice,
  deleteTenantInvoicesBatch,
  createTenantInvoiceNote,
  reverseTenantInvoiceNote,
  getTenantInvoiceNotes,
  getCreditableTenantInvoices,
  getTenantInvoiceNoteChargeTypes,
  getTenantInvoicesList,
  getTenantInvoiceById,
  getTakeOnBalances,
  updateTakeOnBalance,
  bulkImportInvoiceNotes,
  bulkImportTakeOnBalances,
} from "../../controllers/propertyController/tenantInvoices.js";
import TenantInvoice from "../../models/TenantInvoice.js";
import { generateInvoicePdf } from "../../services/invoicePdfService.js";
import { generateNotePdf } from "../../services/notePdfService.js";

const router = express.Router();

const canViewTakeOnBalances = requireCompanyPermission("takeOnBalances", "view", "propertyManagement");
const canUpdateTakeOnBalance = requireCompanyPermission("takeOnBalances", "update", "propertyManagement");
const canCreateTakeOnBalance = requireCompanyPermission("takeOnBalances", "create", "propertyManagement");

// Static / collection routes — must come before any /:id patterns
router.get("/", verifyUser, getTenantInvoicesList);
router.get("/note-charge-types", verifyUser, getTenantInvoiceNoteChargeTypes);
router.get("/notes", verifyUser, getTenantInvoiceNotes);
router.get("/creditable", verifyUser, getCreditableTenantInvoices);
router.get("/take-on-balances", verifyUser, canViewTakeOnBalances, getTakeOnBalances);

router.post("/", verifyUser, createTenantInvoice);
router.post("/batch", verifyUser, createTenantInvoicesBatch);
router.post("/batch-delete", verifyUser, deleteTenantInvoicesBatch);
router.post("/notes", verifyUser, createTenantInvoiceNote);
router.post("/notes/bulk-import", verifyUser, bulkImportInvoiceNotes);
router.get("/notes/:id/pdf", verifyUser, async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    const pdfBuffer = await generateNotePdf(req.params.id, businessId);
    const disposition = req.query?.preview === "true" ? "inline" : "attachment";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `${disposition}; filename="Note-${req.params.id}.pdf"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});
router.post("/take-on/bulk-import", verifyUser, canCreateTakeOnBalance, bulkImportTakeOnBalances);
router.post("/notes/:id/reverse", verifyUser, reverseTenantInvoiceNote);

// Parameterised routes
router.get("/:id", verifyUser, getTenantInvoiceById);
router.get("/:id/pdf", verifyUser, async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    const pdfBuffer = await generateInvoicePdf(req.params.id, businessId);
    const disposition = req.query?.preview === "true" ? "inline" : "attachment";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `${disposition}; filename="Invoice-${req.params.id}.pdf"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});
router.put("/:id/take-on-balance", verifyUser, canUpdateTakeOnBalance, updateTakeOnBalance);
router.delete("/:id", verifyUser, deleteTenantInvoice);
router.delete("/notes/:id", verifyUser, reverseTenantInvoiceNote);

export default router;
