import express from "express";
import { verifyUser, requireCompanyModule } from "../../../controllers/verifyToken.js";
import InvSupplier from "../models/InvSupplier.js";
import { resolveActiveBusinessId } from "../services/inventoryScope.js";
import { resolveSupplierApAccount } from "../services/inventoryAccountingService.js";
import {
  listSuppliers, getSupplier, createSupplier, updateSupplier, deleteSupplier,
} from "../controllers/suppliersController.js";

const router = express.Router();
router.use(verifyUser, requireCompanyModule("inventory"));

// Backfill AP sub-accounts for existing suppliers that have none yet
router.post("/backfill-ap-accounts", async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const suppliers = await InvSupplier.find({ business, apAccountId: { $in: [null, undefined] } }).lean();
    let created = 0;
    for (const s of suppliers) {
      await resolveSupplierApAccount(String(business), String(s._id)).catch(() => {});
      created++;
    }
    res.json({ success: true, message: `AP accounts ensured for ${created} supplier(s)` });
  } catch (err) {
    next(err);
  }
});

router.get("/",       listSuppliers);
router.get("/:id",    getSupplier);
router.post("/",      createSupplier);
router.put("/:id",    updateSupplier);
router.delete("/:id", deleteSupplier);

export default router;
