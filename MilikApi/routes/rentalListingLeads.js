import express from "express";
import { listRentalLeads, updateRentalLead, deleteRentalLead } from "../controllers/rentalListingLeadsController.js";
import { verifyUser } from "../controllers/verifyToken.js";

const router = express.Router();

router.get("/", verifyUser, listRentalLeads);
router.patch("/:id", verifyUser, updateRentalLead);
router.delete("/:id", verifyUser, deleteRentalLead);

export default router;
