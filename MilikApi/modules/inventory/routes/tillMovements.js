import express from "express";
import { verifyUser, requireCompanyModule } from "../../../controllers/verifyToken.js";
import { listMovements, cashIn, cashOut, getXRead } from "../controllers/tillMovementsController.js";

const router = express.Router();
router.use(verifyUser, requireCompanyModule("inventory"));

router.get("/",                      listMovements);
router.post("/sessions/:id/cash-in", cashIn);
router.post("/sessions/:id/cash-out",cashOut);
router.get("/sessions/:id/x-read",   getXRead);

export default router;
