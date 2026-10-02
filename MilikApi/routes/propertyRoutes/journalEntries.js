import express from "express";
import { requireCompanyModule, requireCompanyPermission, verifyUser, GL_ACCESS_MODULES } from "../../controllers/verifyToken.js";
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

const can = (action) => requireCompanyPermission("journals", action, "accounts");
const canCreate = can("create");
const canUpdate = can("update");
const canProcess = can("process");
const canApprove = can("approve");
const canReverse = can("reverse");
const canDelete = can("delete");

// Read access — any company with a GL-posting module (kept module-level: every
// GL_ACCESS_MODULES company can read journals, it's only writes that are
// scoped to the dedicated "accounts" resource permissions below)
router.get("/", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getJournalEntries);
router.get("/:id", verifyUser, requireCompanyModule(GL_ACCESS_MODULES), getJournalEntry);

// Write access
router.post("/", verifyUser, canCreate, createJournalEntry);
router.put("/:id", verifyUser, canUpdate, updateJournalEntry);
router.post("/:id/post", verifyUser, canProcess, postJournalEntryAction);
router.post("/:id/reverse", verifyUser, canReverse, reverseJournalEntryAction);
router.delete("/:id", verifyUser, canDelete, deleteJournalEntry);

// Approval workflow — submitting a draft is an edit; review/approve/reject all
// need the same "approve" authority since each is a decision over someone else's submission
router.post("/:id/submit", verifyUser, canUpdate, submitJournalForReview);
router.post("/:id/review", verifyUser, canApprove, reviewJournalEntry);
router.post("/:id/approve", verifyUser, canApprove, approveJournalEntry);
router.post("/:id/reject", verifyUser, canApprove, rejectJournalEntry);

export default router;
