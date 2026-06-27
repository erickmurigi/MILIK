import express from "express";
import { verifyToken, verifyUser, requireCompanyModule } from "../../controllers/verifyToken.js";
import {
  checkInvoiceLedgerEntries,
  repostInvoicesToLedger,
  recomputeChartBalances,
  checkUtilityReceiptLedgerEntries,
  checkLedgerBalance,
  runIntegrityReport,
} from "../../controllers/propertyController/ledgerDiagnostics.js";

const router = express.Router();

router.get("/diagnostics/invoices/:propertyId/:landlordId", verifyToken, checkInvoiceLedgerEntries);
router.post("/diagnostics/repost-invoices", verifyToken, repostInvoicesToLedger);
router.post("/diagnostics/recompute-chart-balances", verifyToken, recomputeChartBalances);
router.get("/diagnostics/utility-receipts", verifyToken, checkUtilityReceiptLedgerEntries);
router.get("/diagnostics/ledger-balance", verifyToken, checkLedgerBalance);
router.get("/diagnostics/integrity-report", verifyUser, requireCompanyModule("accounts"), runIntegrityReport);

export default router;
