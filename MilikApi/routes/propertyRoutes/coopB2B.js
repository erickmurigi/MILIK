import express from "express";
import { handleCoopValidation, handleCoopAdvise } from "../../controllers/propertyController/coopB2BCollections.js";
import { coopBankIPWhitelist } from "../../utils/ipWhiteList.js";

const router = express.Router();

// Co-op Bank calls these endpoints — IP-whitelisted (configure COOP_BANK_IPS in production)
router.post("/:institutionCode/account", coopBankIPWhitelist, handleCoopValidation);
router.post("/:institutionCode/advise",  coopBankIPWhitelist, handleCoopAdvise);

export default router;
