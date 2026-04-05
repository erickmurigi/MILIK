import express from "express";
import { verifyUser } from "../../controllers/verifyToken.js";
import {
  deleteMpesaCollection,
  importMpesaBatch,
  listMpesaCollections,
  mpesaConfirmationCallback,
  mpesaValidationCallback,
} from "../../controllers/propertyController/mpesaCollections.js";

const router = express.Router();

router.get("/", verifyUser, listMpesaCollections);
router.post("/import-batch", verifyUser, importMpesaBatch);
router.delete("/:id", verifyUser, deleteMpesaCollection);
router.post("/validation/:shortCode", mpesaValidationCallback);
router.post("/confirmation/:shortCode", mpesaConfirmationCallback);

export default router;
