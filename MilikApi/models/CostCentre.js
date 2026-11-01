import mongoose from "mongoose";

const STATUSES = ["active", "inactive"];

const costCentreSchema = new mongoose.Schema(
  {
    business:  { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    name:      { type: String, required: true, trim: true, maxlength: 60 },
    code:      { type: String, trim: true, uppercase: true, maxlength: 12, default: "" },
    status:    { type: String, enum: STATUSES, default: "active", index: true },
    notes:     { type: String, trim: true, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

costCentreSchema.index({ business: 1, name: 1 }, { unique: true });
costCentreSchema.index({ business: 1, status: 1 });

export default mongoose.model("CostCentre", costCentreSchema);
