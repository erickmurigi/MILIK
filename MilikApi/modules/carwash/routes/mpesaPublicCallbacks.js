import express from "express";
import { confirmCarWashCallback, validateCarWashCallback, handleTransactionStatusResult, handleStkCallback } from "../controllers/mpesaCallbackController.js";

const router = express.Router();

// No auth — Safaricom calls these directly.
// Mounted at /api/carwash/pay to avoid Safaricom's banned keyword "mpesa" in URLs.
router.post("/validation/:shortCode", validateCarWashCallback);
router.post("/confirmation/:shortCode", confirmCarWashCallback);
router.post("/txn-result", handleTransactionStatusResult);
router.post("/stk-callback/:businessId", handleStkCallback);

export default router;
