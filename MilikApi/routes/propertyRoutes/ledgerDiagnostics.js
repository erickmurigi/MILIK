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
  repairClearAbnormalBalance,
  repairRecomputeBalances,
  repairRepostInvoices,
  reverseGlCorrectionEntry,
  voidReversedCorrections,
  getActiveCorrections,
  getGroupEntries,
  getEntriesBySource,
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
router.post("/repair/clear-abnormal-balance", verifyUser, requireCompanyModule("accounts"), repairClearAbnormalBalance);
router.post("/repair/recompute-balances", verifyUser, requireCompanyModule("accounts"), repairRecomputeBalances);
router.post("/repair/repost-invoices", verifyUser, requireCompanyModule("accounts"), repairRepostInvoices);
router.post("/repair/reverse-correction/:groupId", verifyUser, requireCompanyModule("accounts"), reverseGlCorrectionEntry);
router.post("/repair/void-reversed-corrections", verifyUser, requireCompanyModule("accounts"), voidReversedCorrections);
router.get("/repair/active-corrections", verifyUser, requireCompanyModule("accounts"), getActiveCorrections);
router.get("/repair/group-entries/:groupId", verifyUser, requireCompanyModule("accounts"), getGroupEntries);

// ─── UNIVERSAL GL-by-source lookup (used by all transaction detail drawers) ──
router.get("/entries", verifyToken, getEntriesBySource);

export default router;
