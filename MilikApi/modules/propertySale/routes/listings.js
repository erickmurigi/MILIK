import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { createListing, deleteListing, getListing, listListings, updateListing, updateListingStatus } from "../controllers/listingsController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"));
router.get("/", requireCompanyPermission("sale-listings", "view", "propertySale"), listListings);
router.get("/:id", requireCompanyPermission("sale-listings", "view", "propertySale"), getListing);
router.post("/", requireCompanyPermission("sale-listings", "create", "propertySale"), createListing);
router.put("/:id", requireCompanyPermission("sale-listings", "update", "propertySale"), updateListing);
router.patch("/:id/status", requireCompanyPermission("sale-listings", "update", "propertySale"), updateListingStatus);
router.delete("/:id", requireCompanyPermission("sale-listings", "update", "propertySale"), deleteListing);

export default router;
