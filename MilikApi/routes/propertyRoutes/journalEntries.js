import express from "express";
import { requireCompanyModule, verifyUser } from "../../controllers/verifyToken.js";
import {
  createJournalEntry,
  getJournalEntries,
  getJournalEntry,
  updateJournalEntry,
  postJournalEntryAction,
  reverseJournalEntryAction,
  deleteJournalEntry,
} from "../../controllers/propertyController/journalEntries.js";

const router = express.Router();

router.post("/", verifyUser, requireCompanyModule("accounts"), createJournalEntry);
router.get("/", verifyUser, requireCompanyModule("accounts"), getJournalEntries);
router.get("/:id", verifyUser, requireCompanyModule("accounts"), getJournalEntry);
router.put("/:id", verifyUser, requireCompanyModule("accounts"), updateJournalEntry);
router.post("/:id/post", verifyUser, requireCompanyModule("accounts"), postJournalEntryAction);
router.post("/:id/reverse", verifyUser, requireCompanyModule("accounts"), reverseJournalEntryAction);
router.delete("/:id", verifyUser, requireCompanyModule("accounts"), deleteJournalEntry);

export default router;