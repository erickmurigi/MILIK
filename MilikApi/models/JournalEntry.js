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
        "internal_account_transfer",
        "general_manual_journal",
        "company_journal",
        "payroll_posting",
        "statutory_payment",
        // multi-line journals
        "adjustment",
        "accrual",
        "reclassification",
        "opening_balance",
        "allocation",
      ],
      required: true,
      default: "general_manual_journal",
    },

    sourceModule: {
      type: String,
      enum: ["propertyManagement", "hr", "carwash", "general", "accounts", "propertySale", "inventory", "clients"],
      default: "general",
      index: true,
    },

    sourceDocumentType: {
      type: String,
      enum: { values: ["Invoice", "Receipt", "Payslip", "Expense", "Manual"], message: "Invalid source document type" },
      default: null,
    },

    sourceDocumentId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },

    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Property",
      default: null,
      index: true,
    },

    landlord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Landlord",
      default: null,
      index: true,
    },

    // Two-line journals (landlord / property journals and everything posted before multi-line journals) use these three
    // fields. A multi-line journal leaves the two accounts empty and fills `lines`; `amount` is then its total debit.
    debitAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      required: function () { return !(this.lines && this.lines.length); },
      index: true,
    },

    creditAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      required: function () { return !(this.lines && this.lines.length); },
      index: true,
    },

    // Accrual-style journals: on posting, a mirror journal (debits and credits swapped) is posted dated autoReverseDate.
    autoReverseDate: { type: Date, default: null },
    autoReversalJournal: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry", default: null },
    autoReversalOf: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry", default: null },

    // Multi-line journal: debits and credits that must balance. Each line may be tagged (module, sale project, deal,
    // listing, agent, property, cost centre). Validated by services/journalLinesService.js.
    lines: [
      {
        account:     { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", required: true },
        debit:       { type: Number, default: 0, min: 0 },
        credit:      { type: Number, default: 0, min: 0 },
        description: { type: String, trim: true, default: "", maxlength: 200 },
        dimensions: {
          module:     { type: String, default: null },
          project:    { type: mongoose.Schema.Types.ObjectId, ref: "SaleProject", default: null },
          deal:       { type: mongoose.Schema.Types.ObjectId, ref: "SaleDeal", default: null },
          listing:    { type: mongoose.Schema.Types.ObjectId, ref: "SaleListing", default: null },
          agent:      { type: mongoose.Schema.Types.ObjectId, ref: "SaleAgent", default: null },
          property:   { type: mongoose.Schema.Types.ObjectId, ref: "Property", default: null },
          costCentre: { type: String, trim: true, default: "" },
        },
      },
    ],

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

    // ── Approval workflow ─────────────────────────────────────────────────────
    // When a company enables requireJournalApproval in settings, journals must
    // pass through: draft → pending_review → reviewed → approved before posting.
    // Without the setting, journals can be posted directly from draft.
    approvalStatus: {
      type: String,
      enum: ["not_required", "pending_review", "reviewed", "approved", "rejected"],
      default: "not_required",
      index: true,
    },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    reviewedAt: {
      type: Date,
      default: null,
    },

    approvedByUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    approvedByUserAt: {
      type: Date,
      default: null,
    },

    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    rejectedAt: {
      type: Date,
      default: null,
    },

    rejectionReason: {
      type: String,
      trim: true,
      default: "",
      maxlength: 500,
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
JournalEntrySchema.index({ business: 1, sourceModule: 1, date: -1 });
JournalEntrySchema.index({ business: 1, sourceDocumentId: 1 }, { sparse: true });
JournalEntrySchema.index({ business: 1, status: 1, date: -1 });
JournalEntrySchema.index({ business: 1, approvalStatus: 1, date: -1 });

export default mongoose.model("JournalEntry", JournalEntrySchema);