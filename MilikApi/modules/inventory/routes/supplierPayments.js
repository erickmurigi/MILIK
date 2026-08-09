import express from "express";
import { verifyUser, requireCompanyModule } from "../../../controllers/verifyToken.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import { resolveActiveBusinessId } from "../services/inventoryScope.js";
import {
  listSupplierPayments, createSupplierPayment, voidSupplierPayment,
} from "../controllers/supplierPaymentsController.js";

const router = express.Router();
router.use(verifyUser, requireCompanyModule("inventory"));

// Posting asset accounts available as cashbook/bank accounts for supplier payments
router.get("/cashbook-accounts", async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const accounts = await ChartOfAccount.find({
      business,
      type:      "asset",
      subGroup:  { $regex: /^(cashbooks|bank accounts)$/i },
      isPosting: true,
      isHeader:  false,
      $or: [{ isActive: true }, { isActive: { $exists: false } }],
    })
      .select("_id code name type isPosting isHeader")
      .sort({ code: 1 })
      .lean();
    res.json(accounts);
  } catch (err) {
    next(err);
  }
});

router.get("/",           listSupplierPayments);
router.post("/",          createSupplierPayment);
router.post("/:id/void",  voidSupplierPayment);

export default router;
