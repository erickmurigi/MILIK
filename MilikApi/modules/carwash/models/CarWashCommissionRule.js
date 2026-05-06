import mongoose from "mongoose";

const COMMISSION_TYPES = ["fixed", "percentage"];

const carWashCommissionRuleSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    service: { type: mongoose.Schema.Types.ObjectId, ref: "CarWashService", default: null, index: true },
    staff: { type: mongoose.Schema.Types.ObjectId, ref: "CarWashStaff", default: null, index: true },
    commissionType: { type: String, enum: COMMISSION_TYPES, required: true, default: "fixed" },
    rate: { type: Number, required: true, min: 0, default: 0 },
    active: { type: Boolean, default: true, index: true },
    priority: { type: Number, default: 0 },
    notes: { type: String, trim: true, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

carWashCommissionRuleSchema.index({ business: 1, active: 1, service: 1, staff: 1, priority: -1 });
carWashCommissionRuleSchema.index({ business: 1, name: 1 });

export default mongoose.model("CarWashCommissionRule", carWashCommissionRuleSchema);
