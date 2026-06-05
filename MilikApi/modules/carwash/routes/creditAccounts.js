import express from "express";
import { requireCompanyModule, verifyUser } from "../../../controllers/verifyToken.js";
import { ensureSystemChartOfAccounts } from "../../../services/chartOfAccountsService.js";
import { resolveActiveBusinessId } from "../services/businessScope.js";
import {
  createAccount,
  generateStatement,
  getAccount,
  getStatement,
  listAccounts,
  listStatements,
  listAccountTopups,
  lookupAccountByPlate,
  processDueBilling,
  recordAccountPayment,
  recordAccountTopup,
  sendStatementSms,
  updateAccount,
} from "../controllers/creditAccountsController.js";

const router = express.Router();
router.use(verifyUser, requireCompanyModule("carwash"));

router.get("/",                                   listAccounts);
router.post("/",                                  createAccount);
router.get("/lookup/plate/:plate",                lookupAccountByPlate);
router.get("/:id",                                getAccount);
router.put("/:id",                                updateAccount);
router.post("/:id/pay",                           recordAccountPayment);
router.post("/:id/topup",                         recordAccountTopup);
router.get("/:id/topups",                         listAccountTopups);
router.post("/:id/statements",                    generateStatement);
router.get("/:id/statements",                     listStatements);
router.get("/:id/statements/:statementId",        getStatement);
router.post("/:id/statements/:statementId/sms",   sendStatementSms);

// Force-seed all car wash system chart of accounts for this business
router.post("/setup/seed-accounts", async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    await ensureSystemChartOfAccounts(business, { force: true });
    res.json({ success: true, message: "Car Wash system accounts initialised" });
  } catch (err) { next(err); }
});

// Admin/cron route — trigger auto-billing check for all due monthly accounts
router.post("/admin/process-billing", async (req, res, next) => {
  try {
    const results = await processDueBilling(null);
    res.json({ success: true, processed: results.length, data: results });
  } catch (err) { next(err); }
});

export default router;
