import mongoose from "mongoose";

const { Schema } = mongoose;

const BankReconciliationSchema = new Schema(
  {
    business:    { type: Schema.Types.ObjectId, ref: "Company",       required: true, index: true },
    account:     { type: Schema.Types.ObjectId, ref: "ChartOfAccount", required: true, index: true },
    accountName: { type: String, default: "" },
    accountCode: { type: String, default: "" },
    periodStart: { type: Date, required: true },
    periodEnd:   { type: Date, required: true },
    statementOpeningBalance: { type: Number, default: 0 },
    statementClosingBalance: { type: Number, default: 0 },
    clearedEntries: [{ type: Schema.Types.ObjectId, ref: "FinancialLedgerEntry" }],
    difference:  { type: Number, default: 0 },
    status:      { type: String, enum: ["draft", "reconciled"], default: "draft", index: true },
    notes:       { type: String, default: "" },
    reconciledAt: { type: Date },
    reconciledBy: { type: Schema.Types.ObjectId, ref: "User" },
    // Full history of every time this reconciliation was unlocked after being finalised — an
    // admin-only, audited escape hatch (never a silent edit) for correcting a genuine mistake
    // without needing a manual correcting journal. reconciledAt/reconciledBy above always reflect
    // the MOST RECENT finalise, so a reopened-then-refinalised reconciliation still shows who
    // last locked it; this array is the permanent trail of every unlock in between.
    reopenHistory: [{
      reopenedAt: { type: Date, required: true },
      reopenedBy: { type: Schema.Types.ObjectId, ref: "User" },
      reason:     { type: String, required: true, trim: true },
      // What this reconciliation's state was at the moment it got reopened — lets an auditor see
      // exactly what was undone (which balances, which difference) without having to reconstruct it.
      previousReconciledAt: { type: Date },
      previousDifference:   { type: Number },
    }],
  },
  { timestamps: true }
);

BankReconciliationSchema.index({ business: 1, account: 1, periodEnd: -1 });

export default mongoose.model("BankReconciliation", BankReconciliationSchema);
