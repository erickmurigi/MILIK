import express from "express";
import {
  mpesaConfirmationCallback,
  mpesaValidationCallback,
} from "../../controllers/propertyController/mpesaCollections.js";
import { safaricomIPWhitelist } from "../../utils/ipWhiteList.js";

const router = express.Router();

// Mounted at /api/pms/pay — no auth middleware, Safaricom calls these directly.
// URL must NOT contain "mpesa" (Safaricom blocks it at registration time).
router.post("/validation/:shortCode", safaricomIPWhitelist, mpesaValidationCallback);
router.post("/confirmation/:shortCode", safaricomIPWhitelist, mpesaConfirmationCallback);

export default router;
