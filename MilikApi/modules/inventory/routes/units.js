import express from "express";
import { verifyUser, requireCompanyModule } from "../../../controllers/verifyToken.js";
import { listUnits, createUnit, updateUnit, deleteUnit } from "../controllers/unitsController.js";

const router = express.Router();
router.use(verifyUser, requireCompanyModule("inventory"));

router.get("/",       listUnits);
router.post("/",      createUnit);
router.put("/:id",    updateUnit);
router.delete("/:id", deleteUnit);

export default router;
