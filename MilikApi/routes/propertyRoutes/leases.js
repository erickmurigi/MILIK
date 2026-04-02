// routes/lease.js
import express from "express"
import { 
  createLease, 
  getLease, 
  getLeases, 
  updateLease, 
  deleteLease,
  signLease,
  getExpiringLeases,
  renewLease 
} from "../../controllers/propertyController/lease.js"
import { verifyUser } from "../../controllers/verifyToken.js"

const router = express.Router()

// Create lease
router.post("/", verifyUser, createLease)

// Get all leases
router.get("/", verifyUser, getLeases)

// Get expiring leases
router.get("/find/expiring", verifyUser, getExpiringLeases)

// Get single lease
router.get("/:id", verifyUser, getLease)

// Update lease
router.put("/:id", verifyUser, updateLease)

// Delete lease
router.delete("/:id", verifyUser, deleteLease)

// Sign lease
router.put("/sign/:id", verifyUser, signLease)

// Renew lease
router.put("/renew/:id", verifyUser, renewLease)

export default router