import mongoose from "mongoose";

const carWashStaffSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: "CarWashBranch", default: null, index: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, default: "" },
    role: { type: String, trim: true, default: "" },
    startDate: { type: Date, required: true },
    active: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

carWashStaffSchema.index({ business: 1, name: 1 });
carWashStaffSchema.index({ business: 1, active: 1 });
carWashStaffSchema.index({ business: 1, branch: 1, active: 1 });

export default mongoose.model("CarWashStaff", carWashStaffSchema);
