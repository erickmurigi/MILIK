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

    yearEndClosed: {
      type: Boolean,
      default: false,
    },

    yearEndJournalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JournalEntry",
      default: null,
    },
  },
  { timestamps: true }
);

// Prevent overlapping periods for the same business
AccountingPeriodSchema.index({ business: 1, startDate: 1, endDate: 1 });
AccountingPeriodSchema.index({ business: 1, status: 1, startDate: 1, endDate: 1 });

export default mongoose.model("AccountingPeriod", AccountingPeriodSchema);
