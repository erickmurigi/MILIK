import express from "express";
import { requireCompanyModule, verifyUser, GL_ACCESS_MODULES } from "../../controllers/verifyToken.js";
import {
  createJournalEntry,
  getJournalEntries,
  getJournalEntry,
  updateJournalEntry,
  postJournalEntryAction,
  reverseJournalEntryAction,
  deleteJournalEntry,
  submitJournalForReview,
  reviewJournalEntry,
  approveJournalEntry,
  rejectJournalEntry,
} from "../../controllers/propertyController/journalEntries.js";

const router = express.Router();

// Read access — any company with a GL-posting module
router.get("/", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getJournalEntries);
router.get("/:id", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getJournalEntry);

// Write access — requires the dedicated accounts module
router.post("/", verifyUser, requireCompanyModule("accounts"), createJournalEntry);
router.put("/:id", verifyUser, requireCompanyModule("accounts"), updateJournalEntry);
router.post("/:id/post", verifyUser, requireCompanyModule("accounts"), postJournalEntryAction);
router.post("/:id/reverse", verifyUser, requireCompanyModule("accounts"), reverseJournalEntryAction);
router.delete("/:id", verifyUser, requireCompanyModule("accounts"), deleteJournalEntry);

// Approval workflow
router.post("/:id/submit", verifyUser, requireCompanyModule("accounts"), submitJournalForReview);
router.post("/:id/review", verifyUser, requireCompanyModule("accounts"), reviewJournalEntry);
router.post("/:id/approve", verifyUser, requireCompanyModule("accounts"), approveJournalEntry);
router.post("/:id/reject", verifyUser, requireCompanyModule("accounts"), rejectJournalEntry);

export default router;
