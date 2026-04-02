// routes/unit.js
import express from "express"
import { 
  createUnit, 
  getUnit, 
  getUnits, 
  updateUnit, 
  deleteUnit,
  updateUnitStatus,
  getAvailableUnits,
  bulkImportUnits,
  getUnitUtilities,
  addUtilityToUnit,
  removeUtilityFromUnit
} from "../../controllers/propertyController/units.js"
import { verifyUser } from "../../controllers/verifyToken.js"

const router = express.Router()

// Create unit
router.post("/", verifyUser, createUnit)

// Bulk import units
router.post("/bulk-import", verifyUser, bulkImportUnits)

// Get all units
router.get("/", verifyUser, getUnits)

// Get single unit
router.get("/:id", verifyUser, getUnit)

// Update unit
router.put("/:id", verifyUser, updateUnit)

// Delete unit
router.delete("/:id", verifyUser, deleteUnit)

// Update unit status
router.put("/status/:id", verifyUser, updateUnitStatus)

// Get available units
router.get("/find/available", verifyUser, getAvailableUnits)


router.get('/:id/utilities', verifyUser, getUnitUtilities);
router.post('/:id/utilities', verifyUser, addUtilityToUnit);
router.delete('/:unitId/utilities/:utilityId', verifyUser, removeUtilityFromUnit);
export default router