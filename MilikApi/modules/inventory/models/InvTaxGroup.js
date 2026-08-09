import mongoose from "mongoose";

const invTaxGroupSchema = new mongoose.Schema(
  {
    business:    { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    name:        { type: String, required: true, trim: true },
    rate:        { type: Number, required: true, min: 0, max: 100 },
    type:        { type: String, enum: ["standard", "zero", "exempt"], default: "standard" },
    description: { type: String, trim: true, default: "" },
    active:      { type: Boolean, default: true },
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

invTaxGroupSchema.index({ business: 1, name: 1 }, { unique: true });
invTaxGroupSchema.index({ business: 1, active: 1 });

export default mongoose.model("InvTaxGroup", invTaxGroupSchema);
