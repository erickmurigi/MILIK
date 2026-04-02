import express from "express";
import { verifyUser } from "../../controllers/verifyToken.js";
import {
  getMeterReadings,
  createMeterReading,
  updateMeterReading,
  deleteMeterReading,
  voidMeterReading,
  billMeterReading,
} from "../../controllers/propertyController/meterReadings.js";

const router = express.Router();

router.get("/", verifyUser, getMeterReadings);
router.post("/", verifyUser, createMeterReading);
router.put("/:id", verifyUser, updateMeterReading);
router.delete("/:id", verifyUser, deleteMeterReading);
router.post("/:id/void", verifyUser, voidMeterReading);
router.post("/:id/bill", verifyUser, billMeterReading);

export default router;
