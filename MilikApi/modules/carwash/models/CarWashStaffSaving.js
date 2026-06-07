import mongoose from "mongoose";

const { Schema, Types } = mongoose;

const carWashStaffSavingSchema = new Schema(
  {
    business:  { type: Types.ObjectId, ref: "Company",              required: true, index: true },
    branch:    { type: Types.ObjectId, ref: "CarWashBranch",        default: null,  index: true },
    staff:     { type: Types.ObjectId, ref: "CarWashStaff",         required: true, index: true },
    // "daily"       — Ksh X standing-order deduction for one calendar day
    // "disbursement"— annual or on-request payout back to the staff member
    type:      { type: String, enum: ["daily", "disbursement"],     required: true },
    amount:    { type: Number, required: true, min: 0 },
    // For daily records: the calendar date this entry represents (time zeroed to 00:00 UTC)
    savingsDate: { type: Date, default: null, index: true },
    // Set on a daily record when it has been held back from a commission cash payout
    commissionPayout: { type: Types.ObjectId, ref: "CarWashCommissionPayout", default: null, index: true },
    // Set on disbursement records
    savingsPayoutNumber: { type: String, trim: true, default: "" },
    ledgerEntries:       [{ type: Types.ObjectId, ref: "FinancialLedgerEntry" }],
    notes:     { type: String, trim: true, default: "" },
    date:      { type: Date, default: Date.now, index: true },
    createdBy: { type: Types.ObjectId, ref: "User", default: null },
    isReversed:  { type: Boolean, default: false },
    reversedAt:  { type: Date, default: null },
    reversedBy:  { type: Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// One daily record per staff per calendar date — prevents double-posting
carWashStaffSavingSchema.index(
  { business: 1, staff: 1, savingsDate: 1, type: 1 },
  { unique: true, sparse: true, partialFilterExpression: { type: "daily" } }
);
carWashStaffSavingSchema.index({ business: 1, staff: 1, date: -1 });
carWashStaffSavingSchema.index({ business: 1, staff: 1, commissionPayout: 1 });

export default mongoose.model("CarWashStaffSaving", carWashStaffSavingSchema);
