import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { attachAdvocateScope } from "../middleware/advocateScope.js";
import { getAdvocateTrustBalance } from "../controllers/advocateTrustController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"), attachAdvocateScope);

// Advocate-linked users can view their own trust balance under a narrower permission
// ("sale-advocate-remittances") than the staff-facing "sale-advocates" permission used to manage the
// Advocates directory.
const viewPermission = (req, res, next) => requireCompanyPermission(req.saleAdvocateId ? "sale-advocate-remittances" : "sale-advocates", "view", "propertySale")(req, res, next);

router.get("/balance/:advocateId", viewPermission, getAdvocateTrustBalance);

export default router;
