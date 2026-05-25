import express from "express";
import { verifyUser, requireCompanyModule } from "../../../controllers/verifyToken.js";
import {
  listSuppliers, getSupplier, createSupplier, updateSupplier, deleteSupplier,
} from "../controllers/suppliersController.js";

const router = express.Router();
router.use(verifyUser, requireCompanyModule("inventory"));

router.get("/",      listSuppliers);
router.get("/:id",   getSupplier);
router.post("/",     createSupplier);
router.put("/:id",   updateSupplier);
router.delete("/:id", deleteSupplier);

export default router;
