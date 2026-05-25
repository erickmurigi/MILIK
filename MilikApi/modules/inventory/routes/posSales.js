import express from "express";
import { verifyUser, requireCompanyModule } from "../../../controllers/verifyToken.js";
import {
  listSales, getSale, createSale, voidSale, salesSummary,
} from "../controllers/posSalesController.js";

const router = express.Router();
router.use(verifyUser, requireCompanyModule("inventory"));

router.get("/",           listSales);
router.get("/summary",    salesSummary);
router.get("/:id",        getSale);
router.post("/",          createSale);
router.post("/:id/void",  voidSale);

export default router;
