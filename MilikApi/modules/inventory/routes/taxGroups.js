import express from "express";
import { verifyUser, requireCompanyModule } from "../../../controllers/verifyToken.js";
import { listTaxGroups, createTaxGroup, updateTaxGroup, deleteTaxGroup } from "../controllers/taxGroupsController.js";

const router = express.Router();
router.use(verifyUser, requireCompanyModule("inventory"));

router.get("/",       listTaxGroups);
router.post("/",      createTaxGroup);
router.put("/:id",    updateTaxGroup);
router.delete("/:id", deleteTaxGroup);

export default router;
