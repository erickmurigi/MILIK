import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { createBranch, deleteBranch, getBranch, listBranches, updateBranch } from "../controllers/branchController.js";
import { validateParamId } from "../middleware/validateObjectId.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("carwash"));
router.get("/", requireCompanyPermission("carwash-branches", "view", "carwash"), listBranches);
router.post("/", requireCompanyPermission("carwash-branches", "manage", "carwash"), createBranch);
router.get("/:id", validateParamId(), requireCompanyPermission("carwash-branches", "view", "carwash"), getBranch);
router.put("/:id", validateParamId(), requireCompanyPermission("carwash-branches", "manage", "carwash"), updateBranch);
router.delete("/:id", validateParamId(), requireCompanyPermission("carwash-branches", "manage", "carwash"), deleteBranch);

export default router;
