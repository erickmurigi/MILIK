import express from "express";
import { verifyUser, requireCompanyModule } from "../../../controllers/verifyToken.js";
import {
  listSessions, getSession, getActiveSession, openSession, closeSession,
} from "../controllers/posSessionController.js";
import { cashIn, cashOut, getXRead } from "../controllers/tillMovementsController.js";

const router = express.Router();
router.use(verifyUser, requireCompanyModule("inventory"));

router.get("/",              listSessions);
router.get("/active",        getActiveSession);
router.get("/:id",           getSession);
router.post("/",             openSession);
router.post("/:id/close",    closeSession);
router.post("/:id/cash-in",  cashIn);
router.post("/:id/cash-out", cashOut);
router.get("/:id/x-read",    getXRead);

export default router;
