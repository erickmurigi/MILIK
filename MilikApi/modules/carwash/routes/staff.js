import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { createStaff, deleteStaff, listStaff, updateStaff } from "../controllers/staffController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("carwash"));
router.get("/", requireCompanyPermission("carwash-staff", "view", "carwash"), listStaff);
router.post("/", requireCompanyPermission("carwash-staff", "manage", "carwash"), createStaff);
router.put("/:id", requireCompanyPermission("carwash-staff", "manage", "carwash"), updateStaff);
router.delete("/:id", requireCompanyPermission("carwash-staff", "manage", "carwash"), deleteStaff);

export default router;
