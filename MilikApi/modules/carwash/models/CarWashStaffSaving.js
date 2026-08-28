import mongoose from "mongoose";

const { Schema, Types } = mongoose;

const carWashStaffSavingSchema = new Schema(
  {
    business:  { type: Types.ObjectId, ref: "Company",              required: true, index: true },
    branch:    { type: Types.ObjectId, ref: "CarWashBranch",        default: null,  index: true },
    staff:     { type: Types.ObjectId, ref: "CarWashStaff",         required: true, index: true },
    // "deduction"   — savings withheld from one commission payout, covering a calendar period
    // "disbursement"— annual or on-request payout back to the staff member
    // "daily"       — legacy type; no longer created, kept so old records don't break reads
    type:      { type: String, enum: ["deduction", "disbursement", "daily"], required: true },
    amount:    { type: Number, required: true, min: 0 },

    // For deduction records: the period this deduction covers
    coveredFrom: { type: Date, default: null },
    coveredTo:   { type: Date, default: null, index: true },
    dailyRate:   { type: Number, default: null },
    daysCount:   { type: Number, default: null },

    // savingsDate kept for display compat with old daily records;
    // new deduction records set it equal to coveredTo
    savingsDate: { type: Date, default: null, index: true },

    // Which commission payout triggered this deduction (deduction records only)
    commissionPayout: { type: Types.ObjectId, ref: "CarWashCommissionPayout", default: null, index: true },

    // Disbursement records
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

carWashStaffSavingSchema.index({ business: 1, staff: 1, date: -1 });
carWashStaffSavingSchema.index({ business: 1, staff: 1, commissionPayout: 1 });
carWashStaffSavingSchema.index({ business: 1, staff: 1, coveredTo: -1 });
carWashStaffSavingSchema.index({ business: 1, isReversed: 1, staff: 1 });

export default mongoose.model("CarWashStaffSaving", carWashStaffSavingSchema);
