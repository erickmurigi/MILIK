import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { attachAdvocateScope } from "../middleware/advocateScope.js";
import {
  createRemittance, getAdvocateTrustBalance, getRemittance, listRemittances,
} from "../controllers/advocateRemittancesController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"), attachAdvocateScope);

// Advocate-linked users record their own remittances ("payouts" of what they've collected) under a
// narrower permission ("sale-advocate-remittances") than the staff-facing "sale-advocates" permission
// used to manage the Advocates directory — they never get the ability to manage other advocates, only
// view + create on their own scoped records (enforced by attachAdvocateScope + the controller's own
// req.saleAdvocateId checks, not by this permission check).
const viewPermission   = (req, res, next) => requireCompanyPermission(req.saleAdvocateId ? "sale-advocate-remittances" : "sale-advocates", "view", "propertySale")(req, res, next);
// Non-scoped (staff) callers keep the exact "manage" requirement this always had — only the new
// advocate-scoped branch gets the narrower "create" tier on its own dedicated permission.
const createPermission = (req, res, next) => (req.saleAdvocateId
  ? requireCompanyPermission("sale-advocate-remittances", "create", "propertySale")(req, res, next)
  : requireCompanyPermission("sale-advocates", "manage", "propertySale")(req, res, next));

router.get("/", viewPermission, listRemittances);
router.get("/balance/:advocateId", viewPermission, getAdvocateTrustBalance);
router.get("/:id", viewPermission, getRemittance);
router.post("/", createPermission, createRemittance);

export default router;
