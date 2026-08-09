import express from "express";
import { verifyUser, requireCompanyModule } from "../../../controllers/verifyToken.js";
import {
  listProducts, getProduct, createProduct, updateProduct, deleteProduct,
  lookupProduct, bulkImportProducts,
} from "../controllers/productsController.js";

const router = express.Router();
router.use(verifyUser, requireCompanyModule("inventory"));

router.get("/lookup",      lookupProduct);       // before /:id
router.post("/bulk-import", bulkImportProducts); // before /:id
router.get("/",            listProducts);
router.get("/:id",         getProduct);
router.post("/",           createProduct);
router.put("/:id",         updateProduct);
router.delete("/:id",      deleteProduct);

export default router;
