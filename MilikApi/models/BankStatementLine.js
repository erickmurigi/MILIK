import mongoose from "mongoose";

const { Schema } = mongoose;

// One row of an imported bank statement, linked to the reconciliation it was imported into.
// Kept as its own persisted record (not discarded after matching) so the reconciliation carries a
// permanent, auditable trail of the actual statement data — not just which ledger entries someone
// ticked. "matched" means it's been linked to an existing FinancialLedgerEntry already in the
// books (and that entry added to the reconciliation's clearedEntries); "created" means no matching
// entry existed, so a new transaction was posted directly from this line.
const BankStatementLineSchema = new Schema(
  {
    business:       { type: Schema.Types.ObjectId, ref: "Company",            required: true, index: true },
    reconciliation: { type: Schema.Types.ObjectId, ref: "BankReconciliation", required: true, index: true },
    date:        { type: Date,   required: true },
    description: { type: String, default: "", trim: true },
    reference:   { type: String, default: "", trim: true },
    amount:      { type: Number, required: true, min: 0 },
    direction:   { type: String, enum: ["debit", "credit"], required: true },
    status: {
      type: String,
      enum: ["unmatched", "matched", "created"],
      default: "unmatched",
      index: true,
    },
    matchedEntry: { type: Schema.Types.ObjectId, ref: "FinancialLedgerEntry", default: null },
    matchedBy:    { type: Schema.Types.ObjectId, ref: "User", default: null },
    matchedAt:    { type: Date, default: null },
  },
  { timestamps: true }
);

BankStatementLineSchema.index({ business: 1, reconciliation: 1, status: 1 });

export default mongoose.model("BankStatementLine", BankStatementLineSchema);
