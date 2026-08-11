// routes/rentPayment.js
import express from "express"
import {
  batchCreatePayments,
  createPayment,
  getPayment,
  getPayments,
  getPaymentAllocationOptions,
  updatePayment,
  updatePaymentAllocations,
  deletePayment,
  confirmPayment,
  unconfirmPayment,
  reversePayment,
  cancelReversal,
  getPaymentSummary,
  fixTakeOnDepositClassification
} from "../../controllers/propertyController/rentPayment.js"
import { verifyUser } from "../../controllers/verifyToken.js"
import { generateReceiptPdf } from "../../services/receiptPdfService.js"

const router = express.Router()

// Backfill take-on deposit receipts misclassified as rent (must be before /:id routes)
router.post("/fix-takeon-deposits/:businessId", verifyUser, fixTakeOnDepositClassification)

// Batch create receipts (must be before /:id routes)
router.post("/batch", verifyUser, batchCreatePayments)

// Create payment
router.post("/", verifyUser, createPayment)

// Get all payments
router.get("/", verifyUser, getPayments)

// Get payment summary
router.get("/get/summary", verifyUser, getPaymentSummary)

// Download/preview receipt PDF
router.get("/:id/pdf", verifyUser, async (req, res, next) => {
  try {
    const businessId = String(
      req.headers?.["x-active-company-id"] ||
      req.user?.company?._id ||
      req.user?.company ||
      req.user?.business ||
      ""
    );
    const pdfBuffer = await generateReceiptPdf(req.params.id, businessId);
    const disposition = req.query?.preview === "true" ? "inline" : "attachment";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `${disposition}; filename="Receipt-${req.params.id}.pdf"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
})

// Get single payment
router.get("/:id", verifyUser, getPayment)

// Receipt allocation workspace
router.get("/:id/allocation-options", verifyUser, getPaymentAllocationOptions)

// Update receipt allocations without rewriting posted ledger entries
router.put("/:id/allocations", verifyUser, updatePaymentAllocations)

// Update payment
router.put("/:id", verifyUser, updatePayment)

// Delete payment
router.delete("/:id", verifyUser, deletePayment)

// Confirm payment
router.put("/confirm/:id", verifyUser, confirmPayment)

// Unconfirm payment - allows unconfirming to enable deletion
router.put("/unconfirm/:id", verifyUser, unconfirmPayment)

// Cancel a reversal and restore original receipt (must be before /reverse/:id to avoid param collision)
router.put("/reverse/cancel/:id", verifyUser, cancelReversal)

// Reverse payment/receipt (audit-safe alternative to delete)
router.put("/reverse/:id", verifyUser, reversePayment)

export default router