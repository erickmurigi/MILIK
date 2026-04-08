import express from "express";
import { verifyUser } from "../../controllers/verifyToken.js";
import {
  createInspection,
  deleteInspection,
  getInspection,
  getInspections,
  getInspectionStats,
  updateInspection,
} from "../../controllers/propertyController/inspection.js";

const router = express.Router();

router.post("/", verifyUser, createInspection);
router.get("/", verifyUser, getInspections);
router.get("/get/stats", verifyUser, getInspectionStats);
router.get("/:id", verifyUser, getInspection);
router.put("/:id", verifyUser, updateInspection);
router.delete("/:id", verifyUser, deleteInspection);

export default router;
