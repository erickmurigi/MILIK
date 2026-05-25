import express from "express";
import { verifyUser, requireCompanyModule } from "../../../controllers/verifyToken.js";
import {
  listTills, getTill, createTill, updateTill, deleteTill,
} from "../controllers/tillsController.js";

const router = express.Router();
router.use(verifyUser, requireCompanyModule("inventory"));

router.get("/",        listTills);
router.get("/:id",     getTill);
router.post("/",       createTill);
router.put("/:id",     updateTill);
router.delete("/:id",  deleteTill);

export default router;
