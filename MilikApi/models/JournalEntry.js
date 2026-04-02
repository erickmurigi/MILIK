import mongoose from "mongoose";

const JournalEntrySchema = new mongoose.Schema(
  {
    journalNo: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    date: {
      type: Date,
      required: true,
    },

    journalType: {
      type: String,
      enum: [
        "landlord_credit_adjustment",
        "landlord_debit_adjustment",
        "property_expense_accrual",
        "general_manual_journal",
      ],
      required: true,
      default: "general_manual_journal",
    },

    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Property",
      required: true,
      index: true,
    },

    landlord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Landlord",
      default: null,
      index: true,
    },

    debitAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      required: true,
      index: true,
    },

    creditAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      required: true,
      index: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    reference: {
      type: String,
      trim: true,
      default: "",
    },

    narration: {
      type: String,
      trim: true,
      default: "",
      maxlength: 1000,
    },

    includeInLandlordStatement: {
      type: Boolean,
      default: false,
    },

    status: {
      type: String,
      enum: ["draft", "posted", "reversed"],
      default: "draft",
      index: true,
    },

    ledgerEntries: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "FinancialLedgerEntry",
      },
    ],

    journalGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },

    postedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    postedAt: {
      type: Date,
      default: null,
    },

    reversedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    reversedAt: {
      type: Date,
      default: null,
    },

    reversalReason: {
      type: String,
      trim: true,
      default: "",
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

JournalEntrySchema.index({ business: 1, journalNo: 1 }, { unique: true });
JournalEntrySchema.index({ business: 1, date: -1 });
JournalEntrySchema.index({ business: 1, journalType: 1, date: -1 });
JournalEntrySchema.index({ business: 1, property: 1, date: -1 });
JournalEntrySchema.index({ business: 1, landlord: 1, date: -1 });

export default mongoose.model("JournalEntry", JournalEntrySchema);