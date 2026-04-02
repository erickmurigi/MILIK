import express from "express";
import {
  createPaymentVoucher,
  getPaymentVoucher,
  getPaymentVouchers,
  updatePaymentVoucher,
  updatePaymentVoucherStatus,
  deletePaymentVoucher,
} from "../../controllers/propertyController/paymentVoucher.js";
import { verifyUser } from "../../controllers/verifyToken.js";

const router = express.Router();

router.post("/", verifyUser, createPaymentVoucher);
router.get("/", verifyUser, getPaymentVouchers);
router.get("/:id", verifyUser, getPaymentVoucher);
router.put("/:id", verifyUser, updatePaymentVoucher);
router.put("/:id/status", verifyUser, updatePaymentVoucherStatus);
router.delete("/:id", verifyUser, deletePaymentVoucher);

export default router;
