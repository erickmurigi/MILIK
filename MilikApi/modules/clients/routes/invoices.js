import express from "express";
import { verifyUser, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { validateParamId } from "../middleware/validateObjectId.js";
import { resolveActiveBusinessId } from "../services/businessScope.js";
import { generateClientInvoicePdf } from "../services/clientInvoicePdfService.js";
import {
  listInvoices,
  getInvoice,
  createInvoice,
  updateInvoice,
  recordPayment,
  listPayments,
  reversePayment,
  sendInvoice,
  cancelInvoice,
  postInvoice,
} from "../controllers/invoicesController.js";
import { createCreditNote, createDebitNote } from "../controllers/creditNotesController.js";

const router = express.Router();

router.use(verifyUser);

const can = (action) => requireCompanyPermission("clientInvoices", action, "clients");

router.get("/",                              listInvoices);
router.post("/",                             createInvoice);
router.get("/:id",    validateParamId(),     getInvoice);
router.get("/:id/pdf", validateParamId(), async (req, res, next) => {
  try {
    const businessId = resolveActiveBusinessId(req);
    const pdfBuffer = await generateClientInvoicePdf(req.params.id, businessId);
    const disposition = req.query?.preview === "true" ? "inline" : "attachment";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `${disposition}; filename="Invoice-${req.params.id}.pdf"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});
router.put("/:id",    validateParamId(),     updateInvoice);
router.get("/:id/payments",                  validateParamId(), listPayments);
router.post("/:id/payments",                 validateParamId(), recordPayment);
router.post("/:id/payments/:paymentId/reverse", validateParamId(), validateParamId("paymentId"), reversePayment);
router.post("/:id/send",       validateParamId(), sendInvoice);
router.post("/:id/post",       validateParamId(), can("post"), postInvoice);
router.post("/:id/credit-notes", validateParamId(), requireCompanyPermission("clientCreditNotes", "create", "clients"), createCreditNote);
router.post("/:id/debit-notes",  validateParamId(), requireCompanyPermission("clientCreditNotes", "create", "clients"), createDebitNote);
router.delete("/:id",          validateParamId(), cancelInvoice);

export default router;
