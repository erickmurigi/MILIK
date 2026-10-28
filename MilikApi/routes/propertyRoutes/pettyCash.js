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
  getPettyCashLedger,
} from "../../controllers/propertyController/pettyCash.js";
import { requireCompanyPermission, verifyUser } from "../../controllers/verifyToken.js";

const router = express.Router();

// accessMatrix.js declares pettyCash's tiers as view/create/approve/reverse — every route below
// previously only required verifyUser (logged in), with no permission check at all, so any
// authenticated user of the company could create, void, or approve/post/reject real money
// movements via the API regardless of what the UI showed them. The frontend already gates these
// same actions with hasCompanyPermission; this just enforces it server-side too.
const can = (action) => requireCompanyPermission("pettyCash", action, "accounts");

// Accounts
router.post("/accounts", verifyUser, can("create"), createPettyCashAccount);
router.get("/accounts", verifyUser, can("view"), getPettyCashAccounts);
router.get("/accounts/:id", verifyUser, can("view"), getPettyCashAccount);
router.put("/accounts/:id", verifyUser, can("create"), updatePettyCashAccount);
router.get("/accounts/:id/ledger", verifyUser, can("view"), getPettyCashLedger);

// Disbursements
router.post("/disbursements", verifyUser, can("create"), createDisbursement);
router.get("/disbursements", verifyUser, can("view"), getDisbursements);
router.put("/disbursements/:id/void", verifyUser, can("reverse"), voidDisbursement);

// Replenishments
router.post("/replenishments", verifyUser, can("create"), requestReplenishment);
router.get("/replenishments", verifyUser, can("view"), getReplenishments);
router.put("/replenishments/:id/approve", verifyUser, can("approve"), approveReplenishment);
router.put("/replenishments/:id/post", verifyUser, can("approve"), postReplenishment);
router.put("/replenishments/:id/reject", verifyUser, can("approve"), rejectReplenishment);

export default router;
