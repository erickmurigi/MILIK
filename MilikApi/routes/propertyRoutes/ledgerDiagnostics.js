import express from "express";
import { verifyToken } from "../../controllers/verifyToken.js";
import {
  checkInvoiceLedgerEntries,
  repostInvoicesToLedger,
  recomputeChartBalances,
  checkUtilityReceiptLedgerEntries,
} from "../../controllers/propertyController/ledgerDiagnostics.js";

const router = express.Router();

router.get("/diagnostics/invoices/:propertyId/:landlordId", verifyToken, checkInvoiceLedgerEntries);
router.post("/diagnostics/repost-invoices", verifyToken, repostInvoicesToLedger);
router.post("/diagnostics/recompute-chart-balances", verifyToken, recomputeChartBalances);
router.get("/diagnostics/utility-receipts", verifyToken, checkUtilityReceiptLedgerEntries);

export default router;