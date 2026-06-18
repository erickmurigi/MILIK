import mongoose from "mongoose";

const { Schema, Types } = mongoose;

const carWashStaffDamageSchema = new Schema(
  {
    business:  { type: Types.ObjectId, ref: "Company",               required: true, index: true },
    branch:    { type: Types.ObjectId, ref: "CarWashBranch",         default: null,  index: true },
    staff:     { type: Types.ObjectId, ref: "CarWashStaff",          required: true, index: true },
    amount:    { type: Number,         required: true,  min: 0 },
    description: { type: String,       required: true,  trim: true },
    damageDate:  { type: Date,         default: Date.now, index: true },
    // Optional link to the job the damage occurred on
    job:       { type: Types.ObjectId, ref: "CarWashJob",            default: null },
    // "pending"  — not yet deducted from any payout
    // "deducted" — held from a commission payout
    // "waived"   — manager wrote it off; will never be deducted
    status:    { type: String, enum: ["pending", "deducted", "waived"], default: "pending", index: true },
    // Set when status becomes "deducted"
    commissionPayout: { type: Types.ObjectId, ref: "CarWashCommissionPayout", default: null, index: true },
    notes:     { type: String, trim: true, default: "" },
    recordedBy: { type: Types.ObjectId, ref: "User", default: null },
    waivedBy:   { type: Types.ObjectId, ref: "User", default: null },
    waivedAt:   { type: Date, default: null },
  },
  { timestamps: true }
);

carWashStaffDamageSchema.index({ business: 1, staff: 1, damageDate: -1 });
carWashStaffDamageSchema.index({ business: 1, staff: 1, status: 1 });
carWashStaffDamageSchema.index({ business: 1, staff: 1, commissionPayout: 1 });

export default mongoose.model("CarWashStaffDamage", carWashStaffDamageSchema);
