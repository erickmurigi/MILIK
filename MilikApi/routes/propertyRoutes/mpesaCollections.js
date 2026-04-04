import express from "express";
import { verifyUser } from "../../controllers/verifyToken.js";
import {
  importMpesaBatch,
  listMpesaCollections,
  mpesaConfirmationCallback,
  mpesaValidationCallback,
} from "../../controllers/propertyController/mpesaCollections.js";

const router = express.Router();

router.get("/", verifyUser, listMpesaCollections);
router.post("/import-batch", verifyUser, importMpesaBatch);
router.post("/validation/:shortCode", mpesaValidationCallback);
router.post("/confirmation/:shortCode", mpesaConfirmationCallback);

export default router;
