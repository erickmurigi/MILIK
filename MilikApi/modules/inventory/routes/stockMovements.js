import express from "express";
import { verifyUser, requireCompanyModule } from "../../../controllers/verifyToken.js";
import {
  listStockMovements, getProductBalance, createManualEntry, stockValuation, getLowStock,
} from "../controllers/stockMovementsController.js";

const router = express.Router();
router.use(verifyUser, requireCompanyModule("inventory"));

router.get("/low-stock",  getLowStock);
router.get("/",           listStockMovements);
router.get("/balance",    getProductBalance);
router.get("/valuation",  stockValuation);
router.post("/",          createManualEntry);

export default router;
