import express from "express";
import { verifyUser } from "../../controllers/verifyToken.js";
import {
  getMeterReadings,
  createMeterReading,
  createMeterReadingsBatch,
  updateMeterReading,
  deleteMeterReading,
  deleteMeterReadingsBatch,
  voidMeterReading,
  billMeterReading,
  billMeterReadingsBatch,
} from "../../controllers/propertyController/meterReadings.js";

const router = express.Router();

router.get("/", verifyUser, getMeterReadings);
router.post("/", verifyUser, createMeterReading);
router.post("/batch", verifyUser, createMeterReadingsBatch);
router.post("/batch-bill", verifyUser, billMeterReadingsBatch);
router.post("/batch-delete", verifyUser, deleteMeterReadingsBatch);
router.put("/:id", verifyUser, updateMeterReading);
router.delete("/:id", verifyUser, deleteMeterReading);
router.patch("/:id/void", verifyUser, voidMeterReading);
router.post("/:id/bill", verifyUser, billMeterReading);

export default router;
