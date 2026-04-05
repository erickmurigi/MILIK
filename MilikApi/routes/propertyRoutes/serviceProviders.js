import express from "express";
import { verifyUser } from "../../controllers/verifyToken.js";
import {
  createServiceProvider,
  deleteServiceProvider,
  getServiceProviders,
  updateServiceProvider,
} from "../../controllers/propertyController/serviceProviders.js";

const router = express.Router();

router.get("/", verifyUser, getServiceProviders);
router.post("/", verifyUser, createServiceProvider);
router.put("/:id", verifyUser, updateServiceProvider);
router.delete("/:id", verifyUser, deleteServiceProvider);

export default router;
