import mongoose from "mongoose";

const LandlordPaymentSchema = new mongoose.Schema(
  {
    landlord: { type: mongoose.Schema.Types.ObjectId, ref: "Landlord", required: true, index: true },
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    paymentMethod: {
      type: String,
      enum: ["bank_transfer", "cash", "cheque", "mpesa", "paypal", "pesapal", "other"],
      default: "bank_transfer",
      index: true,
    },
    reference: { type: String, default: null, trim: true },
    date: { type: Date, required: true, default: Date.now, index: true },
    cashbook: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", required: true },
    ledgerEntryId: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialLedgerEntry", default: null },
    ledgerEntries: [{ type: mongoose.Schema.Types.ObjectId, ref: "FinancialLedgerEntry" }],
    journalGroupId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    status: { type: String, enum: ["confirmed", "reversed"], default: "confirmed", index: true },
    reversedAt: { type: Date, default: null },
    reversedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reversalReason: { type: String, default: null, trim: true },
    reversalLedgerEntries: [{ type: mongoose.Schema.Types.ObjectId, ref: "FinancialLedgerEntry" }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

LandlordPaymentSchema.index({ business: 1, landlord: 1, date: -1 });
LandlordPaymentSchema.index({ business: 1, reference: 1 }, { sparse: true });

export default mongoose.model("LandlordPayment", LandlordPaymentSchema);
