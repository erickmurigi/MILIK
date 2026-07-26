import express from "express";
import { verifyUser } from "../../../controllers/verifyToken.js";
import { validateParamId } from "../middleware/validateObjectId.js";
import {
  listInvoices,
  getInvoice,
  createInvoice,
  updateInvoice,
  markPaid,
  sendInvoice,
  cancelInvoice,
} from "../controllers/invoicesController.js";

const router = express.Router();

router.use(verifyUser);

router.get("/",                              listInvoices);
router.post("/",                             createInvoice);
router.get("/:id",    validateParamId(),     getInvoice);
router.put("/:id",    validateParamId(),     updateInvoice);
router.patch("/:id/mark-paid", validateParamId(), markPaid);
router.post("/:id/send",       validateParamId(), sendInvoice);
router.delete("/:id",          validateParamId(), cancelInvoice);

export default router;
