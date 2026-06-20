import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import {
  cleanupLegacySavings,
  createCommissionPayout,
  createSavingsPayout,
  getStaffWallet,
  initializeSavings,
  listCommissionPayouts,
  listCommissionRules,
  listCommissions,
  listSavings,
  listSavingsBalances,
  resetSavings,
  reverseCommissionPayout,
  reverseEarnedCommission,
  reverseSavingsPayout,
  upsertCommissionRule,
} from "../controllers/commissionsController.js";
import { createDamage, deleteDamage, listDamages, listDamagesBalances, waiveDamage } from "../controllers/damagesController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("carwash"));
router.get("/rules",  requireCompanyPermission("carwash-commissions", "view",   "carwash"), listCommissionRules);
router.post("/rules", requireCompanyPermission("carwash-commissions", "manage", "carwash"), upsertCommissionRule);
router.put("/rules/:id", requireCompanyPermission("carwash-commissions", "manage", "carwash"), upsertCommissionRule);
router.get("/",       requireCompanyPermission("carwash-commissions", "view",   "carwash"), listCommissions);
router.post("/:id/reverse", requireCompanyPermission("carwash-commissions", "manage", "carwash"), reverseEarnedCommission);
router.get("/payouts",        requireCompanyPermission("carwash-commissions", "view",   "carwash"), listCommissionPayouts);
router.post("/payouts",       requireCompanyPermission("carwash-commissions", "pay",    "carwash"), createCommissionPayout);
router.post("/payouts/:id/reverse", requireCompanyPermission("carwash-commissions", "pay", "carwash"), reverseCommissionPayout);
router.get("/savings",          requireCompanyPermission("carwash-commissions", "view", "carwash"), listSavings);
router.get("/savings/balances", requireCompanyPermission("carwash-commissions", "view", "carwash"), listSavingsBalances);
router.post("/savings/payouts",           requireCompanyPermission("carwash-commissions", "pay", "carwash"), createSavingsPayout);
router.post("/savings/payouts/:id/reverse", requireCompanyPermission("carwash-commissions", "pay", "carwash"), reverseSavingsPayout);
router.post("/savings/initialize", requireCompanyPermission("carwash-commissions", "manage", "carwash"), initializeSavings);
router.delete("/savings/legacy",   requireCompanyPermission("carwash-commissions", "manage", "carwash"), cleanupLegacySavings);
router.delete("/savings/reset",    requireCompanyPermission("carwash-commissions", "manage", "carwash"), resetSavings);
router.get("/staff/:staffId/wallet", requireCompanyPermission("carwash-commissions", "view", "carwash"), getStaffWallet);
router.get("/damages",          requireCompanyPermission("carwash-commissions", "view",   "carwash"), listDamages);
router.get("/damages/balances", requireCompanyPermission("carwash-commissions", "view",   "carwash"), listDamagesBalances);
router.post("/damages",         requireCompanyPermission("carwash-commissions", "manage", "carwash"), createDamage);
router.post("/damages/:id/waive",  requireCompanyPermission("carwash-commissions", "manage", "carwash"), waiveDamage);
router.delete("/damages/:id",   requireCompanyPermission("carwash-commissions", "manage", "carwash"), deleteDamage);

export default router;
