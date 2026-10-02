import express from "express";
import { requireCompanyPermission, verifyUser } from "../../controllers/verifyToken.js";
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

const can = (action) => requireCompanyPermission("landlordReceipts", action, "accounts");

router.post("/", verifyUser, can("create"), createLandlordReceipt);
router.get("/", verifyUser, can("view"), getLandlordReceipts);
router.put("/post/:id", verifyUser, can("process"), postLandlordReceipt);
router.put("/reverse/:id", verifyUser, can("reverse"), reverseLandlordReceipt);
router.get("/:id", verifyUser, can("view"), getLandlordReceipt);
router.put("/:id", verifyUser, can("update"), updateLandlordReceipt);
router.delete("/:id", verifyUser, can("delete"), deleteLandlordReceipt);

export default router;
