import express from "express";
import {
  createPettyCashAccount,
  getPettyCashAccounts,
  getPettyCashAccount,
  updatePettyCashAccount,
  createDisbursement,
  getDisbursements,
  voidDisbursement,
  requestReplenishment,
  approveReplenishment,
  postReplenishment,
  rejectReplenishment,
  getReplenishments,
} from "../../controllers/propertyController/pettyCash.js";
import { verifyUser } from "../../controllers/verifyToken.js";

const router = express.Router();

// Accounts
router.post("/accounts", verifyUser, createPettyCashAccount);
router.get("/accounts", verifyUser, getPettyCashAccounts);
router.get("/accounts/:id", verifyUser, getPettyCashAccount);
router.put("/accounts/:id", verifyUser, updatePettyCashAccount);

// Disbursements
router.post("/disbursements", verifyUser, createDisbursement);
router.get("/disbursements", verifyUser, getDisbursements);
router.put("/disbursements/:id/void", verifyUser, voidDisbursement);

// Replenishments
router.post("/replenishments", verifyUser, requestReplenishment);
router.get("/replenishments", verifyUser, getReplenishments);
router.put("/replenishments/:id/approve", verifyUser, approveReplenishment);
router.put("/replenishments/:id/post", verifyUser, postReplenishment);
router.put("/replenishments/:id/reject", verifyUser, rejectReplenishment);

export default router;
