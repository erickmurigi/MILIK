import express from "express";
import { verifyUser } from "../../controllers/verifyToken.js";
import {
  createLandlordStandingOrder,
  deleteLandlordStandingOrder,
  getLandlordStandingOrders,
  runLandlordStandingOrder,
  updateLandlordStandingOrder,
  updateLandlordStandingOrderStatus,
} from "../../controllers/propertyController/landlordStandingOrders.js";

const router = express.Router();

router.get("/", verifyUser, getLandlordStandingOrders);
router.post("/", verifyUser, createLandlordStandingOrder);
router.put("/:id", verifyUser, updateLandlordStandingOrder);
router.put("/:id/status", verifyUser, updateLandlordStandingOrderStatus);
router.post("/:id/run", verifyUser, runLandlordStandingOrder);
router.delete("/:id", verifyUser, deleteLandlordStandingOrder);

export default router;
