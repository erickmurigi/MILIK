import mongoose from "mongoose";

const invLocationSchema = new mongoose.Schema(
  {
    business:    { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    name:        { type: String, required: true, trim: true },
    code:        { type: String, trim: true, uppercase: true, default: "" },
    type:        { type: String, enum: ["warehouse", "retail", "counter"], default: "retail", index: true },
    address:     { type: String, trim: true, default: "" },
    phone:       { type: String, trim: true, default: "" },
    isDefault:   { type: Boolean, default: false },
    active:      { type: Boolean, default: true, index: true },
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

invLocationSchema.index({ business: 1, type: 1, active: 1 });
invLocationSchema.index({ business: 1, code: 1 }, { unique: true, sparse: true });

export default mongoose.model("InvLocation", invLocationSchema);
