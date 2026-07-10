import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import {
  createListing, deleteListing, getListing, listListings,
  removeListingImage, updateListing, updateListingStatus, uploadListingImages,
} from "../controllers/listingsController.js";
import { listingImageUpload } from "../middleware/listingImageUpload.js";
import { createError } from "../../../utils/error.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"));
router.get("/",    requireCompanyPermission("sale-listings", "view",   "propertySale"), listListings);
router.get("/:id", requireCompanyPermission("sale-listings", "view",   "propertySale"), getListing);
router.post("/",   requireCompanyPermission("sale-listings", "create", "propertySale"), createListing);
router.put("/:id", requireCompanyPermission("sale-listings", "update", "propertySale"), updateListing);
router.patch("/:id/status", requireCompanyPermission("sale-listings", "update", "propertySale"), updateListingStatus);
router.delete("/:id",       requireCompanyPermission("sale-listings", "update", "propertySale"), deleteListing);

router.post(
  "/:id/images",
  requireCompanyPermission("sale-listings", "update", "propertySale"),
  (req, res, next) => listingImageUpload(req, res, (err) => err ? next(createError(400, err.message || "Upload failed")) : next()),
  uploadListingImages
);
router.delete("/:id/images", requireCompanyPermission("sale-listings", "update", "propertySale"), removeListingImage);

export default router;
