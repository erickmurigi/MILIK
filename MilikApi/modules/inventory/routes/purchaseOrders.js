import express from "express";
import { verifyUser, requireCompanyModule } from "../../../controllers/verifyToken.js";
import {
  listPurchaseOrders, getPurchaseOrder, createPurchaseOrder, updatePurchaseOrder,
  receiveGoods, cancelPurchaseOrder,
} from "../controllers/purchaseOrdersController.js";

const router = express.Router();
router.use(verifyUser, requireCompanyModule("inventory"));

router.get("/",                    listPurchaseOrders);
router.get("/:id",                 getPurchaseOrder);
router.post("/",                   createPurchaseOrder);
router.put("/:id",                 updatePurchaseOrder);
router.post("/:id/receive-goods",  receiveGoods);
router.post("/:id/cancel",         cancelPurchaseOrder);

export default router;
