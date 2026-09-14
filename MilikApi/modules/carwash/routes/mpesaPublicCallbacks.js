import express from "express";
import { confirmCarWashCallback, validateCarWashCallback, handleTransactionStatusResult, handleStkCallback } from "../controllers/mpesaCallbackController.js";
import { safaricomIPWhitelist } from "../../../utils/ipWhiteList.js";

const router = express.Router();

// No auth — Safaricom calls these directly.
// Mounted at /api/carwash/pay to avoid Safaricom's banned keyword "mpesa" in URLs.
// IP-whitelisted the same way routes/propertyRoutes/pmsPublicCallbacks.js already is —
// these were previously wide open to anyone who discovered the URL.
router.post("/validation/:shortCode", safaricomIPWhitelist, validateCarWashCallback);
router.post("/confirmation/:shortCode", safaricomIPWhitelist, confirmCarWashCallback);
router.post("/txn-result", safaricomIPWhitelist, handleTransactionStatusResult);
router.post("/stk-callback/:businessId", safaricomIPWhitelist, handleStkCallback);

export default router;
