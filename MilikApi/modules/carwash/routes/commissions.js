import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import {
  createCommissionPayout,
  createSavingsPayout,
  getStaffWallet,
  listCommissionPayouts,
  listCommissionRules,
  listCommissions,
  listSavings,
  processDailySavingsManual,
  upsertCommissionRule,
} from "../controllers/commissionsController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("carwash"));
router.get("/rules",  requireCompanyPermission("carwash-commissions", "view",   "carwash"), listCommissionRules);
router.post("/rules", requireCompanyPermission("carwash-commissions", "manage", "carwash"), upsertCommissionRule);
router.put("/rules/:id", requireCompanyPermission("carwash-commissions", "manage", "carwash"), upsertCommissionRule);
router.get("/",       requireCompanyPermission("carwash-commissions", "view",   "carwash"), listCommissions);
router.get("/payouts",  requireCompanyPermission("carwash-commissions", "view", "carwash"), listCommissionPayouts);
router.post("/payouts", requireCompanyPermission("carwash-commissions", "pay",  "carwash"), createCommissionPayout);
router.get("/savings",  requireCompanyPermission("carwash-commissions", "view", "carwash"), listSavings);
router.post("/savings/payouts",  requireCompanyPermission("carwash-commissions", "pay",  "carwash"), createSavingsPayout);
router.post("/savings/process",  requireCompanyPermission("carwash-commissions", "pay",  "carwash"), processDailySavingsManual);
router.get("/staff/:staffId/wallet", requireCompanyPermission("carwash-commissions", "view", "carwash"), getStaffWallet);

export default router;
