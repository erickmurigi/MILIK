// routes/maintenance.js
import express from "express"
import { 
  createMaintenance, 
  getMaintenance, 
  getMaintenances, 
  updateMaintenance, 
  deleteMaintenance,
  updateMaintenanceStatus,
  getMaintenanceStats 
} from "../../controllers/propertyController/maintenance.js"
import { verifyUser } from "../../controllers/verifyToken.js"

const router = express.Router()

// Create maintenance
router.post("/", verifyUser, createMaintenance)

// Get all maintenances
router.get("/", verifyUser, getMaintenances)

// Get maintenance stats
router.get("/get/stats", verifyUser, getMaintenanceStats)

// Get single maintenance
router.get("/:id", verifyUser, getMaintenance)

// Update maintenance
router.put("/:id", verifyUser, updateMaintenance)

// Delete maintenance
router.delete("/:id", verifyUser, deleteMaintenance)

// Update maintenance status
router.put("/status/:id", verifyUser, updateMaintenanceStatus)

export default router