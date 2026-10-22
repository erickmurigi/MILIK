import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { attachAdvocateScope } from "../middleware/advocateScope.js";
import {
  createRechargeRemittance, getRechargeRemittance, listOutstandingRecharges,
  listRechargeRemittances, voidRechargeRemittance,
} from "../controllers/rechargeRemittancesController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"), attachAdvocateScope);

// Same permission split as advocateRemittances.js: advocate-scoped callers get the narrower
// "sale-advocate-remittances" permission (view/create on their own records only); staff keep the
// existing "sale-advocates" (manage) requirement.
const viewPermission   = (req, res, next) => requireCompanyPermission(req.saleAdvocateId ? "sale-advocate-remittances" : "sale-advocates", "view", "propertySale")(req, res, next);
const createPermission = (req, res, next) => (req.saleAdvocateId
  ? requireCompanyPermission("sale-advocate-remittances", "create", "propertySale")(req, res, next)
  : requireCompanyPermission("sale-advocates", "manage", "propertySale")(req, res, next));

router.get("/outstanding", viewPermission, listOutstandingRecharges);
router.get("/", viewPermission, listRechargeRemittances);
router.get("/:id", viewPermission, getRechargeRemittance);
router.post("/", createPermission, createRechargeRemittance);
router.patch("/:id/void", requireCompanyPermission("sale-advocates", "manage", "propertySale"), voidRechargeRemittance);

export default router;
