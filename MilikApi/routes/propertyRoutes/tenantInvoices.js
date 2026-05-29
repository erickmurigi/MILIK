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
import { generateInvoicePdf } from "../../services/invoicePdfService.js";

const router = express.Router();

// Static / collection routes — must come before any /:id patterns
router.get("/", verifyUser, getTenantInvoicesList);
router.get("/note-charge-types", verifyUser, getTenantInvoiceNoteChargeTypes);
router.get("/notes", verifyUser, getTenantInvoiceNotes);
router.get("/creditable", verifyUser, getCreditableTenantInvoices);
router.get("/take-on-balances", verifyUser, getTakeOnBalances);

router.post("/", verifyUser, createTenantInvoice);
router.post("/batch", verifyUser, createTenantInvoicesBatch);
router.post("/notes", verifyUser, createTenantInvoiceNote);
router.post("/notes/:id/reverse", verifyUser, reverseTenantInvoiceNote);

// Parameterised routes
router.get("/:id/pdf", verifyUser, async (req, res, next) => {
  try {
    const businessId = String(req.user?.company || req.user?.business || "");
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
router.put("/:id/take-on-balance", verifyUser, updateTakeOnBalance);
router.delete("/:id", verifyUser, deleteTenantInvoice);
router.delete("/notes/:id", verifyUser, reverseTenantInvoiceNote);

export default router;
