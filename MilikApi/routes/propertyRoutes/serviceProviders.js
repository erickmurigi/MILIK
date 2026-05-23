import express from "express";
import { verifyUser } from "../../controllers/verifyToken.js";
import {
  createServiceProvider,
  deleteServiceProvider,
  getServiceProviders,
  updateServiceProvider,
  getCreditorsSummary,
  getCreditorStatement,
} from "../../controllers/propertyController/serviceProviders.js";

const router = express.Router();

router.get("/creditors/summary", verifyUser, getCreditorsSummary);
router.get("/creditors/:id/statement", verifyUser, getCreditorStatement);
router.get("/", verifyUser, getServiceProviders);
router.post("/", verifyUser, createServiceProvider);
router.put("/:id", verifyUser, updateServiceProvider);
router.delete("/:id", verifyUser, deleteServiceProvider);

export default router;
