import express from "express";
import { handleCoopValidation, handleCoopAdvise } from "../../controllers/propertyController/coopB2BCollections.js";

const router = express.Router();

// Co-op Bank calls these endpoints — no auth middleware
router.post("/:institutionCode/account", handleCoopValidation);
router.post("/:institutionCode/advise",  handleCoopAdvise);

export default router;
