import express from "express";
import {
  createPaymentVoucher,
  getPaymentVoucher,
  getPaymentVouchers,
  updatePaymentVoucher,
  updatePaymentVoucherStatus,
  deletePaymentVoucher,
  getPayeeBankPreview,
} from "../../controllers/propertyController/paymentVoucher.js";
import { downloadPaymentVoucherPdf } from "../../controllers/propertyController/paymentVoucherPdf.js";
import { requireCompanyPermission, verifyUser } from "../../controllers/verifyToken.js";

const router = express.Router();

// The same permissions the Payment Vouchers page checks in the browser, enforced here too so the API (and the mobile app)
// can't do what the person isn't allowed to do on screen.
const can = (action) => requireCompanyPermission("paymentVouchers", action, "accounts");
const canView = can("view");
const canCreate = can("create");
const canUpdate = can("update");
const canProcess = can("process");
const canReverse = can("reverse");
const canDelete = can("delete");

// approving / paying needs "process", reversing needs "reverse", moving back to draft is an edit
const canChangeStatus = (req, res, next) => {
  const status = req.body?.status;
  const check = status === "reversed" ? canReverse : status === "draft" ? canUpdate : canProcess;
  return check(req, res, next);
};

router.post("/", verifyUser, canCreate, createPaymentVoucher);
router.get("/", verifyUser, canView, getPaymentVouchers);
// Payee bank for a chosen provider or property (landlord). Read-only; same rules as saving a voucher.
router.get("/payee-bank", verifyUser, canView, getPayeeBankPreview);
router.get("/:id/pdf", verifyUser, canView, downloadPaymentVoucherPdf);
router.get("/:id", verifyUser, canView, getPaymentVoucher);
router.put("/:id", verifyUser, canUpdate, updatePaymentVoucher);
router.put("/:id/status", verifyUser, canChangeStatus, updatePaymentVoucherStatus);
router.delete("/:id", verifyUser, canDelete, deletePaymentVoucher);

export default router;
