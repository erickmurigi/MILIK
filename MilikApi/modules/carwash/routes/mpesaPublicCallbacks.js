import express from "express";
import { confirmCarWashCallback, validateCarWashCallback } from "../controllers/mpesaCallbackController.js";

const router = express.Router();

// No auth — Safaricom calls these directly.
// Mounted at /api/carwash/pay to avoid Safaricom's banned keyword "mpesa" in URLs.
router.post("/validation/:shortCode", validateCarWashCallback);
router.post("/confirmation/:shortCode", confirmCarWashCallback);

export default router;
