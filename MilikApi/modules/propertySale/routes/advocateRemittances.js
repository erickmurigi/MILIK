import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { attachAdvocateScope } from "../middleware/advocateScope.js";
import {
  createRemittance, getAdvocateTrustBalance, getRemittance, listRemittances,
} from "../controllers/advocateRemittancesController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"), attachAdvocateScope);
router.get("/", requireCompanyPermission("sale-advocates", "view", "propertySale"), listRemittances);
router.get("/balance/:advocateId", requireCompanyPermission("sale-advocates", "view", "propertySale"), getAdvocateTrustBalance);
router.get("/:id", requireCompanyPermission("sale-advocates", "view", "propertySale"), getRemittance);
router.post("/", requireCompanyPermission("sale-advocates", "manage", "propertySale"), createRemittance);

export default router;
