import mongoose from "mongoose";

const PAYOUT_METHODS = ["cash", "mpesa", "bank", "card", "other"];

const carWashCommissionPayoutSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: "CarWashBranch", default: null, index: true },
    payoutNumber: { type: String, required: true, trim: true },
    staff: { type: mongoose.Schema.Types.ObjectId, ref: "CarWashStaff", required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    method: { type: String, enum: PAYOUT_METHODS, default: "cash" },
    cashbookAccount: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", required: true, index: true },
    reference: { type: String, trim: true, default: "" },
    payoutDate: { type: Date, default: Date.now, index: true },
    commissions: [{ type: mongoose.Schema.Types.ObjectId, ref: "CarWashStaffCommission" }],
    savingsHeld:  { type: Number, default: 0 },   // savings deducted from this payout
    damagesHeld:  { type: Number, default: 0 },   // staff damages recovered from this payout
    netCash:      { type: Number, default: null }, // actual cash paid to staff (amount - savingsHeld - damagesHeld)
    ledgerEntries: [{ type: mongoose.Schema.Types.ObjectId, ref: "FinancialLedgerEntry" }],
    notes: { type: String, trim: true, default: "" },
    // Reversal fields
    isReversed:    { type: Boolean, default: false, index: true },
    reversedAt:    { type: Date, default: null },
    reversedBy:    { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reversalNotes: { type: String, trim: true, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

carWashCommissionPayoutSchema.index({ business: 1, payoutNumber: 1 }, { unique: true });
carWashCommissionPayoutSchema.index({ business: 1, payoutDate: -1 });
carWashCommissionPayoutSchema.index({ business: 1, staff: 1, payoutDate: -1 });

export default mongoose.model("CarWashCommissionPayout", carWashCommissionPayoutSchema);
