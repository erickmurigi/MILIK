import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { createBranch, deleteBranch, getBranch, listBranches, updateBranch } from "../controllers/branchController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("carwash"));
router.get("/", requireCompanyPermission("carwash-branches", "view", "carwash"), listBranches);
router.get("/:id", requireCompanyPermission("carwash-branches", "view", "carwash"), getBranch);
router.post("/", requireCompanyPermission("carwash-branches", "manage", "carwash"), createBranch);
router.put("/:id", requireCompanyPermission("carwash-branches", "manage", "carwash"), updateBranch);
router.delete("/:id", requireCompanyPermission("carwash-branches", "manage", "carwash"), deleteBranch);

export default router;
