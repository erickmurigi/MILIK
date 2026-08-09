import express from "express";
import { verifyUser, requireCompanyModule } from "../../../controllers/verifyToken.js";
import { listPaymentMethods, createPaymentMethod, updatePaymentMethod, deletePaymentMethod } from "../controllers/paymentMethodsController.js";

const router = express.Router();
router.use(verifyUser, requireCompanyModule("inventory"));

router.get("/",       listPaymentMethods);
router.post("/",      createPaymentMethod);
router.put("/:id",    updatePaymentMethod);
router.delete("/:id", deletePaymentMethod);

export default router;
