import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { attachAdvocateScope } from "../middleware/advocateScope.js";
import {
  createOwnerPayout, getAdvocateOwnerTrustSummary, getOwnerOutstandingBalance, getOwnerPayout,
  listOwnerPayouts, voidOwnerPayout,
} from "../controllers/ownerPayoutsController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"), attachAdvocateScope);
router.get("/", requireCompanyPermission("sale-owners", "view", "propertySale"), listOwnerPayouts);
router.get("/balance/:ownerId", requireCompanyPermission("sale-owners", "view", "propertySale"), getOwnerOutstandingBalance);
router.get("/trust-summary/:ownerId", requireCompanyPermission("sale-owners", "view", "propertySale"), getAdvocateOwnerTrustSummary);
router.get("/:id", requireCompanyPermission("sale-owners", "view", "propertySale"), getOwnerPayout);
// A dedicated, narrower permission for advocate-scoped callers — NOT the broad "sale-owners:create"
// staff keep, which also governs creating owner records themselves (owners.js). Mirrors
// advocateRemittances.js's view/createPermission split for the exact same reason.
const createPermission = (req, res, next) => (req.saleAdvocateId
  ? requireCompanyPermission("sale-owner-payouts", "create", "propertySale")(req, res, next)
  : requireCompanyPermission("sale-owners", "create", "propertySale")(req, res, next));
router.post("/", createPermission, createOwnerPayout);
router.patch("/:id/void", requireCompanyPermission("sale-owners", "update", "propertySale"), voidOwnerPayout);

export default router;
