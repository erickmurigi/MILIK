import express from "express";
import { confirmCarWashCallback, validateCarWashCallback } from "../controllers/mpesaCallbackController.js";

const router = express.Router();

// No auth middleware — Safaricom calls these directly
router.post("/validation/:shortCode", validateCarWashCallback);
router.post("/confirmation/:shortCode", confirmCarWashCallback);

export default router;
