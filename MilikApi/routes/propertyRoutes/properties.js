// routes/property.js
import express from "express"
import { validateRequest } from "../../utils/validateRequest.js"
import { createPropertySchema, updatePropertySchema } from "../../utils/validationSchemas.js"
import {
  createProperty,
  getProperty,
  getProperties,
  updateProperty,
  deleteProperty,
  getPropertyUnits,
  getPropertyTenants,
  bulkImportProperties,
  backfillPropertyAccounts,
  uploadPropertyImages,
  deletePropertyImage,
} from "../../controllers/propertyController/property.js"
import { verifyUser } from "../../controllers/verifyToken.js"
import { imagesUpload } from "../../utils/cloudinaryUpload.js"

const router = express.Router()

// Create property
router.post("/", verifyUser, validateRequest(createPropertySchema), createProperty)

// Bulk import properties
router.post("/bulk-import", verifyUser, bulkImportProperties)

// Backfill GL sub-accounts for all existing In-GL properties (idempotent migration)
router.post("/backfill-accounts", verifyUser, backfillPropertyAccounts)

// Get all properties
router.get("/", verifyUser, getProperties)

// Get single property
router.get("/:id", verifyUser, getProperty)

// Update property
router.put("/:id", verifyUser, validateRequest(updatePropertySchema), updateProperty)

// Delete property
router.delete("/:id", verifyUser, deleteProperty)

// Get property units
router.get("/units/:id", verifyUser, getPropertyUnits)

// Get property tenants
router.get("/tenants/:id", verifyUser, getPropertyTenants)

// Listing photos
router.post("/:id/images", verifyUser, imagesUpload.array("images", 15), uploadPropertyImages)
router.delete("/:id/images", verifyUser, deletePropertyImage)

export default router