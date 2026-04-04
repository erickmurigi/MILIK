import express from "express";
import { verifyUser } from "../../controllers/verifyToken.js";
import {
  createLandlordStandingOrder,
  deleteLandlordStandingOrder,
  listLandlordStandingOrders,
  updateLandlordStandingOrder,
} from "../../controllers/propertyController/landlordStandingOrders.js";

const router = express.Router();

router.get("/", verifyUser, listLandlordStandingOrders);
router.post("/", verifyUser, createLandlordStandingOrder);
router.put("/:id", verifyUser, updateLandlordStandingOrder);
router.delete("/:id", verifyUser, deleteLandlordStandingOrder);

export default router;
