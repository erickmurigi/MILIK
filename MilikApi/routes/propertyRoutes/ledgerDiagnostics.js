import express from "express";
import { verifyToken, verifyUser, requireCompanyModule } from "../../controllers/verifyToken.js";
import {
  checkInvoiceLedgerEntries,
  repostInvoicesToLedger,
  recomputeChartBalances,
  checkUtilityReceiptLedgerEntries,
  checkLedgerBalance,
  runIntegrityReport,
  getHealthHistory,
  repairBalanceGroup,
  repairRecomputeBalances,
  repairRepostInvoices,
} from "../../controllers/propertyController/ledgerDiagnostics.js";

const router = express.Router();

// ─── EXISTING DIAGNOSTIC ENDPOINTS ───────────────────────────────────────────
router.get("/diagnostics/invoices/:propertyId/:landlordId", verifyToken, checkInvoiceLedgerEntries);
router.post("/diagnostics/repost-invoices", verifyToken, repostInvoicesToLedger);
router.post("/diagnostics/recompute-chart-balances", verifyToken, recomputeChartBalances);
router.get("/diagnostics/utility-receipts", verifyToken, checkUtilityReceiptLedgerEntries);
router.get("/diagnostics/ledger-balance", verifyToken, checkLedgerBalance);
router.get("/diagnostics/integrity-report", verifyUser, requireCompanyModule("accounts"), runIntegrityReport);

// ─── GL HEALTH CENTRE ────────────────────────────────────────────────────────
router.get("/health-history", verifyUser, requireCompanyModule("accounts"), getHealthHistory);
router.post("/repair/balance-group/:groupId", verifyUser, requireCompanyModule("accounts"), repairBalanceGroup);
router.post("/repair/recompute-balances", verifyUser, requireCompanyModule("accounts"), repairRecomputeBalances);
router.post("/repair/repost-invoices", verifyUser, requireCompanyModule("accounts"), repairRepostInvoices);

export default router;
