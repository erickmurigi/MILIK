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
  renewLease,
  generateLeaseDocument,
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

// Sign lease (must be before /:id to avoid being intercepted)
router.put("/sign/:id", verifyUser, signLease)

// Renew lease (must be before /:id to avoid being intercepted)
router.put("/renew/:id", verifyUser, renewLease)

// Update lease
router.put("/:id", verifyUser, updateLease)

// Delete lease
router.delete("/:id", verifyUser, deleteLease)

// Generate PDF document
router.post("/:id/generate-document", verifyUser, generateLeaseDocument)

export default router