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
  },
  { timestamps: true }
);

BankReconciliationSchema.index({ business: 1, account: 1, periodEnd: -1 });

export default mongoose.model("BankReconciliation", BankReconciliationSchema);
