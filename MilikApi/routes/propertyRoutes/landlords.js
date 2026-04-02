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
import { verifyUser } from "../../controllers/verifyToken.js"

const router = express.Router()

// Create landlord
router.post("/", verifyUser, createLandlord)

// Bulk import landlords
router.post("/bulk-import", verifyUser, bulkImportLandlords)

// Get all landlords
router.get("/", verifyUser, getLandlords)

// Get single landlord
router.get("/:id", verifyUser, getLandlord)

// Update landlord
router.put("/:id", verifyUser, updateLandlord)

// Delete landlord
router.delete("/:id", verifyUser, deleteLandlord)

// Get landlord stats
router.get("/stats/:id", verifyUser, getLandlordStats)

export default router