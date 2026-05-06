import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { createService, deleteService, getService, listServices, updateService } from "../controllers/servicesController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("carwash"));
router.get("/", requireCompanyPermission("carwash-services", "view", "carwash"), listServices);
router.get("/:id", requireCompanyPermission("carwash-services", "view", "carwash"), getService);
router.post("/", requireCompanyPermission("carwash-services", "manage", "carwash"), createService);
router.put("/:id", requireCompanyPermission("carwash-services", "manage", "carwash"), updateService);
router.delete("/:id", requireCompanyPermission("carwash-services", "manage", "carwash"), deleteService);

export default router;
