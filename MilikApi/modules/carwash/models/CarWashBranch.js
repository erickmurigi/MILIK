import mongoose from "mongoose";

const carWashBranchSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    location: { type: String, trim: true, default: "" },
    address: { type: String, trim: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    mpesaShortCode: { type: String, trim: true, default: "" },
    branchType: { type: String, enum: ["vehicle", "carpet", "both"], default: "both" },
    defaultCashbooks: {
      cash:  { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", default: null },
      mpesa: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", default: null },
      bank:  { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", default: null },
      card:  { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", default: null },
      other: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", default: null },
    },
    active: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

carWashBranchSchema.index({ business: 1, name: 1 }, { unique: true });
carWashBranchSchema.index({ business: 1, active: 1 });

export default mongoose.model("CarWashBranch", carWashBranchSchema);
