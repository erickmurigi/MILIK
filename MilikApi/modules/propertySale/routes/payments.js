import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { attachAgentScope } from "../middleware/agentScope.js";
import { attachAdvocateScope } from "../middleware/advocateScope.js";
import { createPayment, deletePayment, getPayment, listPayments, updatePayment, voidPayment } from "../controllers/paymentsController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"), attachAgentScope, attachAdvocateScope);

// Advocate-linked users record payments under a narrower permission ("sale-advocate-payments") than the
// regular sale-payments permission — they never get edit/void/delete, only view + create on their own
// scoped deals (enforced by attachAdvocateScope + dealScope in the controller, not by this permission check).
const viewPermission   = (req, res, next) => requireCompanyPermission(req.saleAdvocateId ? "sale-advocate-payments" : "sale-payments", "view", "propertySale")(req, res, next);
const createPermission = (req, res, next) => requireCompanyPermission(req.saleAdvocateId ? "sale-advocate-payments" : "sale-payments", "create", "propertySale")(req, res, next);

router.get("/", viewPermission, listPayments);
router.get("/:id", viewPermission, getPayment);
router.post("/", createPermission, createPayment);
router.put("/:id", requireCompanyPermission("sale-payments", "update", "propertySale"), updatePayment);
router.patch("/:id/void", requireCompanyPermission("sale-payments", "update", "propertySale"), voidPayment);
router.delete("/:id", requireCompanyPermission("sale-payments", "update", "propertySale"), deletePayment);

export default router;
