// routes/utility.js
import express from "express"
import { 
  createUtility, 
  getUtility, 
  getUtilities, 
  updateUtility, 
  deleteUtility,
  
} from "../../controllers/propertyController/utilities.js"
import { verifyUser } from "../../controllers/verifyToken.js"

const router = express.Router()

// Create utility
router.post("/", verifyUser, createUtility)

// Get all utilities
router.get("/", verifyUser, getUtilities)

// Get single utility
router.get("/:id", verifyUser, getUtility)

// Update utility
router.put("/:id", verifyUser, updateUtility)

// Delete utility
router.delete("/:id", verifyUser, deleteUtility)
export default router