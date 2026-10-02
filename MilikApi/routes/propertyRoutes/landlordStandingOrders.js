import express from "express";
import { requireCompanyPermission, verifyUser } from "../../controllers/verifyToken.js";
import {
  createLandlordStandingOrder,
  deleteLandlordStandingOrder,
  getLandlordStandingOrders,
  reverseLandlordStandingOrderRun,
  runLandlordStandingOrder,
  runLandlordStandingOrdersBatch,
  updateLandlordStandingOrder,
  updateLandlordStandingOrderStatus,
} from "../../controllers/propertyController/landlordStandingOrders.js";

const router = express.Router();

const can = (action) => requireCompanyPermission("standingOrders", action, "accounts");

router.get("/", verifyUser, can("view"), getLandlordStandingOrders);
router.post("/", verifyUser, can("create"), createLandlordStandingOrder);
router.post("/batch-run", verifyUser, can("process"), runLandlordStandingOrdersBatch);
router.put("/:id", verifyUser, can("update"), updateLandlordStandingOrder);
router.put("/:id/status", verifyUser, can("update"), updateLandlordStandingOrderStatus);
router.post("/:id/run", verifyUser, can("process"), runLandlordStandingOrder);
router.post("/:id/runs/:runId/reverse", verifyUser, can("reverse"), reverseLandlordStandingOrderRun);
router.delete("/:id", verifyUser, can("delete"), deleteLandlordStandingOrder);

export default router;
