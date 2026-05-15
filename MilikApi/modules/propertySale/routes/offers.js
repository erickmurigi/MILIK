import express from "express";
import { verifyUser, requireCompanyModule, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { createOffer, deleteOffer, getOffer, listOffers, updateOffer, updateOfferStatus } from "../controllers/offersController.js";

const router = express.Router();

router.use(verifyUser, requireCompanyModule("propertySale"));
router.get("/", requireCompanyPermission("sale-offers", "view", "propertySale"), listOffers);
router.get("/:id", requireCompanyPermission("sale-offers", "view", "propertySale"), getOffer);
router.post("/", requireCompanyPermission("sale-offers", "create", "propertySale"), createOffer);
router.put("/:id", requireCompanyPermission("sale-offers", "update", "propertySale"), updateOffer);
router.patch("/:id/status", requireCompanyPermission("sale-offers", "update", "propertySale"), updateOfferStatus);
router.delete("/:id", requireCompanyPermission("sale-offers", "update", "propertySale"), deleteOffer);

export default router;
