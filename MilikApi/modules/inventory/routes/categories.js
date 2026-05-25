import express from "express";
import { verifyUser, requireCompanyModule } from "../../../controllers/verifyToken.js";
import {
  listCategories, createCategory, updateCategory, deleteCategory,
} from "../controllers/categoriesController.js";

const router = express.Router();
router.use(verifyUser, requireCompanyModule("inventory"));

router.get("/",      listCategories);
router.post("/",     createCategory);
router.put("/:id",   updateCategory);
router.delete("/:id", deleteCategory);

export default router;
