import express from "express";
import { verifyUser } from "../../../controllers/verifyToken.js";
import { validateParamId } from "../middleware/validateObjectId.js";
import {
  listInvoices,
  getInvoice,
  createInvoice,
  updateInvoice,
  recordPayment,
  listPayments,
  reversePayment,
  sendInvoice,
  cancelInvoice,
} from "../controllers/invoicesController.js";

const router = express.Router();

router.use(verifyUser);

router.get("/",                              listInvoices);
router.post("/",                             createInvoice);
router.get("/:id",    validateParamId(),     getInvoice);
router.put("/:id",    validateParamId(),     updateInvoice);
router.get("/:id/payments",                  validateParamId(), listPayments);
router.post("/:id/payments",                 validateParamId(), recordPayment);
router.post("/:id/payments/:paymentId/reverse", validateParamId(), validateParamId("paymentId"), reversePayment);
router.post("/:id/send",       validateParamId(), sendInvoice);
router.delete("/:id",          validateParamId(), cancelInvoice);

export default router;
