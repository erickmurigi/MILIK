import express from "express";
import { verifyUser, requireCompanyModule } from "../../../controllers/verifyToken.js";
import {
  listTransfers, getTransfer, createTransfer, updateTransfer,
  dispatchTransfer, receiveTransfer, cancelTransfer,
} from "../controllers/stockTransfersController.js";

const router = express.Router();
router.use(verifyUser, requireCompanyModule("inventory"));

router.get("/",                       listTransfers);
router.get("/:id",                    getTransfer);
router.post("/",                      createTransfer);
router.put("/:id",                    updateTransfer);
router.post("/:id/dispatch",          dispatchTransfer);
router.post("/:id/receive",           receiveTransfer);
router.post("/:id/cancel",            cancelTransfer);

export default router;
