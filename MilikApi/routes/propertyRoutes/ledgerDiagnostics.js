import express from "express";
import { verifyToken, verifyUser, verifyAdmin, requireCompanyModule } from "../../controllers/verifyToken.js";
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
  voidOrphanedJournalGroup,
  getActiveCorrections,
  getGroupEntries,
  getEntriesBySource,
} from "../../controllers/propertyController/ledgerDiagnostics.js";

const router = express.Router();

// ─── EXISTING DIAGNOSTIC ENDPOINTS ───────────────────────────────────────────
router.get("/diagnostics/invoices/:propertyId/:landlordId", verifyUser, requireCompanyModule("accounts"), checkInvoiceLedgerEntries);
router.post("/diagnostics/repost-invoices", verifyAdmin, repostInvoicesToLedger);
router.post("/diagnostics/recompute-chart-balances", verifyAdmin, recomputeChartBalances);
router.get("/diagnostics/utility-receipts", verifyUser, requireCompanyModule("accounts"), checkUtilityReceiptLedgerEntries);
router.get("/diagnostics/ledger-balance", verifyUser, requireCompanyModule("accounts"), checkLedgerBalance);
router.get("/diagnostics/integrity-report", verifyUser, requireCompanyModule("accounts"), runIntegrityReport);

// ─── GL HEALTH CENTRE ────────────────────────────────────────────────────────
router.get("/health-history", verifyUser, requireCompanyModule("accounts"), getHealthHistory);
router.post("/repair/balance-group/:groupId", verifyUser, requireCompanyModule("accounts"), repairBalanceGroup);
router.post("/repair/clear-abnormal-balance", verifyUser, requireCompanyModule("accounts"), repairClearAbnormalBalance);
router.post("/repair/recompute-balances", verifyUser, requireCompanyModule("accounts"), repairRecomputeBalances);
router.post("/repair/repost-invoices", verifyUser, requireCompanyModule("accounts"), repairRepostInvoices);
router.post("/repair/reverse-correction/:groupId", verifyUser, requireCompanyModule("accounts"), reverseGlCorrectionEntry);
router.post("/repair/void-reversed-corrections", verifyUser, requireCompanyModule("accounts"), voidReversedCorrections);
router.post("/repair/void-orphaned-group/:groupId", verifyUser, requireCompanyModule("accounts"), voidOrphanedJournalGroup);
router.get("/repair/active-corrections", verifyUser, requireCompanyModule("accounts"), getActiveCorrections);
router.get("/repair/group-entries/:groupId", verifyUser, requireCompanyModule("accounts"), getGroupEntries);

// ─── UNIVERSAL GL-by-source lookup (used by all transaction detail drawers) ──
router.get("/entries", verifyUser, requireCompanyModule("accounts"), getEntriesBySource);

export default router;
