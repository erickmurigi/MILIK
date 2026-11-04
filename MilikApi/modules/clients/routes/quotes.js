import express from "express";
import { verifyUser, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { validateParamId } from "../middleware/validateObjectId.js";
import {
  listQuotes,
  getQuote,
  createQuote,
  updateQuote,
  sendQuote,
  acceptQuote,
  declineQuote,
  convertQuoteToContract,
  convertQuoteToInvoice,
  getQuotePdf,
} from "../controllers/quotesController.js";

const router = express.Router();
router.use(verifyUser);

const can = (action) => requireCompanyPermission("clientQuotes", action, "clients");

router.get("/",                                listQuotes);
router.post("/",                               can("create"), createQuote);
router.get("/:id",              validateParamId(), getQuote);
router.put("/:id",              validateParamId(), can("update"), updateQuote);
router.get("/:id/pdf",          validateParamId(), getQuotePdf);
router.post("/:id/send",        validateParamId(), can("update"), sendQuote);
router.post("/:id/accept",      validateParamId(), can("update"), acceptQuote);
router.post("/:id/decline",     validateParamId(), can("update"), declineQuote);
router.post("/:id/convert-to-contract", validateParamId(), can("create"), convertQuoteToContract);
router.post("/:id/convert-to-invoice",  validateParamId(), can("create"), convertQuoteToInvoice);

export default router;
