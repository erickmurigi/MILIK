// routes/landlord.js
import express from "express"
import { 
  createLandlord, 
  getLandlord, 
  getLandlords, 
  updateLandlord, 
  deleteLandlord, 
  getLandlordStats,
  bulkImportLandlords
} from "../../controllers/propertyController/landlord.js"
import { verifyUser, requireCompanyPermission } from "../../controllers/verifyToken.js"

const router = express.Router()

const canView   = requireCompanyPermission("landlords", "view",   "propertyManagement");
const canCreate = requireCompanyPermission("landlords", "create", "propertyManagement");
const canUpdate = requireCompanyPermission("landlords", "update", "propertyManagement");
const canDelete = requireCompanyPermission("landlords", "delete", "propertyManagement");

// Create landlord
router.post("/", verifyUser, canCreate, createLandlord)

// Bulk import landlords
router.post("/bulk-import", verifyUser, canCreate, bulkImportLandlords)

// Get all landlords
router.get("/", verifyUser, canView, getLandlords)

// Get single landlord
router.get("/:id", verifyUser, canView, getLandlord)

// Update landlord
router.put("/:id", verifyUser, canUpdate, updateLandlord)

// Delete landlord
router.delete("/:id", verifyUser, canDelete, deleteLandlord)

// Get landlord stats
router.get("/stats/:id", verifyUser, canView, getLandlordStats)

export default router