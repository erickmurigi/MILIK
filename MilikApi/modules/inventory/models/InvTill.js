import mongoose from "mongoose";

const invTillSchema = new mongoose.Schema(
  {
    business:    { type: mongoose.Schema.Types.ObjectId, ref: "Company",     required: true, index: true },
    location:    { type: mongoose.Schema.Types.ObjectId, ref: "InvLocation", required: true },
    name:        { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    isActive:    { type: Boolean, default: true },
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

invTillSchema.index({ business: 1, location: 1, name: 1 }, { unique: true });
invTillSchema.index({ business: 1, isActive: 1 });

export default mongoose.model("InvTill", invTillSchema);
