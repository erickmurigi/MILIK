import mongoose from "mongoose";

// Paying a client's unapplied credit back out: Dr 2136 / Cr cashbook. Kept as
// its own document (not a field on the receipt) so each refund has its own
// reference, date and reversal trail.
const clientCreditRefundSchema = new mongoose.Schema(
  {
    business:     { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    client:       { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true },
    receipt:      { type: mongoose.Schema.Types.ObjectId, ref: "ClientReceipt", required: true },
    refundNumber: { type: String, trim: true, required: true },
    refundDate:   { type: Date, required: true, default: Date.now },
    amount:       { type: Number, required: true, min: 0.01 },
    method:       { type: String, enum: ["bank_transfer", "mobile_money", "cheque", "cash", "other"], required: true },
    reference:    { type: String, trim: true, default: "" },
    cashbookAccountId:   { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", required: true },
    cashbookAccountCode: { type: String, trim: true, required: true },
    notes:        { type: String, trim: true, default: "" },
    status:       { type: String, enum: ["posted", "reversed"], default: "posted" },
    reversedBy:     { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reversedAt:     { type: Date, default: null },
    reversalReason: { type: String, trim: true, default: "" },
    journalGroupId: { type: mongoose.Schema.Types.ObjectId, default: null },
    ledgerEntries:  [{ type: mongoose.Schema.Types.ObjectId, ref: "FinancialLedgerEntry" }],
    createdBy:      { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

clientCreditRefundSchema.index({ business: 1, refundNumber: 1 }, { unique: true });
clientCreditRefundSchema.index({ business: 1, receipt: 1, status: 1 });
clientCreditRefundSchema.index({ business: 1, client: 1, refundDate: -1 });

export default mongoose.model("ClientCreditRefund", clientCreditRefundSchema);
