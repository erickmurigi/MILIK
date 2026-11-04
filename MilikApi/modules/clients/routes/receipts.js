import express from "express";
import { verifyUser } from "../../../controllers/verifyToken.js";
import { validateParamId } from "../middleware/validateObjectId.js";
import {
  listReceipts,
  getReceipt,
  emailReceipt,
  getAllocationSuggestions,
  createReceipt,
  applyCredit,
  reverseAllocation,
  reverseReceipt,
  updateChequeStatus,
  refundCredit,
  listRefunds,
  reverseRefund,
  listWhtCertificates,
  updateWhtCertificate,
  listUnmatchedMpesa,
  matchMpesaCollection,
} from "../controllers/receiptsController.js";

const router = express.Router();

router.use(verifyUser);

// Static paths first — "/:id" would otherwise swallow them.
router.get("/allocation-suggestions",                 getAllocationSuggestions);
router.post("/apply-credit",                          applyCredit);
router.get("/refunds",                                listRefunds);
router.post("/refunds/:refundId/reverse",             validateParamId("refundId"), reverseRefund);
router.get("/wht-certificates",                       listWhtCertificates);
router.patch("/wht-certificates/:certId",             validateParamId("certId"), updateWhtCertificate);
router.get("/mpesa/unmatched",                        listUnmatchedMpesa);
router.post("/mpesa/:collectionId/match",             validateParamId("collectionId"), matchMpesaCollection);

router.get("/",                                       listReceipts);
router.post("/",                                      createReceipt);
router.get("/:id",                                    validateParamId(), getReceipt);
router.post("/:id/apply",                             validateParamId(), applyCredit);
router.post("/:id/allocations/:allocationId/reverse", validateParamId(), validateParamId("allocationId"), reverseAllocation);
router.post("/:id/refund",                            validateParamId(), refundCredit);
router.post("/:id/cheque-status",                     validateParamId(), updateChequeStatus);
router.post("/:id/send-email",                        validateParamId(), emailReceipt);
router.post("/:id/reverse",                           validateParamId(), reverseReceipt);

export default router;
