import express from "express";
import { verifyUser } from "../../controllers/verifyToken.js";
import {
  createLandlordReceipt,
  deleteLandlordReceipt,
  getLandlordReceipt,
  getLandlordReceipts,
  postLandlordReceipt,
  reverseLandlordReceipt,
  updateLandlordReceipt,
} from "../../controllers/propertyController/landlordReceipts.js";

const router = express.Router();

router.post("/", verifyUser, createLandlordReceipt);
router.get("/", verifyUser, getLandlordReceipts);
router.put("/post/:id", verifyUser, postLandlordReceipt);
router.put("/reverse/:id", verifyUser, reverseLandlordReceipt);
router.get("/:id", verifyUser, getLandlordReceipt);
router.put("/:id", verifyUser, updateLandlordReceipt);
router.delete("/:id", verifyUser, deleteLandlordReceipt);

export default router;
