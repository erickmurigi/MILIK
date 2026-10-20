import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { attachAdvocateScope } from "../middleware/advocateScope.js";
import { createOwner, deleteOwner, getOwner, listOwners, updateOwner } from "../controllers/ownersController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"), attachAdvocateScope);
router.get("/", requireCompanyPermission("sale-owners", "view", "propertySale"), listOwners);
router.get("/:id", requireCompanyPermission("sale-owners", "view", "propertySale"), getOwner);
router.post("/", requireCompanyPermission("sale-owners", "create", "propertySale"), createOwner);
router.put("/:id", requireCompanyPermission("sale-owners", "update", "propertySale"), updateOwner);
router.delete("/:id", requireCompanyPermission("sale-owners", "update", "propertySale"), deleteOwner);

export default router;
