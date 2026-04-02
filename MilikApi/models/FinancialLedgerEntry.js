import mongoose from "mongoose";

const LEDGER_CATEGORIES = [
  "RENT_INVOICE",
  "UTILITY_INVOICE",
  "RENT_RECEIPT_MANAGER",
  "RENT_RECEIPT_LANDLORD",
  "UTILITY_RECEIPT_MANAGER",
  "UTILITY_RECEIPT_LANDLORD",
  "DEPOSIT_CHARGE",
  "DEPOSIT_RECEIVED",
  "DEPOSIT_REFUNDED",
  "DEPOSIT_APPLIED",
  "COMMISSION_CHARGE",
  "EXPENSE_DEDUCTION",
  "RECURRING_DEDUCTION",
  "ADVANCE_TO_LANDLORD",
  "ADVANCE_RECOVERY",
  "ADJUSTMENT",
  "WRITE_OFF",
  "REVERSAL",
];

const SOURCE_TYPES = [
  "rent_payment",
  "invoice",
  "invoice_note",
  "expense",
  "payment_voucher",
  "deposit",
  "processed_statement",
  "processed_statement_payment",
  "landlord_payment",
  "meter_reading",
  "manual_adjustment",
  "system_migration",
  "advance",
  "recurring_deduction",
  "other",
];

const ENTRY_STATUS = ["draft", "approved", "reversed", "void"];

const RECEIVER_TYPES = ["manager", "landlord", "tenant", "vendor", "system", "n/a"];

const DIRECTION_TYPES = ["debit", "credit"];

const FinancialLedgerEntrySchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
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
      required: true,
      index: true,
    },
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      default: null,
      index: true,
    },
    unit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Unit",
      default: null,
      index: true,
    },

    sourceTransactionType: {
      type: String,
      enum: SOURCE_TYPES,
      required: true,
      default: "other",
    },
    sourceTransactionId: {
      type: String,
      required: true,
      index: true,
    },

    transactionDate: {
      type: Date,
      required: true,
      index: true,
    },

    statementPeriodStart: {
      type: Date,
      required: true,
      index: true,
    },
    statementPeriodEnd: {
      type: Date,
      required: true,
      index: true,
    },

    category: {
      type: String,
      enum: LEDGER_CATEGORIES,
      required: true,
      index: true,
    },

    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
      index: true,
    },
    debit: {
      type: Number,
      default: 0,
      min: 0,
    },
    credit: {
      type: Number,
      default: 0,
      min: 0,
    },
    journalGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JournalGroup",
      default: null,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    direction: {
      type: String,
      enum: DIRECTION_TYPES,
      required: true,
    },

    payer: {
      type: String,
      default: "n/a",
      trim: true,
    },
    receiver: {
      type: String,
      enum: RECEIVER_TYPES,
      default: "n/a",
      index: true,
    },

    notes: {
      type: String,
      default: "",
      trim: true,
    },

    status: {
      type: String,
      enum: ENTRY_STATUS,
      default: "approved",
      index: true,
    },

    reversalOf: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinancialLedgerEntry",
      default: null,
      index: true,
    },
    reversedByEntry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinancialLedgerEntry",
      default: null,
      index: true,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

FinancialLedgerEntrySchema.virtual("signedAmount").get(function signedAmount() {
  return this.direction === "debit" ? -Number(this.amount || 0) : Number(this.amount || 0);
});

FinancialLedgerEntrySchema.index({
  business: 1,
  property: 1,
  landlord: 1,
  statementPeriodStart: 1,
  statementPeriodEnd: 1,
});

FinancialLedgerEntrySchema.index({
  business: 1,
  sourceTransactionType: 1,
  sourceTransactionId: 1,
  category: 1,
});

FinancialLedgerEntrySchema.index({ business: 1, transactionDate: -1 });
FinancialLedgerEntrySchema.index({ business: 1, accountId: 1, status: 1 });
FinancialLedgerEntrySchema.index({ business: 1, tenant: 1, transactionDate: -1 });

FinancialLedgerEntrySchema.pre("findOneAndUpdate", function blockImmutableUpdate(next) {
  return next(new Error("FinancialLedgerEntry is immutable. Use reversal entries instead of updates."));
});

FinancialLedgerEntrySchema.pre("updateOne", function blockImmutableUpdate(next) {
  return next(new Error("FinancialLedgerEntry is immutable. Use reversal entries instead of updates."));
});

FinancialLedgerEntrySchema.pre("deleteOne", function blockImmutableDelete(next) {
  return next(new Error("FinancialLedgerEntry is immutable. Use reversal entries instead of deletes."));
});

FinancialLedgerEntrySchema.pre("findOneAndDelete", function blockImmutableDelete(next) {
  return next(new Error("FinancialLedgerEntry is immutable. Use reversal entries instead of deletes."));
});

export { LEDGER_CATEGORIES, SOURCE_TYPES, ENTRY_STATUS };
export default mongoose.model("FinancialLedgerEntry", FinancialLedgerEntrySchema);