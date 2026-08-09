import express from "express";
import { verifyUser, requireCompanyModule } from "../../../controllers/verifyToken.js";
import {
  listPurchaseOrders, getPurchaseOrder, createPurchaseOrder, updatePurchaseOrder,
  receiveGoods, cancelPurchaseOrder, cancelReceipt, cancelAllReceiving,
} from "../controllers/purchaseOrdersController.js";

const router = express.Router();
router.use(verifyUser, requireCompanyModule("inventory"));

router.get("/",                                        listPurchaseOrders);
router.get("/:id",                                     getPurchaseOrder);
router.post("/",                                       createPurchaseOrder);
router.put("/:id",                                     updatePurchaseOrder);
router.post("/:id/receive-goods",                      receiveGoods);
router.post("/:id/cancel",                             cancelPurchaseOrder);
router.post("/:id/receipts/:receiptId/cancel",         cancelReceipt);
router.post("/:id/cancel-all-receiving",               cancelAllReceiving);

export default router;
