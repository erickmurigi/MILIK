import mongoose from "mongoose";

const AccountingPeriodSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    startDate: {
      type: Date,
      required: true,
    },

    endDate: {
      type: Date,
      required: true,
    },

    // open → closed → locked (one-way progression)
    // open:   entries allowed
    // closed: no new entries; can reopen
    // locked: permanent — year-end close applied; cannot reopen
    status: {
      type: String,
      enum: ["open", "closed", "locked"],
      default: "open",
    },

    closedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    closedAt: {
      type: Date,
      default: null,
    },

    lockedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    lockedAt: {
      type: Date,
      default: null,
    },

    reopenedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    reopenedAt: {
      type: Date,
      default: null,
    },

    notes: {
      type: String,
      trim: true,
      default: "",
      maxlength: 500,
    },

    // set when its fiscal year was closed: the year's periods were locked together. No closing journal
    // is posted — retained earnings are worked out from the fiscal year on the Balance Sheet.
    yearEndClosed: {
      type: Boolean,
      default: false,
    },

    // legacy: the old year-end close referenced a journal here; nothing sets it any more
    yearEndJournalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JournalEntry",
      default: null,
    },

    // Closed (not locked) only: for a short time one user may post into the period without reopening
    // it. userKey is the user's id ("milik-admin" for the built-in admin).
    postingWindows: [
      {
        userKey: { type: String, required: true },
        userName: { type: String, default: "" },
        until: { type: Date, required: true },
        reason: { type: String, trim: true, default: "", maxlength: 500 },
        _id: false,
      },
    ],

    // every change of status, oldest first
    history: [
      {
        action: { type: String, enum: ["created", "closed", "reopened", "locked", "year_closed", "edited", "posting_opened", "posting_ended"], required: true },
        by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        byName: { type: String, default: "" },
        at: { type: Date, default: Date.now },
        reason: { type: String, trim: true, default: "", maxlength: 500 },
        _id: false,
      },
    ],
  },
  { timestamps: true }
);

// Prevent overlapping periods for the same business
AccountingPeriodSchema.index({ business: 1, startDate: 1, endDate: 1 });
AccountingPeriodSchema.index({ business: 1, status: 1, startDate: 1, endDate: 1 });

export default mongoose.model("AccountingPeriod", AccountingPeriodSchema);
