import express from "express";
import { verifyUser, requireCompanyPermission } from "../../../controllers/verifyToken.js";
import { validateParamId } from "../middleware/validateObjectId.js";
import { listNotes, getNote, reverseNote, getNotePdf, raiseLateInterest } from "../controllers/creditNotesController.js";

// Credit/debit notes are created from the invoice (POST /api/clients/invoices/:id/credit-notes |
// /debit-notes); this router lists, reads, prints and reverses them.
const router = express.Router();
router.use(verifyUser);

router.get("/",                              listNotes);
router.post("/late-interest", requireCompanyPermission("clientCreditNotes", "create", "clients"), raiseLateInterest);
router.get("/:id",         validateParamId(), getNote);
router.get("/:id/pdf",     validateParamId(), getNotePdf);
router.post("/:id/reverse", validateParamId(), requireCompanyPermission("clientCreditNotes", "reverse", "clients"), reverseNote);

export default router;
