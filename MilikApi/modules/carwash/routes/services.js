import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { createService, deleteService, getService, listCategories, listServices, updateService } from "../controllers/servicesController.js";
import { validateParamId } from "../middleware/validateObjectId.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("carwash"));
router.get("/", requireCompanyPermission("carwash-services", "view", "carwash"), listServices);
router.get("/categories", requireCompanyPermission("carwash-services", "view", "carwash"), listCategories);
router.post("/", requireCompanyPermission("carwash-services", "manage", "carwash"), createService);
router.get("/:id", validateParamId(), requireCompanyPermission("carwash-services", "view", "carwash"), getService);
router.put("/:id", validateParamId(), requireCompanyPermission("carwash-services", "manage", "carwash"), updateService);
router.delete("/:id", validateParamId(), requireCompanyPermission("carwash-services", "manage", "carwash"), deleteService);

export default router;
