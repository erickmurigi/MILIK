import express from "express";
import { verifyUser } from "../../controllers/verifyToken.js";
import {
  assignTenantToCollection,
  deleteMpesaCollection,
  ignoreCollection,
  importMpesaBatch,
  listMpesaCollections,
  unignoreCollection,
} from "../../controllers/propertyController/mpesaCollections.js";

const router = express.Router();

router.get("/", verifyUser, listMpesaCollections);
router.post("/import-batch", verifyUser, importMpesaBatch);
router.post("/:id/assign-tenant", verifyUser, assignTenantToCollection);
router.post("/:id/ignore",    verifyUser, ignoreCollection);
router.post("/:id/unignore",  verifyUser, unignoreCollection);
router.delete("/:id", verifyUser, deleteMpesaCollection);

export default router;
