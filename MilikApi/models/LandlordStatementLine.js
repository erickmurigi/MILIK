import mongoose from "mongoose";

/**
 * LandlordStatementLine: Immutable line items within an approved landlord statement.
 * Each line represents a frozen snapshot of a ledger entry at the time of statement approval.
 */

const LandlordStatementLineSchema = new mongoose.Schema(
  {
    statement: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LandlordStatement",
      required: true,
      index: true,
    },
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
    },
    landlord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Landlord",
      required: true,
    },
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      default: null,
    },
    unit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Unit",
      default: null,
    },
    transactionDate: {
      type: Date,
      required: true,
      index: true,
    },
    category: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    direction: {
      type: String,
      enum: ["debit", "credit"],
      required: true,
    },
    runningBalance: {
      type: Number,
      required: true,
    },
    sourceLedgerEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinancialLedgerEntry",
      required: true,
      index: true,
    },
    sourceTransactionType: {
      type: String,
      default: null,
      trim: true,
    },
    sourceTransactionId: {
      type: String,
      default: null,
      trim: true,
    },
    lineNumber: {
      type: Number,
      required: true,
      min: 1,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes
LandlordStatementLineSchema.index({ statement: 1, lineNumber: 1 }, { unique: true });
LandlordStatementLineSchema.index({ business: 1, statement: 1, transactionDate: 1 });
LandlordStatementLineSchema.index({ sourceLedgerEntryId: 1, statement: 1 });

// Virtual for signed amount (debit = negative, credit = positive)
LandlordStatementLineSchema.virtual("signedAmount").get(function () {
  return this.direction === "debit" ? -Math.abs(this.amount) : Math.abs(this.amount);
});

// Prevent modification of statement lines (immutable after creation)
LandlordStatementLineSchema.pre("findOneAndUpdate", function (next) {
  return next(new Error("LandlordStatementLine is immutable. Create a new statement version for corrections."));
});

LandlordStatementLineSchema.pre("updateOne", function (next) {
  return next(new Error("LandlordStatementLine is immutable. Create a new statement version for corrections."));
});

LandlordStatementLineSchema.pre("findOneAndDelete", async function (next) {
  const lineToDelete = await this.model.findOne(this.getQuery()).populate("statement");
  if (lineToDelete?.statement?.status === "approved" || lineToDelete?.statement?.status === "sent") {
    return next(new Error("Cannot delete lines from approved or sent statements."));
  }
  next();
});

export default mongoose.model("LandlordStatementLine", LandlordStatementLineSchema);
